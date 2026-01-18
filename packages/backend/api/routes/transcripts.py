"""Transcript API endpoints."""

import logging
from datetime import datetime
from enum import Enum
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from persistence import get_db
from persistence.models import Recording, Segment, Speaker, Transcript
from services.export import ExportData, ExportSegment, export_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/transcripts", tags=["transcripts"])


# Pydantic models for responses
class SegmentResponse(BaseModel):
    """Response model for a segment."""

    id: str
    segment_index: int
    speaker: str | None
    start_time: float
    end_time: float
    text: str
    confidence: float | None
    edited: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TranscriptResponse(BaseModel):
    """Response model for a transcript."""

    id: str
    recording_id: str
    language: str | None
    model_used: str | None
    confidence_avg: float | None
    word_count: int | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TranscriptWithSegmentsResponse(TranscriptResponse):
    """Response model for a transcript with its segments."""

    segments: list[SegmentResponse]


class SegmentUpdateRequest(BaseModel):
    """Request model for updating a segment."""

    text: str | None = None
    speaker: str | None = None


class SegmentListResponse(BaseModel):
    """Response model for paginated list of segments."""

    items: list[SegmentResponse]
    total: int
    skip: int
    limit: int


@router.get("/{transcript_id}", response_model=TranscriptWithSegmentsResponse)
async def get_transcript(
    transcript_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TranscriptWithSegmentsResponse:
    """Get a transcript with all its segments.

    Args:
        transcript_id: The transcript's unique ID.
        db: Database session.

    Returns:
        Transcript details with all segments.

    Raises:
        HTTPException: If transcript not found.
    """
    result = await db.execute(
        select(Transcript)
        .options(selectinload(Transcript.segments))
        .where(Transcript.id == transcript_id)
    )
    transcript = result.scalar_one_or_none()

    if transcript is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transcript not found: {transcript_id}",
        )

    # Sort segments by segment_index
    sorted_segments = sorted(transcript.segments, key=lambda s: s.segment_index)

    return TranscriptWithSegmentsResponse(
        id=transcript.id,
        recording_id=transcript.recording_id,
        language=transcript.language,
        model_used=transcript.model_used,
        confidence_avg=transcript.confidence_avg,
        word_count=transcript.word_count,
        created_at=transcript.created_at,
        updated_at=transcript.updated_at,
        segments=[
            SegmentResponse(
                id=s.id,
                segment_index=s.segment_index,
                speaker=s.speaker,
                start_time=s.start_time,
                end_time=s.end_time,
                text=s.text,
                confidence=s.confidence,
                edited=s.edited,
                created_at=s.created_at,
                updated_at=s.updated_at,
            )
            for s in sorted_segments
        ],
    )


@router.get("/{transcript_id}/segments", response_model=SegmentListResponse)
async def get_transcript_segments(
    transcript_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    skip: Annotated[int, Query(ge=0, description="Number of segments to skip")] = 0,
    limit: Annotated[int, Query(ge=1, le=100, description="Number of segments to return")] = 50,
) -> SegmentListResponse:
    """Get paginated segments for a transcript.

    Args:
        transcript_id: The transcript's unique ID.
        db: Database session.
        skip: Number of segments to skip.
        limit: Maximum number of segments to return.

    Returns:
        Paginated list of segments.

    Raises:
        HTTPException: If transcript not found.
    """
    # Verify transcript exists
    transcript_result = await db.execute(select(Transcript).where(Transcript.id == transcript_id))
    transcript = transcript_result.scalar_one_or_none()

    if transcript is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transcript not found: {transcript_id}",
        )

    # Get total count efficiently
    count_result = await db.execute(
        select(func.count(Segment.id)).where(Segment.transcript_id == transcript_id)
    )
    total = count_result.scalar() or 0

    # Get paginated segments
    result = await db.execute(
        select(Segment)
        .where(Segment.transcript_id == transcript_id)
        .order_by(Segment.segment_index)
        .offset(skip)
        .limit(limit)
    )
    segments = result.scalars().all()

    return SegmentListResponse(
        items=[
            SegmentResponse(
                id=s.id,
                segment_index=s.segment_index,
                speaker=s.speaker,
                start_time=s.start_time,
                end_time=s.end_time,
                text=s.text,
                confidence=s.confidence,
                edited=s.edited,
                created_at=s.created_at,
                updated_at=s.updated_at,
            )
            for s in segments
        ],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.patch("/{transcript_id}/segments/{segment_id}", response_model=SegmentResponse)
async def update_segment(
    transcript_id: str,
    segment_id: str,
    update_data: SegmentUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SegmentResponse:
    """Update a segment's text or speaker.

    Args:
        transcript_id: The transcript's unique ID.
        segment_id: The segment's unique ID.
        update_data: Fields to update.
        db: Database session.

    Returns:
        Updated segment details.

    Raises:
        HTTPException: If transcript or segment not found.
    """
    # Verify transcript exists
    transcript_result = await db.execute(select(Transcript).where(Transcript.id == transcript_id))
    transcript = transcript_result.scalar_one_or_none()

    if transcript is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transcript not found: {transcript_id}",
        )

    # Get the segment
    result = await db.execute(
        select(Segment).where(
            Segment.id == segment_id,
            Segment.transcript_id == transcript_id,
        )
    )
    segment = result.scalar_one_or_none()

    if segment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Segment not found: {segment_id}",
        )

    # Validate that at least one field is provided
    if update_data.text is None and update_data.speaker is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one field (text or speaker) must be provided",
        )

    # Update fields
    if update_data.text is not None:
        segment.text = update_data.text
        segment.edited = True
        logger.info("Segment %s text updated", segment_id)

    if update_data.speaker is not None:
        segment.speaker = update_data.speaker
        logger.info("Segment %s speaker updated to '%s'", segment_id, update_data.speaker)

    await db.commit()
    await db.refresh(segment)

    return SegmentResponse(
        id=segment.id,
        segment_index=segment.segment_index,
        speaker=segment.speaker,
        start_time=segment.start_time,
        end_time=segment.end_time,
        text=segment.text,
        confidence=segment.confidence,
        edited=segment.edited,
        created_at=segment.created_at,
        updated_at=segment.updated_at,
    )


@router.get("/by-recording/{recording_id}", response_model=TranscriptWithSegmentsResponse)
async def get_transcript_by_recording(
    recording_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TranscriptWithSegmentsResponse:
    """Get transcript for a recording.

    Args:
        recording_id: The recording's unique ID.
        db: Database session.

    Returns:
        Transcript details with all segments.

    Raises:
        HTTPException: If transcript not found for the recording.
    """
    result = await db.execute(
        select(Transcript)
        .options(selectinload(Transcript.segments))
        .where(Transcript.recording_id == recording_id)
    )
    transcript = result.scalar_one_or_none()

    if transcript is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transcript not found for recording: {recording_id}",
        )

    # Sort segments by segment_index
    sorted_segments = sorted(transcript.segments, key=lambda s: s.segment_index)

    return TranscriptWithSegmentsResponse(
        id=transcript.id,
        recording_id=transcript.recording_id,
        language=transcript.language,
        model_used=transcript.model_used,
        confidence_avg=transcript.confidence_avg,
        word_count=transcript.word_count,
        created_at=transcript.created_at,
        updated_at=transcript.updated_at,
        segments=[
            SegmentResponse(
                id=s.id,
                segment_index=s.segment_index,
                speaker=s.speaker,
                start_time=s.start_time,
                end_time=s.end_time,
                text=s.text,
                confidence=s.confidence,
                edited=s.edited,
                created_at=s.created_at,
                updated_at=s.updated_at,
            )
            for s in sorted_segments
        ],
    )


class ExportFormat(str, Enum):
    """Supported export formats."""

    TXT = "txt"
    SRT = "srt"
    VTT = "vtt"
    DOCX = "docx"
    PDF = "pdf"


# MIME types for export formats
EXPORT_MIME_TYPES = {
    ExportFormat.TXT: "text/plain",
    ExportFormat.SRT: "application/x-subrip",
    ExportFormat.VTT: "text/vtt",
    ExportFormat.DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ExportFormat.PDF: "application/pdf",
}


@router.get("/{transcript_id}/export")
async def export_transcript(
    transcript_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    format: Annotated[ExportFormat, Query(description="Export format")] = ExportFormat.TXT,
    include_timestamps: Annotated[bool, Query(description="Include timestamps (TXT only)")] = True,
) -> Response:
    """Export a transcript to various formats.

    Supported formats:
    - txt: Plain text with timestamps
    - srt: SubRip subtitle format
    - vtt: WebVTT subtitle format
    - docx: Microsoft Word document
    - pdf: PDF document

    Args:
        transcript_id: The transcript's unique ID.
        db: Database session.
        format: Export format (txt, srt, vtt, docx, pdf).
        include_timestamps: Include timestamps in TXT export.

    Returns:
        File download response in the requested format.

    Raises:
        HTTPException: If transcript not found.
    """
    # Get transcript with segments and recording
    result = await db.execute(
        select(Transcript)
        .options(selectinload(Transcript.segments))
        .options(selectinload(Transcript.recording))
        .options(selectinload(Transcript.speakers))
        .where(Transcript.id == transcript_id)
    )
    transcript = result.scalar_one_or_none()

    if transcript is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transcript not found: {transcript_id}",
        )

    # Build speaker mapping
    speaker_map = {}
    for speaker in transcript.speakers:
        speaker_map[speaker.speaker_label] = speaker.speaker_name or speaker.speaker_label

    # Sort segments by index
    sorted_segments = sorted(transcript.segments, key=lambda s: s.segment_index)

    # Build export data
    export_data = ExportData(
        title=transcript.recording.title if transcript.recording else "Transcript",
        language=transcript.language,
        model_used=transcript.model_used,
        word_count=transcript.word_count,
        duration_seconds=transcript.recording.duration_seconds if transcript.recording else None,
        segments=[
            ExportSegment(
                index=s.segment_index,
                start_time=s.start_time,
                end_time=s.end_time,
                text=s.text,
                speaker=s.speaker,
                speaker_name=speaker_map.get(s.speaker) if s.speaker else None,
            )
            for s in sorted_segments
        ],
        speakers=speaker_map,
    )

    # Generate filename
    base_name = transcript.recording.title if transcript.recording else "transcript"
    # Sanitize filename
    safe_name = "".join(c if c.isalnum() or c in " -_" else "_" for c in base_name)
    filename = f"{safe_name}.{format.value}"

    # Export based on format
    try:
        if format == ExportFormat.TXT:
            content = export_service.export_txt(export_data, include_timestamps)
            media_type = EXPORT_MIME_TYPES[format]
            return Response(
                content=content.encode("utf-8"),
                media_type=media_type,
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )

        elif format == ExportFormat.SRT:
            content = export_service.export_srt(export_data)
            media_type = EXPORT_MIME_TYPES[format]
            return Response(
                content=content.encode("utf-8"),
                media_type=media_type,
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )

        elif format == ExportFormat.VTT:
            content = export_service.export_vtt(export_data)
            media_type = EXPORT_MIME_TYPES[format]
            return Response(
                content=content.encode("utf-8"),
                media_type=media_type,
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )

        elif format == ExportFormat.DOCX:
            content = export_service.export_docx(export_data)
            media_type = EXPORT_MIME_TYPES[format]
            return Response(
                content=content,
                media_type=media_type,
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )

        elif format == ExportFormat.PDF:
            content = export_service.export_pdf(export_data)
            media_type = EXPORT_MIME_TYPES[format]
            return Response(
                content=content,
                media_type=media_type,
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )

    except ImportError as e:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=str(e),
        )
    except Exception as e:
        logger.error("Export failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Export failed: {str(e)}",
        )
