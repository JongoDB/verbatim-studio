"""Recording file management endpoints."""

import logging
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from persistence import get_db
from persistence.models import Recording
from services.jobs import job_queue
from services.storage import storage_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/recordings", tags=["recordings"])

# Allowed MIME types for audio/video uploads
ALLOWED_MIME_TYPES = {
    # Audio formats
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/wave",
    "audio/x-wav",
    "audio/ogg",
    "audio/flac",
    "audio/x-flac",
    "audio/aac",
    "audio/m4a",
    "audio/x-m4a",
    "audio/webm",
    # Video formats
    "video/mp4",
    "video/webm",
    "video/ogg",
    "video/quicktime",
    "video/x-msvideo",
    "video/x-matroska",
}

# Maximum file size (500 MB)
MAX_FILE_SIZE = 500 * 1024 * 1024


# Pydantic models for responses
class RecordingResponse(BaseModel):
    """Response model for a recording."""

    id: str
    project_id: str | None
    title: str
    file_path: str
    file_name: str
    file_size: int | None
    duration_seconds: float | None
    mime_type: str | None
    metadata: dict = Field(default_factory=dict)
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class RecordingListResponse(BaseModel):
    """Response model for paginated list of recordings."""

    items: list[RecordingResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class RecordingCreateResponse(BaseModel):
    """Response model for recording creation."""

    id: str
    title: str
    file_name: str
    file_size: int
    mime_type: str
    status: str
    created_at: datetime


class MessageResponse(BaseModel):
    """Response model for simple messages."""

    message: str
    id: str | None = None


class TranscribeResponse(BaseModel):
    """Response model for transcribe request."""

    job_id: str
    status: str


def _recording_to_response(recording: Recording) -> RecordingResponse:
    """Convert a Recording model to a response model."""
    return RecordingResponse(
        id=recording.id,
        project_id=recording.project_id,
        title=recording.title,
        file_path=recording.file_path,
        file_name=recording.file_name,
        file_size=recording.file_size,
        duration_seconds=recording.duration_seconds,
        mime_type=recording.mime_type,
        metadata=recording.metadata_ or {},
        status=recording.status,
        created_at=recording.created_at,
        updated_at=recording.updated_at,
    )


@router.get("", response_model=RecordingListResponse)
async def list_recordings(
    db: Annotated[AsyncSession, Depends(get_db)],
    page: Annotated[int, Query(ge=1, description="Page number")] = 1,
    page_size: Annotated[int, Query(ge=1, le=100, description="Items per page")] = 20,
    project_id: Annotated[str | None, Query(description="Filter by project ID")] = None,
) -> RecordingListResponse:
    """List all recordings with pagination.

    Args:
        db: Database session.
        page: Page number (1-indexed).
        page_size: Number of items per page.
        project_id: Optional project ID filter.

    Returns:
        Paginated list of recordings.
    """
    # Build base query
    query = select(Recording)

    if project_id is not None:
        query = query.where(Recording.project_id == project_id)

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Calculate pagination
    total_pages = (total + page_size - 1) // page_size if total > 0 else 1
    offset = (page - 1) * page_size

    # Get paginated results
    query = query.order_by(Recording.created_at.desc()).offset(offset).limit(page_size)
    result = await db.execute(query)
    recordings = result.scalars().all()

    return RecordingListResponse(
        items=[_recording_to_response(r) for r in recordings],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.post("/upload", response_model=RecordingCreateResponse, status_code=status.HTTP_201_CREATED)
async def upload_recording(
    db: Annotated[AsyncSession, Depends(get_db)],
    file: Annotated[UploadFile, File(description="Audio or video file to upload")],
    title: Annotated[str | None, Query(description="Recording title")] = None,
    project_id: Annotated[str | None, Query(description="Project ID to associate with")] = None,
) -> RecordingCreateResponse:
    """Upload an audio or video file.

    Args:
        db: Database session.
        file: The uploaded file.
        title: Optional title for the recording.
        project_id: Optional project ID.

    Returns:
        Created recording details.

    Raises:
        HTTPException: If file type is invalid or file is too large.
    """
    # Validate content type
    content_type = file.content_type or ""
    if content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported media type: {content_type}. Allowed types: audio/*, video/*",
        )

    # Read file content
    content = await file.read()
    file_size = len(content)

    # Validate file size
    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)} MB",
        )

    if file_size == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty",
        )

    # Sanitize filename to prevent path traversal attacks
    # First normalize backslashes to forward slashes (handles Windows-style paths on any OS)
    # Then use Path().name to get only the basename, stripping any directory components
    raw_filename = file.filename or "unknown"
    normalized_filename = raw_filename.replace("\\", "/")
    safe_filename = Path(normalized_filename).name
    # Additional safety: if filename is empty after sanitization, use a default
    if not safe_filename or safe_filename in (".", ".."):
        safe_filename = "unknown"

    # Create recording record first to get ID
    recording = Recording(
        title=title or safe_filename or "Untitled Recording",
        file_path="",  # Will be updated after saving
        file_name=safe_filename,
        file_size=file_size,
        mime_type=content_type,
        project_id=project_id,
        status="pending",
    )
    db.add(recording)
    await db.flush()  # Get the ID without committing

    # Save file to storage
    try:
        file_path = await storage_service.save_upload(
            content=content,
            recording_id=recording.id,
            filename=safe_filename,
        )
        recording.file_path = str(file_path)
        await db.commit()
    except Exception:
        await db.rollback()
        # Log the actual error for debugging, but return generic message to client
        logger.exception("Failed to save uploaded file for recording %s", recording.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save uploaded file. Please try again.",
        )

    return RecordingCreateResponse(
        id=recording.id,
        title=recording.title,
        file_name=recording.file_name,
        file_size=recording.file_size,
        mime_type=recording.mime_type,
        status=recording.status,
        created_at=recording.created_at,
    )


@router.get("/{recording_id}", response_model=RecordingResponse)
async def get_recording(
    recording_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RecordingResponse:
    """Get a recording by ID.

    Args:
        recording_id: The recording's unique ID.
        db: Database session.

    Returns:
        Recording details.

    Raises:
        HTTPException: If recording not found.
    """
    result = await db.execute(select(Recording).where(Recording.id == recording_id))
    recording = result.scalar_one_or_none()

    if recording is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Recording not found: {recording_id}",
        )

    return _recording_to_response(recording)


@router.get("/{recording_id}/audio")
async def stream_audio(
    recording_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FileResponse:
    """Stream the audio file for a recording.

    Args:
        recording_id: The recording's unique ID.
        db: Database session.

    Returns:
        Audio file stream.

    Raises:
        HTTPException: If recording or file not found.
    """
    result = await db.execute(select(Recording).where(Recording.id == recording_id))
    recording = result.scalar_one_or_none()

    if recording is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Recording not found: {recording_id}",
        )

    file_path = Path(recording.file_path)
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audio file not found on disk",
        )

    # Use stored mime_type or default to audio/mpeg
    media_type = recording.mime_type or "audio/mpeg"

    return FileResponse(
        path=file_path,
        media_type=media_type,
        filename=recording.file_name,
    )


@router.delete("/{recording_id}", response_model=MessageResponse)
async def delete_recording(
    recording_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MessageResponse:
    """Delete a recording and its associated file.

    Args:
        recording_id: The recording's unique ID.
        db: Database session.

    Returns:
        Confirmation message.

    Raises:
        HTTPException: If recording not found.
    """
    result = await db.execute(select(Recording).where(Recording.id == recording_id))
    recording = result.scalar_one_or_none()

    if recording is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Recording not found: {recording_id}",
        )

    # Delete the file from storage
    if recording.file_path:
        await storage_service.delete_file(recording.file_path)

    # Delete the database record
    await db.delete(recording)

    return MessageResponse(
        message="Recording deleted successfully",
        id=recording_id,
    )


@router.post("/{recording_id}/transcribe", response_model=TranscribeResponse)
async def transcribe_recording(
    recording_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    language: Annotated[str | None, Query(description="Language code (e.g., 'en', 'es')")] = None,
) -> TranscribeResponse:
    """Start transcription for a recording.

    Enqueues a transcription job for the specified recording.

    Args:
        recording_id: The recording's unique ID.
        db: Database session.
        language: Optional language code for transcription.

    Returns:
        Job ID and status.

    Raises:
        HTTPException: If recording not found or already processing.
    """
    result = await db.execute(select(Recording).where(Recording.id == recording_id))
    recording = result.scalar_one_or_none()

    if recording is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Recording not found: {recording_id}",
        )

    if recording.status == "processing":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Recording is already being processed",
        )

    # Enqueue transcription job
    payload = {"recording_id": recording_id}
    if language:
        payload["language"] = language

    job_id = await job_queue.enqueue("transcribe", payload)

    logger.info("Enqueued transcription job %s for recording %s", job_id, recording_id)

    return TranscribeResponse(
        job_id=job_id,
        status="queued",
    )
