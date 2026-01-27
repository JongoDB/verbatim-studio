"""SQLAlchemy models."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Base class for all models."""

    pass


def generate_uuid() -> str:
    """Generate a UUID string."""
    return str(uuid.uuid4())


class Project(Base):
    """Project model for organizing recordings."""

    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    recordings: Mapped[list["Recording"]] = relationship(back_populates="project")


class Tag(Base):
    """Tag model for categorizing recordings."""

    __tablename__ = "tags"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    color: Mapped[str | None] = mapped_column(String(7))  # "#FF5733"
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    recordings: Mapped[list["Recording"]] = relationship(
        secondary="recording_tags", back_populates="tags"
    )


class RecordingTag(Base):
    """Junction table for recording-tag many-to-many relationship."""

    __tablename__ = "recording_tags"

    recording_id: Mapped[str] = mapped_column(
        ForeignKey("recordings.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[str] = mapped_column(
        ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True
    )


class Recording(Base):
    """Recording model for audio/video files."""

    __tablename__ = "recordings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int | None] = mapped_column(Integer)
    duration_seconds: Mapped[float | None] = mapped_column(Float)
    mime_type: Mapped[str | None] = mapped_column(String(100))
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    project: Mapped[Project | None] = relationship(back_populates="recordings")
    transcript: Mapped["Transcript | None"] = relationship(
        back_populates="recording", uselist=False, cascade="all, delete-orphan"
    )
    tags: Mapped[list[Tag]] = relationship(
        secondary="recording_tags", back_populates="recordings"
    )


class Transcript(Base):
    """Transcript model linked to recordings."""

    __tablename__ = "transcripts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    recording_id: Mapped[str] = mapped_column(
        ForeignKey("recordings.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    language: Mapped[str | None] = mapped_column(String(10))
    model_used: Mapped[str | None] = mapped_column(String(50))
    confidence_avg: Mapped[float | None] = mapped_column(Float)
    word_count: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    recording: Mapped[Recording] = relationship(back_populates="transcript")
    segments: Mapped[list["Segment"]] = relationship(
        back_populates="transcript", cascade="all, delete-orphan"
    )
    speakers: Mapped[list["Speaker"]] = relationship(
        back_populates="transcript", cascade="all, delete-orphan"
    )


class Speaker(Base):
    """Speaker mapping for transcript diarization."""

    __tablename__ = "speakers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    transcript_id: Mapped[str] = mapped_column(
        ForeignKey("transcripts.id", ondelete="CASCADE"), nullable=False
    )
    speaker_label: Mapped[str] = mapped_column(String(50), nullable=False)  # "SPEAKER_00"
    speaker_name: Mapped[str | None] = mapped_column(String(255))  # "John Smith"
    color: Mapped[str | None] = mapped_column(String(7))  # "#FF5733"

    transcript: Mapped[Transcript] = relationship(back_populates="speakers")


class Segment(Base):
    """Segment model for transcript utterances."""

    __tablename__ = "segments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    transcript_id: Mapped[str] = mapped_column(
        ForeignKey("transcripts.id", ondelete="CASCADE"), nullable=False
    )
    segment_index: Mapped[int] = mapped_column(Integer, nullable=False)
    speaker: Mapped[str | None] = mapped_column(String(100))
    start_time: Mapped[float] = mapped_column(Float, nullable=False)
    end_time: Mapped[float] = mapped_column(Float, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float)
    edited: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    transcript: Mapped[Transcript] = relationship(back_populates="segments")
    comments: Mapped[list["SegmentComment"]] = relationship(
        back_populates="segment", cascade="all, delete-orphan"
    )
    highlight: Mapped["SegmentHighlight | None"] = relationship(
        back_populates="segment", uselist=False, cascade="all, delete-orphan"
    )


class SegmentComment(Base):
    """Comment on a transcript segment."""

    __tablename__ = "segment_comments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    segment_id: Mapped[str] = mapped_column(
        ForeignKey("segments.id", ondelete="CASCADE"), nullable=False
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    segment: Mapped[Segment] = relationship(back_populates="comments")


class SegmentHighlight(Base):
    """Highlight color for a transcript segment. One per segment."""

    __tablename__ = "segment_highlights"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    segment_id: Mapped[str] = mapped_column(
        ForeignKey("segments.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    color: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    segment: Mapped[Segment] = relationship(back_populates="highlight")


class Job(Base):
    """Job queue model for async tasks."""

    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    job_type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="queued")
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    result: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)
    progress: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    started_at: Mapped[datetime | None] = mapped_column()
    completed_at: Mapped[datetime | None] = mapped_column()


class Setting(Base):
    """Application settings model."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())
