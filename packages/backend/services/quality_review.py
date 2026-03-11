"""AI-powered transcript quality review service.

Reviews transcript segments via the local LLM and proposes corrections
(text fixes, blank removals, segment merges) that users can accept or reject.
"""

import json
import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update

from core.interfaces import ChatMessage, ChatOptions, ChatResponse, IAIService
from persistence.database import get_session_factory
from persistence.models import QualityReviewRecord, Segment

logger = logging.getLogger(__name__)

BATCH_SIZE = 25
OVERLAP = 3


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
    merge_suggestions: list[MergedSegment] = field(default_factory=list)
    stats: QualityReviewStats = field(default_factory=QualityReviewStats)


def _build_review_prompt(
    segments: list[dict],
    context_hint: str | None,
    aggressiveness: str,
) -> tuple[ChatMessage, ChatMessage]:
    """Build system and user messages for the review prompt."""

    level_instructions = {
        "conservative": (
            "Only flag OBVIOUS errors: repeated phrases/sentences, clearly hallucinated content "
            "(e.g. 'Thank you for watching', 'Subscribe to my channel' in non-YouTube content), "
            "and completely blank or nonsensical segments. Do NOT fix grammar, fillers, or style."
        ),
        "moderate": (
            "Flag repetitions, hallucinations, blank segments, and broken segment boundaries "
            "that should be merged. Also fix clear misheard words where context makes the "
            "correct word obvious. Suggest merging segments that are mid-sentence splits."
        ),
        "aggressive": (
            "Fix all issues including: repetitions, hallucinations, misheard words, "
            "filler words (um, uh, like, you know), grammar/punctuation, and broken "
            "segment boundaries. Clean up the transcript for readability."
        ),
    }

    context_line = ""
    if context_hint:
        context_line = f"\nContext about this recording: {context_hint}\n"

    system_msg = ChatMessage(
        role="system",
        content=(
            "You are a transcript quality reviewer. You analyze speech-to-text output "
            "and identify errors introduced by the transcription engine.\n\n"
            f"Aggressiveness level: {aggressiveness}\n"
            f"{level_instructions.get(aggressiveness, level_instructions['moderate'])}\n"
            f"{context_line}\n"
            "You MUST respond with ONLY valid JSON, no markdown fences, no explanation outside JSON.\n"
            "Response format:\n"
            "{\n"
            '  "corrected_segments": [\n'
            '    {"segment_id": "...", "corrected_text": "...", "correction_type": "repetition|hallucination|grammar|filler|punctuation|misheard", "confidence": 0.0-1.0, "explanation": "..."}\n'
            "  ],\n"
            '  "removed_segment_ids": ["id1", "id2"],\n'
            '  "merge_suggestions": [\n'
            '    {"segment_ids": ["id1", "id2"], "merged_text": "...", "explanation": "..."}\n'
            "  ]\n"
            "}\n\n"
            "Rules:\n"
            "- Only include segments that need changes\n"
            "- removed_segment_ids: segments that are entirely hallucinated or blank noise\n"
            "- merge_suggestions: consecutive segments that should be one (mid-sentence splits)\n"
            "- Never change speaker labels or timestamps\n"
            "- Preserve the original meaning — only fix transcription artifacts"
        ),
    )

    segment_lines = []
    for seg in segments:
        segment_lines.append(
            f'[{seg["id"]}] ({seg.get("speaker", "?")} | '
            f'{seg["start_time"]:.1f}s-{seg["end_time"]:.1f}s): {seg["text"]}'
        )

    user_msg = ChatMessage(
        role="user",
        content=(
            "Review these transcript segments and return corrections as JSON:\n\n"
            + "\n".join(segment_lines)
        ),
    )

    return system_msg, user_msg


def _parse_llm_response(raw: str) -> dict:
    """Parse LLM JSON response, stripping markdown fences if present."""
    text = raw.strip()

    # Strip markdown code fences
    if text.startswith("```"):
        # Remove opening fence (with optional language tag)
        text = re.sub(r"^```(?:json)?\s*\n?", "", text)
        # Remove closing fence
        text = re.sub(r"\n?```\s*$", "", text)

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to find JSON object in the text
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
        logger.warning("Failed to parse LLM response as JSON: %s", text[:200])
        return {"corrected_segments": [], "removed_segment_ids": [], "merge_suggestions": []}


async def _run_batch(
    ai_service: IAIService,
    segments: list[dict],
    context_hint: str | None,
    aggressiveness: str,
) -> QualityReviewResult:
    """Run quality review on a single batch of segments."""
    system_msg, user_msg = _build_review_prompt(segments, context_hint, aggressiveness)

    options = ChatOptions(temperature=0.1, max_tokens=4096)
    response: ChatResponse = await ai_service.chat([system_msg, user_msg], options)

    data = _parse_llm_response(response.content)

    # Build segment lookup for original text
    seg_lookup = {s["id"]: s["text"] for s in segments}

    result = QualityReviewResult()

    for item in data.get("corrected_segments", []):
        seg_id = item.get("segment_id", "")
        if seg_id not in seg_lookup:
            continue
        original = seg_lookup[seg_id]
        corrected = item.get("corrected_text", "")
        if corrected and corrected != original:
            result.corrected_segments.append(
                CorrectedSegment(
                    segment_id=seg_id,
                    original_text=original,
                    corrected_text=corrected,
                    correction_type=item.get("correction_type", "unknown"),
                    confidence=float(item.get("confidence", 0.5)),
                    explanation=item.get("explanation", ""),
                )
            )

    for seg_id in data.get("removed_segment_ids", []):
        if seg_id in seg_lookup:
            result.removed_segment_ids.append(seg_id)

    for merge in data.get("merge_suggestions", []):
        ids = merge.get("segment_ids", [])
        if len(ids) >= 2 and all(sid in seg_lookup for sid in ids):
            result.merge_suggestions.append(
                MergedSegment(
                    segment_ids=ids,
                    merged_text=merge.get("merged_text", ""),
                    explanation=merge.get("explanation", ""),
                )
            )

    return result


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
    non_blank = []
    for seg in all_segments:
        if not seg["text"].strip():
            blank_ids.append(seg["id"])
        else:
            non_blank.append(seg)
    stats.blank_removals = len(blank_ids)

    if progress_callback:
        await progress_callback(10)

    # Batch remaining segments with overlap
    combined = QualityReviewResult()
    combined.removed_segment_ids = list(blank_ids)

    total_batches = max(1, (len(non_blank) + BATCH_SIZE - 1) // BATCH_SIZE)
    seen_corrections: dict[str, float] = {}  # segment_id -> best confidence

    for batch_idx in range(total_batches):
        start = batch_idx * BATCH_SIZE
        # Add overlap from previous batch for context
        actual_start = max(0, start - OVERLAP) if batch_idx > 0 else 0
        end = min(len(non_blank), start + BATCH_SIZE)
        batch = non_blank[actual_start:end]

        if not batch:
            continue

        try:
            batch_result = await _run_batch(ai_service, batch, context_hint, aggressiveness)

            # Deduplicate corrections (keep higher confidence from overlaps)
            for corr in batch_result.corrected_segments:
                prev_conf = seen_corrections.get(corr.segment_id, -1)
                if corr.confidence > prev_conf:
                    # Remove old one if exists
                    combined.corrected_segments = [
                        c for c in combined.corrected_segments if c.segment_id != corr.segment_id
                    ]
                    combined.corrected_segments.append(corr)
                    seen_corrections[corr.segment_id] = corr.confidence

            for seg_id in batch_result.removed_segment_ids:
                if seg_id not in combined.removed_segment_ids:
                    combined.removed_segment_ids.append(seg_id)

            for merge in batch_result.merge_suggestions:
                # Only add if not already suggested
                merge_key = tuple(merge.segment_ids)
                existing_keys = {tuple(m.segment_ids) for m in combined.merge_suggestions}
                if merge_key not in existing_keys:
                    combined.merge_suggestions.append(merge)

        except Exception as e:
            logger.error("Batch %d failed: %s", batch_idx, e, exc_info=True)

        if progress_callback:
            batch_progress = 10 + (80 * (batch_idx + 1) / total_batches)
            await progress_callback(batch_progress)

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
        "merge_suggestions": [
            {
                "segment_ids": m.segment_ids,
                "merged_text": m.merged_text,
                "explanation": m.explanation,
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
