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
from persistence.models import Project, ProjectRecording, Recording, RecordingTag, Segment, Tag, Transcript

router = APIRouter(prefix="/projects", tags=["project-analytics"])

# Common stop words to filter out (including contractions)
STOP_WORDS = {
    # Articles, conjunctions, prepositions
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
    # Common contractions
    "don't", "can't", "won't", "didn't", "doesn't", "isn't", "aren't", "wasn't",
    "weren't", "haven't", "hasn't", "hadn't", "wouldn't", "couldn't", "shouldn't",
    "it's", "that's", "what's", "there's", "here's", "i'm", "you're", "we're",
    "they're", "i've", "you've", "we've", "they've", "i'll", "you'll", "we'll",
    "they'll", "i'd", "you'd", "we'd", "they'd", "let's", "ain't", "y'all",
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


class InheritedTag(BaseModel):
    """A tag inherited from recordings."""

    id: str
    name: str
    color: str | None
    recording_count: int


class ProjectAnalytics(BaseModel):
    """Analytics data for a project."""

    recording_stats: RecordingStats
    total_duration_seconds: float
    avg_duration_seconds: float | None
    total_word_count: int
    avg_confidence: float | None
    recording_timeline: list[TimelineEntry]
    word_frequency: list[WordFrequency]
    inherited_tags: list[InheritedTag]


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

    # Calculate total and average duration
    durations = [r.duration_seconds for r in recordings if r.duration_seconds]
    total_duration = sum(durations)
    avg_duration = sum(durations) / len(durations) if durations else None

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

    # Calculate word frequency and stats from all segments
    word_counter: Counter[str] = Counter()
    total_word_count = 0
    confidence_scores: list[float] = []

    for recording in recordings:
        if not recording.transcript:
            continue
        for segment in recording.transcript.segments:
            # Match words including contractions (e.g., "don't", "I'm")
            words = re.findall(r"\b[a-zA-Z]+(?:'[a-zA-Z]+)?\b", segment.text.lower())
            total_word_count += len(words)
            for word in words:
                if len(word) >= 3 and word not in STOP_WORDS:
                    word_counter[word] += 1
            # Collect confidence scores
            if segment.confidence is not None:
                confidence_scores.append(segment.confidence)

    # Calculate average confidence
    avg_confidence = (
        sum(confidence_scores) / len(confidence_scores) if confidence_scores else None
    )

    # Get top 50 words
    word_frequency = [
        WordFrequency(word=word, count=count)
        for word, count in word_counter.most_common(50)
    ]

    # Compute inherited tags from recordings
    recording_ids = [r.id for r in recordings]
    inherited_tags: list[InheritedTag] = []
    if recording_ids:
        # Get all tags associated with recordings in this project
        result = await db.execute(
            select(Tag, RecordingTag.recording_id)
            .join(RecordingTag, RecordingTag.tag_id == Tag.id)
            .where(RecordingTag.recording_id.in_(recording_ids))
        )
        tag_recordings = result.all()

        # Count recordings per tag
        tag_counts: dict[str, tuple[Tag, int]] = {}
        for tag, _recording_id in tag_recordings:
            if tag.id not in tag_counts:
                tag_counts[tag.id] = (tag, 0)
            existing_tag, count = tag_counts[tag.id]
            tag_counts[tag.id] = (existing_tag, count + 1)

        # Convert to InheritedTag list, sorted by recording count descending
        inherited_tags = sorted(
            [
                InheritedTag(
                    id=tag.id,
                    name=tag.name,
                    color=tag.color,
                    recording_count=count,
                )
                for tag, count in tag_counts.values()
            ],
            key=lambda t: (-t.recording_count, t.name),
        )

    return ProjectAnalytics(
        recording_stats=recording_stats,
        total_duration_seconds=total_duration,
        avg_duration_seconds=avg_duration,
        total_word_count=total_word_count,
        avg_confidence=avg_confidence,
        recording_timeline=recording_timeline,
        word_frequency=word_frequency,
        inherited_tags=inherited_tags,
    )
