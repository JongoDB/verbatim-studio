"""Database persistence layer."""

from .database import get_db, init_db
from .models import (
    Base,
    Job,
    Project,
    ProjectType,
    Recording,
    RecordingTemplate,
    RecordingTag,
    Segment,
    SegmentComment,
    SegmentEmbedding,
    SegmentHighlight,
    Setting,
    Speaker,
    StorageLocation,
    Tag,
    Transcript,
)

__all__ = [
    "get_db",
    "init_db",
    "Base",
    "Job",
    "Project",
    "ProjectType",
    "Recording",
    "RecordingTemplate",
    "RecordingTag",
    "Segment",
    "SegmentComment",
    "SegmentEmbedding",
    "SegmentHighlight",
    "Setting",
    "Speaker",
    "StorageLocation",
    "Tag",
    "Transcript",
]
