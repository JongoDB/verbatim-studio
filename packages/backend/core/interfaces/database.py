"""Database adapter interface definitions.

This module defines the contracts for database operations,
allowing different implementations (SQLite, PostgreSQL, etc.)
to be swapped transparently.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Generic, TypeVar

# Generic type for entities
T = TypeVar("T")


@dataclass
class ProjectEntity:
    """Project domain entity."""

    id: str
    name: str
    description: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass
class RecordingEntity:
    """Recording domain entity."""

    id: str
    title: str
    file_path: str
    file_name: str
    project_id: str | None = None
    file_size: int | None = None
    duration_seconds: float | None = None
    mime_type: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    status: str = "pending"
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass
class TranscriptEntity:
    """Transcript domain entity."""

    id: str
    recording_id: str
    language: str | None = None
    model_used: str | None = None
    confidence_avg: float | None = None
    word_count: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass
class SegmentEntity:
    """Transcript segment domain entity."""

    id: str
    transcript_id: str
    segment_index: int
    start_time: float
    end_time: float
    text: str
    speaker: str | None = None
    confidence: float | None = None
    edited: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass
class SpeakerEntity:
    """Speaker domain entity."""

    id: str
    transcript_id: str
    speaker_label: str
    speaker_name: str | None = None
    color: str | None = None


@dataclass
class JobEntity:
    """Job queue domain entity."""

    id: str
    job_type: str
    payload: dict[str, Any]
    status: str = "queued"
    result: dict[str, Any] | None = None
    error: str | None = None
    progress: float = 0.0
    created_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None


@dataclass
class SettingEntity:
    """Setting domain entity."""

    key: str
    value: dict[str, Any]
    updated_at: datetime | None = None


@dataclass
class PaginatedResult(Generic[T]):
    """Paginated query result."""

    items: list[T]
    total: int
    page: int
    page_size: int

    @property
    def total_pages(self) -> int:
        """Calculate total number of pages."""
        return (self.total + self.page_size - 1) // self.page_size if self.page_size > 0 else 0


class IProjectRepository(ABC):
    """Interface for project data operations."""

    @abstractmethod
    async def create(self, entity: ProjectEntity) -> ProjectEntity:
        """Create a new project."""
        ...

    @abstractmethod
    async def get(self, project_id: str) -> ProjectEntity | None:
        """Get a project by ID."""
        ...

    @abstractmethod
    async def list(
        self,
        page: int = 1,
        page_size: int = 20,
        search: str | None = None,
    ) -> PaginatedResult[ProjectEntity]:
        """List projects with pagination."""
        ...

    @abstractmethod
    async def update(self, entity: ProjectEntity) -> ProjectEntity:
        """Update a project."""
        ...

    @abstractmethod
    async def delete(self, project_id: str) -> bool:
        """Delete a project. Returns True if deleted."""
        ...


class IRecordingRepository(ABC):
    """Interface for recording data operations."""

    @abstractmethod
    async def create(self, entity: RecordingEntity) -> RecordingEntity:
        """Create a new recording."""
        ...

    @abstractmethod
    async def get(self, recording_id: str) -> RecordingEntity | None:
        """Get a recording by ID."""
        ...

    @abstractmethod
    async def list(
        self,
        page: int = 1,
        page_size: int = 20,
        project_id: str | None = None,
        status: str | None = None,
        search: str | None = None,
    ) -> PaginatedResult[RecordingEntity]:
        """List recordings with pagination and filters."""
        ...

    @abstractmethod
    async def update(self, entity: RecordingEntity) -> RecordingEntity:
        """Update a recording."""
        ...

    @abstractmethod
    async def delete(self, recording_id: str) -> bool:
        """Delete a recording. Returns True if deleted."""
        ...


class ITranscriptRepository(ABC):
    """Interface for transcript data operations."""

    @abstractmethod
    async def create(self, entity: TranscriptEntity) -> TranscriptEntity:
        """Create a new transcript."""
        ...

    @abstractmethod
    async def get(self, transcript_id: str) -> TranscriptEntity | None:
        """Get a transcript by ID."""
        ...

    @abstractmethod
    async def get_by_recording(self, recording_id: str) -> TranscriptEntity | None:
        """Get transcript for a recording."""
        ...

    @abstractmethod
    async def update(self, entity: TranscriptEntity) -> TranscriptEntity:
        """Update a transcript."""
        ...

    @abstractmethod
    async def delete(self, transcript_id: str) -> bool:
        """Delete a transcript. Returns True if deleted."""
        ...


class ISegmentRepository(ABC):
    """Interface for segment data operations."""

    @abstractmethod
    async def create(self, entity: SegmentEntity) -> SegmentEntity:
        """Create a new segment."""
        ...

    @abstractmethod
    async def create_many(self, entities: list[SegmentEntity]) -> list[SegmentEntity]:
        """Create multiple segments efficiently."""
        ...

    @abstractmethod
    async def get(self, segment_id: str) -> SegmentEntity | None:
        """Get a segment by ID."""
        ...

    @abstractmethod
    async def list_by_transcript(
        self,
        transcript_id: str,
        page: int = 1,
        page_size: int = 100,
    ) -> PaginatedResult[SegmentEntity]:
        """List segments for a transcript."""
        ...

    @abstractmethod
    async def update(self, entity: SegmentEntity) -> SegmentEntity:
        """Update a segment."""
        ...

    @abstractmethod
    async def delete(self, segment_id: str) -> bool:
        """Delete a segment. Returns True if deleted."""
        ...

    @abstractmethod
    async def search(
        self,
        query: str,
        transcript_id: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> PaginatedResult[SegmentEntity]:
        """Full-text search across segments."""
        ...


class ISpeakerRepository(ABC):
    """Interface for speaker data operations."""

    @abstractmethod
    async def create(self, entity: SpeakerEntity) -> SpeakerEntity:
        """Create a new speaker."""
        ...

    @abstractmethod
    async def create_many(self, entities: list[SpeakerEntity]) -> list[SpeakerEntity]:
        """Create multiple speakers efficiently."""
        ...

    @abstractmethod
    async def get(self, speaker_id: str) -> SpeakerEntity | None:
        """Get a speaker by ID."""
        ...

    @abstractmethod
    async def list_by_transcript(self, transcript_id: str) -> list[SpeakerEntity]:
        """List speakers for a transcript."""
        ...

    @abstractmethod
    async def update(self, entity: SpeakerEntity) -> SpeakerEntity:
        """Update a speaker."""
        ...

    @abstractmethod
    async def delete(self, speaker_id: str) -> bool:
        """Delete a speaker. Returns True if deleted."""
        ...


class IJobRepository(ABC):
    """Interface for job queue data operations."""

    @abstractmethod
    async def create(self, entity: JobEntity) -> JobEntity:
        """Create a new job."""
        ...

    @abstractmethod
    async def get(self, job_id: str) -> JobEntity | None:
        """Get a job by ID."""
        ...

    @abstractmethod
    async def list(
        self,
        page: int = 1,
        page_size: int = 20,
        status: str | None = None,
        job_type: str | None = None,
    ) -> PaginatedResult[JobEntity]:
        """List jobs with filters."""
        ...

    @abstractmethod
    async def get_next_pending(self, job_type: str | None = None) -> JobEntity | None:
        """Get the next pending job to process."""
        ...

    @abstractmethod
    async def update(self, entity: JobEntity) -> JobEntity:
        """Update a job."""
        ...

    @abstractmethod
    async def delete(self, job_id: str) -> bool:
        """Delete a job. Returns True if deleted."""
        ...


class ISettingRepository(ABC):
    """Interface for settings data operations."""

    @abstractmethod
    async def get(self, key: str) -> SettingEntity | None:
        """Get a setting by key."""
        ...

    @abstractmethod
    async def set(self, entity: SettingEntity) -> SettingEntity:
        """Set a setting (create or update)."""
        ...

    @abstractmethod
    async def delete(self, key: str) -> bool:
        """Delete a setting. Returns True if deleted."""
        ...

    @abstractmethod
    async def list_all(self) -> list[SettingEntity]:
        """List all settings."""
        ...


class IDatabaseAdapter(ABC):
    """Main database adapter interface.

    Provides access to all repositories and manages database lifecycle.
    """

    @property
    @abstractmethod
    def projects(self) -> IProjectRepository:
        """Get the project repository."""
        ...

    @property
    @abstractmethod
    def recordings(self) -> IRecordingRepository:
        """Get the recording repository."""
        ...

    @property
    @abstractmethod
    def transcripts(self) -> ITranscriptRepository:
        """Get the transcript repository."""
        ...

    @property
    @abstractmethod
    def segments(self) -> ISegmentRepository:
        """Get the segment repository."""
        ...

    @property
    @abstractmethod
    def speakers(self) -> ISpeakerRepository:
        """Get the speaker repository."""
        ...

    @property
    @abstractmethod
    def jobs(self) -> IJobRepository:
        """Get the job repository."""
        ...

    @property
    @abstractmethod
    def settings(self) -> ISettingRepository:
        """Get the settings repository."""
        ...

    @abstractmethod
    async def initialize(self) -> None:
        """Initialize the database (create tables, run migrations, etc.)."""
        ...

    @abstractmethod
    async def close(self) -> None:
        """Close database connections and cleanup."""
        ...

    @abstractmethod
    async def health_check(self) -> bool:
        """Check if database is healthy and accessible."""
        ...
