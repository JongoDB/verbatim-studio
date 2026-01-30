"""Project analytics endpoints."""

import re
from collections import Counter
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from persistence.database import get_db
from persistence.models import Project, ProjectRecording, Recording, Segment, Transcript

router = APIRouter(prefix="/projects", tags=["project-analytics"])

# Common stop words to filter out
STOP_WORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of",
    "with", "by", "from", "as", "is", "was", "are", "were", "been", "be", "have",
    "has", "had", "do", "does", "did", "will", "would", "could", "should", "may",
    "might", "must", "shall", "can", "need", "dare", "ought", "used", "it", "its",
    "this", "that", "these", "those", "i", "you", "he", "she", "we", "they", "me",
    "him", "her", "us", "them", "my", "your", "his", "our", "their", "mine", "yours",
    "hers", "ours", "theirs", "what", "which", "who", "whom", "whose", "where",
    "when", "why", "how", "all", "each", "every", "both", "few", "more", "most",
    "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so",
    "than", "too", "very", "just", "also", "now", "here", "there", "then", "once",
    "if", "because", "until", "while", "although", "though", "after", "before",
    "since", "unless", "even", "about", "into", "through", "during", "out", "over",
    "under", "again", "further", "then", "once", "up", "down", "off", "away",
    "um", "uh", "like", "yeah", "okay", "ok", "right", "well", "so", "just", "know",
    "think", "got", "going", "get", "go", "come", "see", "want", "say", "said",
}


class RecordingStats(BaseModel):
    """Stats about recordings in the project."""

    total: int
    completed: int
    failed: int
    pending: int
    processing: int


class TimelineEntry(BaseModel):
    """A single date with its recordings."""

    date: str
    count: int
    recording_ids: list[str]


class WordFrequency(BaseModel):
    """A word and its frequency."""

    word: str
    count: int


class ProjectAnalytics(BaseModel):
    """Analytics data for a project."""

    recording_stats: RecordingStats
    total_duration_seconds: float
    recording_timeline: list[TimelineEntry]
    word_frequency: list[WordFrequency]


@router.get("/{project_id}/analytics", response_model=ProjectAnalytics)
async def get_project_analytics(
    db: Annotated[AsyncSession, Depends(get_db)],
    project_id: str,
) -> ProjectAnalytics:
    """Get analytics for a project."""
    # Verify project exists
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Get all recordings for this project with transcripts and segments
    result = await db.execute(
        select(Recording)
        .join(ProjectRecording, ProjectRecording.recording_id == Recording.id)
        .where(ProjectRecording.project_id == project_id)
        .options(
            selectinload(Recording.transcript).selectinload(Transcript.segments)
        )
        .order_by(Recording.created_at.desc())
    )
    recordings = result.scalars().all()

    # Calculate recording stats
    status_counts = Counter(r.status for r in recordings)
    recording_stats = RecordingStats(
        total=len(recordings),
        completed=status_counts.get("completed", 0),
        failed=status_counts.get("failed", 0),
        pending=status_counts.get("pending", 0),
        processing=status_counts.get("processing", 0),
    )

    # Calculate total duration
    total_duration = sum(r.duration_seconds or 0 for r in recordings)

    # Build timeline (group by date)
    timeline_dict: dict[str, list[str]] = {}
    for recording in recordings:
        date_str = recording.created_at.strftime("%Y-%m-%d")
        if date_str not in timeline_dict:
            timeline_dict[date_str] = []
        timeline_dict[date_str].append(recording.id)

    recording_timeline = [
        TimelineEntry(date=date, count=len(ids), recording_ids=ids)
        for date, ids in sorted(timeline_dict.items(), reverse=True)
    ]

    # Calculate word frequency from all segments
    word_counter: Counter[str] = Counter()

    for recording in recordings:
        if not recording.transcript:
            continue
        for segment in recording.transcript.segments:
            words = re.findall(r"\b[a-zA-Z]{3,}\b", segment.text.lower())
            for word in words:
                if word not in STOP_WORDS:
                    word_counter[word] += 1

    # Get top 50 words
    word_frequency = [
        WordFrequency(word=word, count=count)
        for word, count in word_counter.most_common(50)
    ]

    return ProjectAnalytics(
        recording_stats=recording_stats,
        total_duration_seconds=total_duration,
        recording_timeline=recording_timeline,
        word_frequency=word_frequency,
    )
