"""Recording file management endpoints."""

import asyncio
import io
import logging
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from persistence import get_db
from persistence.models import Recording, RecordingTag, Speaker, Tag, Transcript
from services.jobs import job_queue
from services.storage import storage_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/recordings", tags=["recordings"])


VIDEO_MIME_PREFIXES = ("video/",)


def _is_video(mime_type: str | None) -> bool:
    """Check if a MIME type is a video format."""
    return mime_type is not None and mime_type.startswith(VIDEO_MIME_PREFIXES)


def _extract_duration(content: bytes, filename: str) -> float | None:
    """Extract audio/video duration in seconds using mutagen."""
    try:
        from mutagen import File as MutagenFile

        audio = MutagenFile(io.BytesIO(content), filename=filename)
        if audio is not None and audio.info is not None:
            return round(audio.info.length, 2)
    except Exception:
        logger.debug("Could not extract duration from %s", filename)
    return None


async def _extract_audio_from_video(video_path: Path) -> Path | None:
    """Extract audio track from a video file using ffmpeg.

    Uses asyncio.create_subprocess_exec (no shell) for safety.
    Returns the path to the extracted WAV file, or None if extraction fails.
    """
    audio_path = video_path.parent / "audio.wav"
    try:
        process = await asyncio.create_subprocess_exec(
            "ffmpeg", "-i", str(video_path),
            "-vn",             # no video
            "-acodec", "pcm_s16le",  # 16-bit PCM
            "-ar", "16000",    # 16kHz (WhisperX optimal)
            "-ac", "1",        # mono
            "-y",              # overwrite
            str(audio_path),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await process.communicate()
        if process.returncode == 0 and audio_path.exists():
            logger.info("Extracted audio from %s -> %s", video_path.name, audio_path.name)
            return audio_path
        logger.warning("ffmpeg failed (exit %d): %s", process.returncode, stderr.decode()[:500])
    except FileNotFoundError:
        logger.warning("ffmpeg not found — video audio extraction unavailable")
    except Exception:
        logger.exception("Failed to extract audio from %s", video_path.name)
    return None


def _get_extracted_audio_path(recording_path: str) -> Path | None:
    """Get the extracted audio.wav path for a recording, if it exists."""
    audio_path = Path(recording_path).parent / "audio.wav"
    return audio_path if audio_path.exists() else None

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
    "audio/mp4",  # Browser recording fallback
    "audio/webm",
    "audio/webm;codecs=opus",  # Browser recording format
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
    tag_ids: list[str] = Field(default_factory=list)
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


def _recording_to_response(recording: Recording, tag_ids: list[str] | None = None) -> RecordingResponse:
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
        tag_ids=tag_ids if tag_ids is not None else [],
        created_at=recording.created_at,
        updated_at=recording.updated_at,
    )


@router.get("", response_model=RecordingListResponse)
async def list_recordings(
    db: Annotated[AsyncSession, Depends(get_db)],
    page: Annotated[int, Query(ge=1, description="Page number")] = 1,
    page_size: Annotated[int, Query(ge=1, le=100, description="Items per page")] = 20,
    project_id: Annotated[str | None, Query(description="Filter by project ID")] = None,
    status: Annotated[str | None, Query(description="Filter by status (pending, processing, completed, failed)")] = None,
    search: Annotated[str | None, Query(description="Search by title or filename")] = None,
    sort_by: Annotated[str, Query(description="Sort field (created_at, title, duration)")] = "created_at",
    sort_order: Annotated[str, Query(description="Sort order (asc, desc)")] = "desc",
    date_from: Annotated[str | None, Query(description="Filter from date (ISO 8601, e.g. 2024-01-01)")] = None,
    date_to: Annotated[str | None, Query(description="Filter to date (ISO 8601, e.g. 2024-12-31)")] = None,
    tag_ids: Annotated[str | None, Query(description="Comma-separated tag IDs to filter by")] = None,
    speaker: Annotated[str | None, Query(description="Filter by speaker name")] = None,
) -> RecordingListResponse:
    """List all recordings with pagination and filtering.

    Args:
        db: Database session.
        page: Page number (1-indexed).
        page_size: Number of items per page.
        project_id: Optional project ID filter.
        status: Optional status filter (pending, processing, completed, failed).
        search: Optional search string for title or filename.
        sort_by: Field to sort by (created_at, title, duration).
        sort_order: Sort direction (asc, desc).
        date_from: Optional start date filter (inclusive).
        date_to: Optional end date filter (inclusive).
        tag_ids: Optional comma-separated tag IDs to filter by.
        speaker: Optional speaker name to filter by.

    Returns:
        Paginated list of recordings.
    """
    from sqlalchemy import or_

    # Build base query
    query = select(Recording)

    # Apply filters
    if project_id is not None:
        query = query.where(Recording.project_id == project_id)

    if status is not None:
        query = query.where(Recording.status == status)

    if search is not None and search.strip():
        search_term = f"%{search.strip()}%"
        query = query.where(
            or_(
                Recording.title.ilike(search_term),
                Recording.file_name.ilike(search_term),
            )
        )

    # Date range filters
    if date_from is not None:
        try:
            from_date = datetime.fromisoformat(date_from)
            query = query.where(Recording.created_at >= from_date)
        except ValueError:
            pass  # Ignore invalid date format

    if date_to is not None:
        try:
            # Set to end of day for inclusive range
            to_date = datetime.fromisoformat(date_to).replace(hour=23, minute=59, second=59)
            query = query.where(Recording.created_at <= to_date)
        except ValueError:
            pass  # Ignore invalid date format

    # Tag filter — recordings must have ALL specified tags
    if tag_ids is not None and tag_ids.strip():
        tag_id_list = [t.strip() for t in tag_ids.split(",") if t.strip()]
        if tag_id_list:
            query = query.where(
                Recording.id.in_(
                    select(RecordingTag.recording_id)
                    .where(RecordingTag.tag_id.in_(tag_id_list))
                    .group_by(RecordingTag.recording_id)
                    .having(func.count(distinct(RecordingTag.tag_id)) == len(tag_id_list))
                )
            )

    # Speaker filter — recordings whose transcript contains this speaker
    if speaker is not None and speaker.strip():
        speaker_term = f"%{speaker.strip()}%"
        query = query.where(
            Recording.id.in_(
                select(Transcript.recording_id)
                .join(Speaker, Speaker.transcript_id == Transcript.id)
                .where(
                    or_(
                        Speaker.speaker_name.ilike(speaker_term),
                        Speaker.speaker_label.ilike(speaker_term),
                    )
                )
            )
        )

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Calculate pagination
    total_pages = (total + page_size - 1) // page_size if total > 0 else 1
    offset = (page - 1) * page_size

    # Apply sorting
    sort_column = {
        "created_at": Recording.created_at,
        "title": Recording.title,
        "duration": Recording.duration_seconds,
    }.get(sort_by, Recording.created_at)

    if sort_order == "asc":
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())

    # Apply pagination
    query = query.offset(offset).limit(page_size)
    result = await db.execute(query)
    recordings = result.scalars().all()

    # Batch-load tag IDs for all recordings
    recording_ids = [r.id for r in recordings]
    tag_map: dict[str, list[str]] = {rid: [] for rid in recording_ids}
    if recording_ids:
        tag_result = await db.execute(
            select(RecordingTag.recording_id, RecordingTag.tag_id).where(
                RecordingTag.recording_id.in_(recording_ids)
            )
        )
        for row in tag_result:
            tag_map[row.recording_id].append(row.tag_id)

    return RecordingListResponse(
        items=[_recording_to_response(r, tag_ids=tag_map.get(r.id, [])) for r in recordings],
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

    # Extract audio duration
    duration = _extract_duration(content, safe_filename)

    # Create recording record first to get ID
    recording = Recording(
        title=title or safe_filename or "Untitled Recording",
        file_path="",  # Will be updated after saving
        file_name=safe_filename,
        file_size=file_size,
        duration_seconds=duration,
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

        # Extract audio from video files for playback and transcription
        if _is_video(content_type):
            extracted = await _extract_audio_from_video(file_path)
            if extracted is None:
                logger.warning("Could not extract audio from video %s — ffmpeg may not be installed", safe_filename)

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

    # For video files, serve the extracted audio track instead
    extracted_audio = _get_extracted_audio_path(recording.file_path)
    if extracted_audio is not None:
        return FileResponse(
            path=extracted_audio,
            media_type="audio/wav",
            filename=f"{Path(recording.file_name).stem}.wav",
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
    await db.commit()

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
