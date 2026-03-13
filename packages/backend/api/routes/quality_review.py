"""Quality review API endpoints."""

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from persistence import get_db
from persistence.models import QualityReviewRecord, Segment, Transcript
from services.jobs import job_queue

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/quality-review", tags=["quality-review"])


# --- Request / Response models ---


class StartReviewRequest(BaseModel):
    context_hint: str | None = None
    aggressiveness: str = "moderate"


class StartReviewResponse(BaseModel):
    job_id: str


class QualityReviewRecordResponse(BaseModel):
    id: str
    transcript_id: str
    job_id: str | None
    status: str
    context_hint: str | None
    aggressiveness: str
    corrections_json: dict | None
    stats_json: dict | None
    applied_at: str | None
    created_at: str

    class Config:
        from_attributes = True


class ApplySelectionsRequest(BaseModel):
    accepted_correction_ids: list[str] = []
    accepted_removal_ids: list[str] = []
    accepted_merge_indexes: list[int] = []


class ApplyResponse(BaseModel):
    applied_corrections: int
    applied_removals: int
    applied_merges: int
    already_removed: int = 0


# --- Endpoints ---


@router.post("/{transcript_id}/start", response_model=StartReviewResponse)
async def start_quality_review(
    transcript_id: str,
    request: StartReviewRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> StartReviewResponse:
    """Enqueue an AI quality review job for a transcript."""
    # Verify transcript exists
    result = await db.execute(select(Transcript).where(Transcript.id == transcript_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transcript not found")

    if request.aggressiveness not in ("conservative", "moderate", "aggressive"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid aggressiveness level")

    job_id = await job_queue.enqueue(
        "quality_review",
        {
            "transcript_id": transcript_id,
            "context_hint": request.context_hint,
            "aggressiveness": request.aggressiveness,
        },
    )
    return StartReviewResponse(job_id=job_id)


@router.get("/{transcript_id}/{job_id}", response_model=QualityReviewRecordResponse)
async def get_quality_review(
    transcript_id: str,
    job_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> QualityReviewRecordResponse:
    """Get the quality review record for a given job."""
    result = await db.execute(
        select(QualityReviewRecord).where(
            QualityReviewRecord.transcript_id == transcript_id,
            QualityReviewRecord.job_id == job_id,
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quality review record not found")

    return QualityReviewRecordResponse(
        id=record.id,
        transcript_id=record.transcript_id,
        job_id=record.job_id,
        status=record.status,
        context_hint=record.context_hint,
        aggressiveness=record.aggressiveness,
        corrections_json=record.corrections_json,
        stats_json=record.stats_json,
        applied_at=record.applied_at.isoformat() if record.applied_at else None,
        created_at=record.created_at.isoformat() if record.created_at else "",
    )


@router.get("/{transcript_id}/latest", response_model=QualityReviewRecordResponse | None)
async def get_latest_quality_review(
    transcript_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Get the most recent quality review record for a transcript."""
    result = await db.execute(
        select(QualityReviewRecord)
        .where(QualityReviewRecord.transcript_id == transcript_id)
        .order_by(QualityReviewRecord.created_at.desc())
        .limit(1)
    )
    record = result.scalar_one_or_none()
    if record is None:
        return None

    return QualityReviewRecordResponse(
        id=record.id,
        transcript_id=record.transcript_id,
        job_id=record.job_id,
        status=record.status,
        context_hint=record.context_hint,
        aggressiveness=record.aggressiveness,
        corrections_json=record.corrections_json,
        stats_json=record.stats_json,
        applied_at=record.applied_at.isoformat() if record.applied_at else None,
        created_at=record.created_at.isoformat() if record.created_at else "",
    )


async def _apply_corrections(
    db: AsyncSession,
    record: QualityReviewRecord,
    accepted_correction_ids: list[str],
    accepted_removal_ids: list[str],
    accepted_merge_indexes: list[int],
) -> ApplyResponse:
    """Shared logic for applying selected corrections."""
    corrections_data = record.corrections_json or {}
    applied_corrections = 0
    applied_removals = 0
    applied_merges = 0
    already_removed = 0

    logger.info(
        "Applying corrections: %d edits, %d removals, %d merges available; "
        "accepted: %d edits, %d removals, %d merges",
        len(corrections_data.get("corrected_segments", [])),
        len(corrections_data.get("removed_segment_ids", [])),
        len(corrections_data.get("merge_suggestions", [])),
        len(accepted_correction_ids),
        len(accepted_removal_ids),
        len(accepted_merge_indexes),
    )

    # Apply text corrections
    for corr in corrections_data.get("corrected_segments", []):
        seg_id = corr.get("segment_id")
        if seg_id not in accepted_correction_ids:
            continue

        seg_result = await db.execute(select(Segment).where(Segment.id == seg_id))
        segment = seg_result.scalar_one_or_none()
        if segment is None:
            continue

        segment.original_text = segment.text
        segment.text = corr["corrected_text"]
        segment.edited_by = "ai"
        applied_corrections += 1

    # Apply removals
    removal_ids_in_data = corrections_data.get("removed_segment_ids", [])
    skipped_removals = 0
    for seg_id in removal_ids_in_data:
        if seg_id not in accepted_removal_ids:
            skipped_removals += 1
            continue

        seg_result = await db.execute(select(Segment).where(Segment.id == seg_id))
        segment = seg_result.scalar_one_or_none()
        if segment is None:
            # Segment was already deleted (likely by a previous review apply)
            already_removed += 1
            continue

        await db.delete(segment)
        applied_removals += 1
    if already_removed > 0:
        logger.info("Removals: %d applied, %d already removed (prior apply), %d skipped",
                     applied_removals, already_removed, skipped_removals)

    # Apply merges
    for idx, merge in enumerate(corrections_data.get("merge_suggestions", [])):
        if idx not in accepted_merge_indexes:
            continue

        merge_ids = merge.get("segment_ids", [])
        if len(merge_ids) < 2:
            continue

        # Get all segments in the merge
        segs_result = await db.execute(
            select(Segment).where(Segment.id.in_(merge_ids)).order_by(Segment.segment_index)
        )
        merge_segments = segs_result.scalars().all()
        if len(merge_segments) < 2:
            continue

        # Update primary segment (first) with merged text and end time
        primary = merge_segments[0]
        primary.original_text = primary.text
        primary.text = merge["merged_text"]
        primary.end_time = merge_segments[-1].end_time
        primary.edited_by = "ai"

        # Delete the rest
        for seg in merge_segments[1:]:
            await db.delete(seg)

        applied_merges += 1

    # Update record status — count already_removed as "applied" for status purposes
    has_any = applied_corrections > 0 or applied_removals > 0 or applied_merges > 0 or already_removed > 0
    total_available = (
        len(corrections_data.get("corrected_segments", []))
        + len(corrections_data.get("removed_segment_ids", []))
        + len(corrections_data.get("merge_suggestions", []))
    )
    total_applied = applied_corrections + applied_removals + already_removed + applied_merges

    if has_any:
        record.status = "applied" if total_applied >= total_available else "partially_applied"
        record.applied_at = datetime.now(UTC)

    await db.commit()

    logger.info(
        "Applied: %d corrections, %d removals (%d already removed), %d merges (status=%s)",
        applied_corrections, applied_removals, already_removed, applied_merges, record.status,
    )

    return ApplyResponse(
        applied_corrections=applied_corrections,
        applied_removals=applied_removals,
        applied_merges=applied_merges,
        already_removed=already_removed,
    )


@router.post("/{transcript_id}/{job_id}/apply", response_model=ApplyResponse)
async def apply_selections(
    transcript_id: str,
    job_id: str,
    request: ApplySelectionsRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApplyResponse:
    """Apply selected corrections from a quality review."""
    result = await db.execute(
        select(QualityReviewRecord).where(
            QualityReviewRecord.transcript_id == transcript_id,
            QualityReviewRecord.job_id == job_id,
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quality review record not found")

    return await _apply_corrections(
        db,
        record,
        request.accepted_correction_ids,
        request.accepted_removal_ids,
        request.accepted_merge_indexes,
    )


@router.post("/{transcript_id}/{job_id}/apply-all", response_model=ApplyResponse)
async def apply_all(
    transcript_id: str,
    job_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApplyResponse:
    """Apply all corrections from a quality review."""
    result = await db.execute(
        select(QualityReviewRecord).where(
            QualityReviewRecord.transcript_id == transcript_id,
            QualityReviewRecord.job_id == job_id,
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quality review record not found")

    corrections_data = record.corrections_json or {}

    # Accept everything
    all_correction_ids = [c["segment_id"] for c in corrections_data.get("corrected_segments", [])]
    all_removal_ids = corrections_data.get("removed_segment_ids", [])
    all_merge_indexes = list(range(len(corrections_data.get("merge_suggestions", []))))

    return await _apply_corrections(
        db, record, all_correction_ids, all_removal_ids, all_merge_indexes
    )
