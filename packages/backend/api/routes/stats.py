"""Statistics endpoints for dashboard."""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from persistence.database import get_db
from persistence.models import Recording, Transcript, Segment

router = APIRouter(prefix="/stats", tags=["stats"])


class RecordingStats(BaseModel):
    """Statistics about recordings."""

    total_recordings: int
    total_duration_seconds: float
    by_status: dict[str, int]
    avg_duration_seconds: float | None


class TranscriptionStats(BaseModel):
    """Statistics about transcriptions."""

    total_transcripts: int
    total_segments: int
    total_words: int
    languages: dict[str, int]


class DashboardStats(BaseModel):
    """Combined dashboard statistics."""

    recordings: RecordingStats
    transcriptions: TranscriptionStats


@router.get("", response_model=DashboardStats)
async def get_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DashboardStats:
    """Get dashboard statistics."""

    # Recording stats
    recording_result = await db.execute(
        select(
            func.count(Recording.id).label("total"),
            func.sum(Recording.duration_seconds).label("total_duration"),
            func.avg(Recording.duration_seconds).label("avg_duration"),
        )
    )
    recording_row = recording_result.one()

    # Recordings by status
    status_result = await db.execute(
        select(
            Recording.status,
            func.count(Recording.id).label("count"),
        ).group_by(Recording.status)
    )
    status_counts = {row.status: row.count for row in status_result.all()}

    # Transcript stats
    transcript_result = await db.execute(
        select(
            func.count(Transcript.id).label("total"),
            func.sum(Transcript.word_count).label("total_words"),
        )
    )
    transcript_row = transcript_result.one()

    # Segment count
    segment_count_result = await db.execute(select(func.count(Segment.id)))
    segment_count = segment_count_result.scalar() or 0

    # Languages breakdown
    language_result = await db.execute(
        select(
            Transcript.language,
            func.count(Transcript.id).label("count"),
        )
        .where(Transcript.language.is_not(None))
        .group_by(Transcript.language)
    )
    language_counts = {row.language: row.count for row in language_result.all()}

    return DashboardStats(
        recordings=RecordingStats(
            total_recordings=recording_row.total or 0,
            total_duration_seconds=recording_row.total_duration or 0.0,
            by_status=status_counts,
            avg_duration_seconds=recording_row.avg_duration,
        ),
        transcriptions=TranscriptionStats(
            total_transcripts=transcript_row.total or 0,
            total_segments=segment_count,
            total_words=transcript_row.total_words or 0,
            languages=language_counts,
        ),
    )
