"""AI-powered transcript quality review service.

Reviews transcript segments via the local LLM and proposes corrections
(text fixes, blank removals, segment merges) that users can accept or reject.
"""

import json
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any

from sqlalchemy import select

from core.interfaces import ChatMessage, ChatOptions, ChatResponse, IAIService
from persistence.database import get_session_factory
from persistence.models import QualityReviewRecord, Segment

logger = logging.getLogger(__name__)

DEFAULT_BATCH_SIZE = 50
MAX_BATCH_SIZE = 100
OVERLAP = 2
# Fixed context budget for review batches — independent of the model's n_ctx.
# 8B models review quality degrades well before filling a large context, and
# smaller batches keep the event loop responsive (health checks, WebSocket).
REVIEW_CONTEXT_BUDGET = 4096
# Reserve tokens for system prompt (~150), response, and safety margin
PROMPT_OVERHEAD_TOKENS = 250
RESPONSE_TOKENS = 2048
# With integer IDs (0, 1...) instead of UUIDs, ~3 chars/token is reasonable
CHARS_PER_TOKEN = 3
# Context neighbors: how many segments on each side of a flagged segment
# to include in the LLM batch for surrounding context.
CONTEXT_RADIUS = 2
# Similarity threshold for near-duplicate detection between adjacent segments
DUPLICATE_RATIO = 0.8

# Common hallucination phrases produced by whisper-like models
HALLUCINATION_PHRASES = [
    "thank you for watching",
    "thanks for watching",
    "subscribe to my channel",
    "please subscribe",
    "like and subscribe",
    "don't forget to subscribe",
    "hit the bell",
    "see you in the next video",
    "see you next time",
    "thanks for listening",
    "thank you for listening",
    "please like and subscribe",
    "if you enjoyed this video",
    "leave a comment below",
    "check out my other videos",
    "link in the description",
]


@dataclass
class CorrectedSegment:
    """A proposed text correction for a single segment."""

    segment_id: str
    original_text: str
    corrected_text: str
    correction_type: str  # "repetition", "hallucination", "grammar", "filler", "punctuation"
    confidence: float
    explanation: str


@dataclass
class MergedSegment:
    """A proposed merge of consecutive segments."""

    segment_ids: list[str]
    merged_text: str
    explanation: str
    original_texts: list[str] = field(default_factory=list)


@dataclass
class QualityReviewStats:
    """Statistics from a quality review run."""

    total_segments: int = 0
    corrections: int = 0
    removals: int = 0
    merges: int = 0
    blank_removals: int = 0


@dataclass
class QualityReviewResult:
    """Full result of a quality review."""

    corrected_segments: list[CorrectedSegment] = field(default_factory=list)
    removed_segment_ids: list[str] = field(default_factory=list)
    removed_segments: list[dict] = field(default_factory=list)
    merge_suggestions: list[MergedSegment] = field(default_factory=list)
    stats: QualityReviewStats = field(default_factory=QualityReviewStats)


def _heuristic_scan(
    segments: list[dict],
    aggressiveness: str,
) -> tuple[QualityReviewResult, set[int]]:
    """Pass 1: fast heuristic scan for obvious issues.

    Only flags patterns that are clearly wrong — missing punctuation and short
    segments are normal in ASR output and should NOT be flagged.

    Returns:
        - QualityReviewResult with direct corrections (no LLM needed)
        - Set of segment indices that are "suspicious" and need LLM review
    """
    result = QualityReviewResult()
    flagged: set[int] = set()
    n = len(segments)

    for i, seg in enumerate(segments):
        text = seg["text"]
        text_lower = text.lower().strip()

        # --- Hallucination detection ---
        is_hallucination = False
        for phrase in HALLUCINATION_PHRASES:
            if phrase in text_lower:
                result.removed_segment_ids.append(seg["id"])
                result.removed_segments.append({
                    "segment_id": seg["id"],
                    "text": text,
                    "speaker": seg.get("speaker", ""),
                })
                is_hallucination = True
                break
        if is_hallucination:
            continue

        # --- Exact duplicate of previous segment ---
        if i > 0 and text.strip() == segments[i - 1]["text"].strip():
            result.removed_segment_ids.append(seg["id"])
            result.removed_segments.append({
                "segment_id": seg["id"],
                "text": text,
                "speaker": seg.get("speaker", ""),
            })
            continue

        # --- Near-duplicate of adjacent segment (not exact) ---
        if i > 0:
            prev_text = segments[i - 1]["text"]
            ratio = SequenceMatcher(None, prev_text, text).ratio()
            if ratio >= DUPLICATE_RATIO:
                flagged.add(i - 1)
                flagged.add(i)

        # --- Repeated phrase within segment ---
        # e.g. "the the" or "I think I think that"
        words = text.split()
        if len(words) >= 4:
            half = len(words) // 2
            for run_len in range(2, half + 1):
                for start in range(len(words) - run_len * 2 + 1):
                    chunk_a = words[start:start + run_len]
                    chunk_b = words[start + run_len:start + run_len * 2]
                    if chunk_a == chunk_b:
                        flagged.add(i)
                        break
                else:
                    continue
                break

    # Remove flagged indices that were already handled as removals
    removed_ids = set(result.removed_segment_ids)
    flagged = {i for i in flagged if segments[i]["id"] not in removed_ids}

    return result, flagged


def _expand_flagged_with_context(
    flagged: set[int],
    total: int,
    radius: int = CONTEXT_RADIUS,
) -> list[int]:
    """Expand flagged indices to include context neighbors, return sorted list."""
    expanded: set[int] = set()
    for i in flagged:
        for offset in range(-radius, radius + 1):
            j = i + offset
            if 0 <= j < total:
                expanded.add(j)
    return sorted(expanded)


def _build_review_prompt(
    segments: list[dict],
    context_hint: str | None,
    aggressiveness: str,
) -> tuple[ChatMessage, ChatMessage, dict[int, str]]:
    """Build compact system and user messages for the review prompt.

    Uses pure integer IDs (0, 1, ...) with no speakers or timestamps.
    Returns the int→UUID id_map.
    """

    aggressiveness_lines = {
        "conservative": "ONLY fix obvious errors: repeated phrases, hallucinated content, nonsensical segments. Skip grammar/fillers/style.",
        "moderate": "Fix repetitions, hallucinations, misheard words, and broken segment boundaries. Skip style/filler.",
        "aggressive": "Fix all issues: repetitions, hallucinations, misheard words, fillers (um, uh, like), grammar, punctuation, broken boundaries.",
    }

    aggressiveness_line = aggressiveness_lines.get(aggressiveness, aggressiveness_lines["moderate"])
    context_line = f"Context: {context_hint}" if context_hint else ""

    system_msg = ChatMessage(
        role="system",
        content=(
            "Fix transcription errors. You have 3 tools:\n\n"
            "edit(i, x) - replace segment i with corrected FULL text x\n"
            "delete(i) - remove hallucinated/blank segment i\n"
            "merge(i[], x) - join consecutive segments into one\n\n"
            'Return JSON: {"a":[actions]}\n'
            'edit example: {"t":"e","i":0,"x":"the complete corrected segment text here"}\n'
            'delete example: {"t":"d","i":5}\n'
            'merge example: {"t":"m","i":[3,4],"x":"merged full text of both segments"}\n'
            'Optional "k" on edits: misheard|repetition|hallucination|filler|grammar|punctuation\n\n'
            "IMPORTANT: x must be the ENTIRE corrected segment text, not just the changed word.\n\n"
            "Common issues to look for:\n"
            '- Repeated words/phrases: "the the", "I think I think", "going to going to"\n'
            "- Stutters and false starts that got transcribed\n"
            "- Hallucinated content (YouTube outros, subscribe prompts)\n"
            "- Misheard words that don't fit the context\n\n"
            "Rules:\n"
            "- ONLY fix clear transcription errors, not style\n"
            "- If unsure, skip it\n"
            f"- {aggressiveness_line}\n"
            f"{context_line}"
        ).rstrip(),
    )

    # Map integers to real UUIDs
    id_map: dict[int, str] = {}
    segment_lines = []
    for i, seg in enumerate(segments):
        id_map[i] = seg["id"]
        segment_lines.append(f"{i}: {seg['text']}")

    user_msg = ChatMessage(
        role="user",
        content="\n".join(segment_lines),
    )

    return system_msg, user_msg, id_map


def _compute_confidence(original: str, corrected: str, kind: str | None) -> float:
    """Compute heuristic confidence from edit distance rather than LLM self-report."""
    if kind == "hallucination":
        return 0.95
    if kind == "repetition":
        return 0.90
    ratio = SequenceMatcher(None, original, corrected).ratio()
    # Small edit (high ratio) → high confidence; large edit → lower confidence
    # Map ratio [0..1] to confidence [0.5..0.95]
    return max(0.5, min(0.95, ratio))


def _parse_json_response(raw: str) -> dict:
    """Parse LLM JSON response, recovering partial actions from truncated output.

    When the LLM hits max_tokens, the JSON is cut off mid-object.
    This extracts all complete action objects that were written before truncation.
    """
    # Happy path: valid JSON
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        pass

    # Truncated JSON: extract individual complete action objects
    # Match complete {...} objects that have at least "t" and "i" fields
    actions = []
    for m in re.finditer(r'\{[^{}]*\}', raw):
        try:
            obj = json.loads(m.group())
            if "t" in obj and "i" in obj:
                actions.append(obj)
        except json.JSONDecodeError:
            continue

    if actions:
        logger.warning(
            "Recovered %d actions from truncated JSON response (%d chars)",
            len(actions), len(raw),
        )
    else:
        logger.warning("Failed to parse LLM response as JSON: %s", raw[:200])

    return {"a": actions}


def _parse_actions(
    data: dict,
    id_map: dict[int, str],
    seg_lookup: dict[str, str],
    seg_speaker_lookup: dict[str, str],
) -> QualityReviewResult:
    """Parse compact action-based LLM response into QualityReviewResult."""
    result = QualityReviewResult()

    for action in data.get("a", []):
        t = action.get("t")

        if t == "e":
            # Edit action
            idx = action.get("i")
            if not isinstance(idx, int) or idx not in id_map:
                continue
            seg_id = id_map[idx]
            if seg_id not in seg_lookup:
                continue
            original = seg_lookup[seg_id]
            corrected = action.get("x", "")
            if not corrected or corrected == original:
                continue
            kind = action.get("k")
            result.corrected_segments.append(
                CorrectedSegment(
                    segment_id=seg_id,
                    original_text=original,
                    corrected_text=corrected,
                    correction_type=kind or "auto",
                    confidence=_compute_confidence(original, corrected, kind),
                    explanation="",
                )
            )

        elif t == "d":
            # Delete action
            idx = action.get("i")
            if not isinstance(idx, int) or idx not in id_map:
                continue
            seg_id = id_map[idx]
            if seg_id not in seg_lookup:
                continue
            result.removed_segment_ids.append(seg_id)
            result.removed_segments.append({
                "segment_id": seg_id,
                "text": seg_lookup[seg_id],
                "speaker": seg_speaker_lookup.get(seg_id, ""),
            })

        elif t == "m":
            # Merge action
            indices = action.get("i", [])
            if not isinstance(indices, list) or len(indices) < 2:
                continue
            ids = []
            for idx in indices:
                if not isinstance(idx, int) or idx not in id_map:
                    break
                ids.append(id_map[idx])
            if len(ids) < 2 or not all(sid in seg_lookup for sid in ids):
                continue
            result.merge_suggestions.append(
                MergedSegment(
                    segment_ids=ids,
                    merged_text=action.get("x", ""),
                    explanation="",
                    original_texts=[seg_lookup.get(sid, "") for sid in ids],
                )
            )

    return result


async def _run_batch(
    ai_service: IAIService,
    segments: list[dict],
    context_hint: str | None,
    aggressiveness: str,
) -> QualityReviewResult:
    """Run quality review on a single batch of segments."""
    system_msg, user_msg, id_map = _build_review_prompt(segments, context_hint, aggressiveness)

    # Budget ~60 tokens per potential correction; expect ~30% of segments to need fixes.
    # Minimum 256 for the JSON wrapper, cap at 1024 to prevent runaway generation.
    max_response = min(256 + len(segments) * 20, 1024)
    options = ChatOptions(
        temperature=0.1,
        max_tokens=max_response,
        response_format={"type": "json_object"},
    )
    response: ChatResponse = await ai_service.chat([system_msg, user_msg], options)

    if response.usage:
        logger.info(
            "LLM tokens — prompt: %d, completion: %d, total: %d",
            response.usage.get("prompt_tokens", 0),
            response.usage.get("completion_tokens", 0),
            response.usage.get("total_tokens", 0),
        )

    data = _parse_json_response(response.content)

    # Build segment lookups using real IDs
    seg_lookup = {s["id"]: s["text"] for s in segments}
    seg_speaker_lookup = {s["id"]: s.get("speaker", "") for s in segments}

    return _parse_actions(data, id_map, seg_lookup, seg_speaker_lookup)


async def run_quality_review(
    transcript_id: str,
    job_id: str,
    context_hint: str | None,
    aggressiveness: str,
    ai_service: IAIService,
    progress_callback: Any = None,
) -> QualityReviewResult:
    """Run a full quality review on a transcript.

    Loads segments, batches them through the LLM, deduplicates, and persists results.
    """
    # Load segments
    async with get_session_factory()() as session:
        seg_result = await session.execute(
            select(Segment)
            .where(Segment.transcript_id == transcript_id)
            .order_by(Segment.segment_index)
        )
        db_segments = seg_result.scalars().all()

    if not db_segments:
        logger.warning("No segments found for transcript %s", transcript_id)
        return QualityReviewResult()

    # Convert to dicts for processing
    all_segments = [
        {
            "id": s.id,
            "text": s.text,
            "speaker": s.speaker,
            "start_time": s.start_time,
            "end_time": s.end_time,
            "segment_index": s.segment_index,
        }
        for s in db_segments
    ]

    stats = QualityReviewStats(total_segments=len(all_segments))

    # Pre-filter blank segments (no LLM needed)
    blank_ids = []
    blank_segments = []
    non_blank = []
    for seg in all_segments:
        if not seg["text"].strip():
            blank_ids.append(seg["id"])
            blank_segments.append({
                "segment_id": seg["id"],
                "text": seg["text"],
                "speaker": seg.get("speaker", ""),
            })
        else:
            non_blank.append(seg)
    stats.blank_removals = len(blank_ids)

    combined = QualityReviewResult()
    combined.removed_segment_ids = list(blank_ids)
    combined.removed_segments = list(blank_segments)

    if progress_callback:
        await progress_callback(5)

    # ── Pass 1: fast heuristic scan ──────────────────────────────────────
    t0 = time.monotonic()
    heuristic_result, flagged_indices = _heuristic_scan(non_blank, aggressiveness)
    heuristic_elapsed = time.monotonic() - t0

    # Merge heuristic removals into combined
    for seg_id in heuristic_result.removed_segment_ids:
        if seg_id not in combined.removed_segment_ids:
            combined.removed_segment_ids.append(seg_id)
    for rseg in heuristic_result.removed_segments:
        if rseg["segment_id"] not in {r["segment_id"] for r in combined.removed_segments}:
            combined.removed_segments.append(rseg)
    # Merge heuristic corrections
    for corr in heuristic_result.corrected_segments:
        combined.corrected_segments.append(corr)

    # Expand flagged indices with context neighbors for LLM review
    llm_indices = _expand_flagged_with_context(flagged_indices, len(non_blank))
    # Exclude segments already removed by heuristics
    already_removed = set(combined.removed_segment_ids)
    llm_indices = [i for i in llm_indices if non_blank[i]["id"] not in already_removed]
    llm_segments = [non_blank[i] for i in llm_indices]

    logger.info(
        "Pass 1 (heuristic) complete in %.2fs: %d removals, %d flagged → "
        "%d segments for LLM (%.0f%% reduction from %d non-blank)",
        heuristic_elapsed,
        len(heuristic_result.removed_segment_ids),
        len(flagged_indices),
        len(llm_segments),
        (1 - len(llm_segments) / max(len(non_blank), 1)) * 100,
        len(non_blank),
    )

    if progress_callback:
        await progress_callback(10)

    # ── Pass 2: LLM review of flagged segments only ──────────────────────
    if llm_segments:
        # Compute batch size from fixed context budget
        available_for_input = REVIEW_CONTEXT_BUDGET - RESPONSE_TOKENS - PROMPT_OVERHEAD_TOKENS
        if available_for_input < 512:
            available_for_input = 512

        avg_seg_chars = sum(len(s["text"]) for s in llm_segments) / len(llm_segments)
        avg_tokens_per_seg = (avg_seg_chars + 5) / CHARS_PER_TOKEN * 1.2
        batch_size = max(10, min(
            int(available_for_input / max(avg_tokens_per_seg, 1)),
            MAX_BATCH_SIZE,
            len(llm_segments),
        ))

        logger.info(
            "Pass 2 (LLM): %d segments, context_budget=%d, batch_size=%d",
            len(llm_segments), REVIEW_CONTEXT_BUDGET, batch_size,
        )

        total_batches = max(1, (len(llm_segments) + batch_size - 1) // batch_size)
        seen_corrections: dict[str, float] = {}

        for batch_idx in range(total_batches):
            start = batch_idx * batch_size
            actual_start = max(0, start - OVERLAP) if batch_idx > 0 else 0
            end = min(len(llm_segments), start + batch_size)
            batch = llm_segments[actual_start:end]

            if not batch:
                continue

            try:
                logger.info(
                    "Batch %d/%d: reviewing %d segments...",
                    batch_idx + 1, total_batches, len(batch),
                )
                bt0 = time.monotonic()
                batch_result = await _run_batch(ai_service, batch, context_hint, aggressiveness)
                elapsed = time.monotonic() - bt0
                logger.info(
                    "Batch %d/%d complete in %.1fs — %d edits, %d deletes, %d merges",
                    batch_idx + 1, total_batches, elapsed,
                    len(batch_result.corrected_segments),
                    len(batch_result.removed_segment_ids),
                    len(batch_result.merge_suggestions),
                )

                for corr in batch_result.corrected_segments:
                    prev_conf = seen_corrections.get(corr.segment_id, -1)
                    if corr.confidence > prev_conf:
                        combined.corrected_segments = [
                            c for c in combined.corrected_segments if c.segment_id != corr.segment_id
                        ]
                        combined.corrected_segments.append(corr)
                        seen_corrections[corr.segment_id] = corr.confidence

                for seg_id in batch_result.removed_segment_ids:
                    if seg_id not in combined.removed_segment_ids:
                        combined.removed_segment_ids.append(seg_id)
                for rseg in batch_result.removed_segments:
                    if rseg["segment_id"] not in {r["segment_id"] for r in combined.removed_segments}:
                        combined.removed_segments.append(rseg)

                for merge in batch_result.merge_suggestions:
                    merge_key = tuple(merge.segment_ids)
                    existing_keys = {tuple(m.segment_ids) for m in combined.merge_suggestions}
                    if merge_key not in existing_keys:
                        combined.merge_suggestions.append(merge)

            except Exception as e:
                logger.error("Batch %d failed: %s", batch_idx, e, exc_info=True)

            if progress_callback:
                batch_progress = 10 + (80 * (batch_idx + 1) / total_batches)
                await progress_callback(batch_progress)
    else:
        logger.info("No segments flagged for LLM review — heuristics handled everything")

    # Compute stats
    stats.corrections = len(combined.corrected_segments)
    stats.removals = len(combined.removed_segment_ids)
    stats.merges = len(combined.merge_suggestions)
    combined.stats = stats

    # Persist result to quality_review_records
    record_id = str(uuid.uuid4())
    corrections_data = {
        "corrected_segments": [
            {
                "segment_id": c.segment_id,
                "original_text": c.original_text,
                "corrected_text": c.corrected_text,
                "correction_type": c.correction_type,
                "confidence": c.confidence,
                "explanation": c.explanation,
            }
            for c in combined.corrected_segments
        ],
        "removed_segment_ids": combined.removed_segment_ids,
        "removed_segments": combined.removed_segments,
        "merge_suggestions": [
            {
                "segment_ids": m.segment_ids,
                "merged_text": m.merged_text,
                "explanation": m.explanation,
                "original_texts": m.original_texts,
            }
            for m in combined.merge_suggestions
        ],
    }
    stats_data = {
        "total_segments": stats.total_segments,
        "corrections": stats.corrections,
        "removals": stats.removals,
        "merges": stats.merges,
        "blank_removals": stats.blank_removals,
    }

    async with get_session_factory()() as session:
        record = QualityReviewRecord(
            id=record_id,
            transcript_id=transcript_id,
            job_id=job_id,
            status="completed",
            context_hint=context_hint,
            aggressiveness=aggressiveness,
            corrections_json=corrections_data,
            stats_json=stats_data,
        )
        session.add(record)
        await session.commit()

    if progress_callback:
        await progress_callback(95)

    logger.info(
        "Quality review complete for transcript %s: %d corrections, %d removals, %d merges",
        transcript_id,
        stats.corrections,
        stats.removals,
        stats.merges,
    )

    return combined
