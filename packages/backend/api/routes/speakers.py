"""Speaker API routes."""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import distinct, func, select, update

from persistence.database import get_session_factory
from persistence.models import Segment, SegmentComment, SegmentHighlight, Speaker, Transcript

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/speakers", tags=["speakers"])


class SpeakerResponse(BaseModel):
    """Speaker response model."""

    id: str
    transcript_id: str
    speaker_label: str
    speaker_name: str | None
    color: str | None


class SpeakerUpdateRequest(BaseModel):
    """Speaker update request model."""

    speaker_name: str | None = None
    color: str | None = None


class SpeakerMergeRequest(BaseModel):
    """Speaker merge request model."""

    target_speaker_id: str


class SpeakerMergeResponse(BaseModel):
    """Speaker merge response model."""

    speaker: SpeakerResponse
    segments_moved: int


class SpeakerListResponse(BaseModel):
    """Speaker list response model."""

    items: list[SpeakerResponse]


class ReassignSegmentRequest(BaseModel):
    """Request to reassign a segment to a different speaker."""

    segment_id: str
    transcript_id: str
    speaker_name: str


class SegmentResponse(BaseModel):
    """Segment response (mirrors transcripts.SegmentResponse)."""

    id: str
    segment_index: int
    speaker: str | None
    start_time: float
    end_time: float
    text: str
    confidence: float | None
    edited: bool
    highlight_color: str | None = None
    comment_count: int = 0
    created_at: str
    updated_at: str


class ReassignSegmentResponse(BaseModel):
    """Response from reassigning a segment."""

    segment: SegmentResponse
    speakers: list[SpeakerResponse]


class UniqueSpeakerResponse(BaseModel):
    """Unique speaker name for filter dropdowns."""

    name: str
    count: int


class UniqueSpeakerListResponse(BaseModel):
    """List of unique speaker names."""

    items: list[UniqueSpeakerResponse]


@router.get("/unique", response_model=UniqueSpeakerListResponse)
async def list_unique_speakers() -> UniqueSpeakerListResponse:
    """List all unique speaker names across all recordings, with occurrence count."""
    async with get_session_factory()() as session:
        # Get unique speaker names (prefer speaker_name over speaker_label)
        result = await session.execute(
            select(
                func.coalesce(Speaker.speaker_name, Speaker.speaker_label).label("name"),
                func.count().label("count"),
            )
            .group_by("name")
            .order_by(func.count().desc())
        )
        rows = result.all()

        return UniqueSpeakerListResponse(
            items=[
                UniqueSpeakerResponse(name=row.name, count=row.count)
                for row in rows
                if row.name
            ]
        )


@router.get("/by-transcript/{transcript_id}", response_model=SpeakerListResponse)
async def get_speakers_by_transcript(transcript_id: str) -> SpeakerListResponse:
    """Get all speakers for a transcript.

    Args:
        transcript_id: The transcript ID.

    Returns:
        List of speakers.

    Raises:
        HTTPException: If transcript not found.
    """
    async with get_session_factory()() as session:
        # Verify transcript exists
        result = await session.execute(
            select(Transcript).where(Transcript.id == transcript_id)
        )
        if result.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="Transcript not found")

        # Get speakers
        result = await session.execute(
            select(Speaker)
            .where(Speaker.transcript_id == transcript_id)
            .order_by(Speaker.speaker_label)
        )
        speakers = result.scalars().all()

        return SpeakerListResponse(
            items=[
                SpeakerResponse(
                    id=s.id,
                    transcript_id=s.transcript_id,
                    speaker_label=s.speaker_label,
                    speaker_name=s.speaker_name,
                    color=s.color,
                )
                for s in speakers
            ]
        )


@router.patch("/{speaker_id}", response_model=SpeakerResponse)
async def update_speaker(speaker_id: str, request: SpeakerUpdateRequest) -> SpeakerResponse:
    """Update speaker name or color.

    Args:
        speaker_id: The speaker ID.
        request: Update data.

    Returns:
        Updated speaker.

    Raises:
        HTTPException: If speaker not found.
    """
    async with get_session_factory()() as session:
        result = await session.execute(select(Speaker).where(Speaker.id == speaker_id))
        speaker = result.scalar_one_or_none()

        if speaker is None:
            raise HTTPException(status_code=404, detail="Speaker not found")

        # Update fields
        update_data = {}
        if request.speaker_name is not None:
            update_data["speaker_name"] = request.speaker_name
        if request.color is not None:
            update_data["color"] = request.color

        if update_data:
            await session.execute(
                update(Speaker).where(Speaker.id == speaker_id).values(**update_data)
            )
            await session.commit()

            # Refresh
            result = await session.execute(select(Speaker).where(Speaker.id == speaker_id))
            speaker = result.scalar_one()

        return SpeakerResponse(
            id=speaker.id,
            transcript_id=speaker.transcript_id,
            speaker_label=speaker.speaker_label,
            speaker_name=speaker.speaker_name,
            color=speaker.color,
        )


@router.post("/{speaker_id}/merge", response_model=SpeakerMergeResponse)
async def merge_speaker(speaker_id: str, request: SpeakerMergeRequest) -> SpeakerMergeResponse:
    """Merge source speaker into target speaker.

    Reassigns all segments from the source speaker to the target speaker,
    then deletes the source speaker record.

    Args:
        speaker_id: The source speaker ID (will be deleted).
        request: Contains target_speaker_id.

    Returns:
        The target speaker and count of segments moved.

    Raises:
        HTTPException: If speakers not found or belong to different transcripts.
    """
    async with get_session_factory()() as session:
        # Load source speaker
        result = await session.execute(select(Speaker).where(Speaker.id == speaker_id))
        source = result.scalar_one_or_none()
        if source is None:
            raise HTTPException(status_code=404, detail="Source speaker not found")

        # Load target speaker
        result = await session.execute(
            select(Speaker).where(Speaker.id == request.target_speaker_id)
        )
        target = result.scalar_one_or_none()
        if target is None:
            raise HTTPException(status_code=404, detail="Target speaker not found")

        # Verify same transcript
        if source.transcript_id != target.transcript_id:
            raise HTTPException(
                status_code=400, detail="Speakers must belong to the same transcript"
            )

        # Count segments to move
        count_result = await session.execute(
            select(func.count())
            .select_from(Segment)
            .where(
                Segment.transcript_id == source.transcript_id,
                Segment.speaker == source.speaker_label,
            )
        )
        segments_moved = count_result.scalar() or 0

        # Reassign segments from source to target
        await session.execute(
            update(Segment)
            .where(
                Segment.transcript_id == source.transcript_id,
                Segment.speaker == source.speaker_label,
            )
            .values(speaker=target.speaker_label)
        )

        # Delete source speaker
        await session.delete(source)
        await session.commit()

        # Refresh target
        result = await session.execute(select(Speaker).where(Speaker.id == target.id))
        target = result.scalar_one()

        logger.info(
            "Merged speaker %s into %s: %d segments moved",
            source.speaker_label,
            target.speaker_label,
            segments_moved,
        )

        return SpeakerMergeResponse(
            speaker=SpeakerResponse(
                id=target.id,
                transcript_id=target.transcript_id,
                speaker_label=target.speaker_label,
                speaker_name=target.speaker_name,
                color=target.color,
            ),
            segments_moved=segments_moved,
        )


@router.post("/reassign-segment", response_model=ReassignSegmentResponse)
async def reassign_segment(request: ReassignSegmentRequest) -> ReassignSegmentResponse:
    """Reassign a single segment to a different speaker by name.

    If speaker_name matches an existing speaker (by name or label, case-insensitive),
    the segment is moved to that speaker. If no match, a new Speaker record is created.
    Orphaned speakers (0 remaining segments) are automatically deleted.
    """
    async with get_session_factory()() as session:
        # Load the segment and verify it belongs to the transcript
        result = await session.execute(
            select(Segment).where(
                Segment.id == request.segment_id,
                Segment.transcript_id == request.transcript_id,
            )
        )
        segment = result.scalar_one_or_none()
        if segment is None:
            raise HTTPException(status_code=404, detail="Segment not found")

        old_speaker_label = segment.speaker

        # Load all speakers for this transcript
        result = await session.execute(
            select(Speaker)
            .where(Speaker.transcript_id == request.transcript_id)
            .order_by(Speaker.speaker_label)
        )
        all_speakers = list(result.scalars().all())

        # Find matching speaker (case-insensitive match on speaker_name or speaker_label)
        target_speaker = None
        for s in all_speakers:
            if (
                (s.speaker_name and s.speaker_name.lower() == request.speaker_name.lower())
                or s.speaker_label.lower() == request.speaker_name.lower()
            ):
                target_speaker = s
                break

        if target_speaker:
            # Reassign segment to existing speaker
            segment.speaker = target_speaker.speaker_label
        else:
            # Generate next speaker label (SPEAKER_XX)
            existing_labels = [s.speaker_label for s in all_speakers]
            next_index = 0
            while f"SPEAKER_{next_index:02d}" in existing_labels:
                next_index += 1
            new_label = f"SPEAKER_{next_index:02d}"

            # Create new Speaker record
            new_speaker = Speaker(
                transcript_id=request.transcript_id,
                speaker_label=new_label,
                speaker_name=request.speaker_name,
            )
            session.add(new_speaker)

            # Reassign segment to the new speaker
            segment.speaker = new_label

        # Cleanup: check if old speaker is now orphaned
        if old_speaker_label:
            remaining = await session.execute(
                select(func.count())
                .select_from(Segment)
                .where(
                    Segment.transcript_id == request.transcript_id,
                    Segment.speaker == old_speaker_label,
                )
            )
            remaining_count = remaining.scalar() or 0
            if remaining_count == 0:
                # Delete orphaned speaker
                result = await session.execute(
                    select(Speaker).where(
                        Speaker.transcript_id == request.transcript_id,
                        Speaker.speaker_label == old_speaker_label,
                    )
                )
                orphaned = result.scalar_one_or_none()
                if orphaned:
                    await session.delete(orphaned)
                    logger.info(
                        "Deleted orphaned speaker %s from transcript %s",
                        old_speaker_label,
                        request.transcript_id,
                    )

        await session.commit()

        # Refresh segment
        result = await session.execute(
            select(Segment).where(Segment.id == request.segment_id)
        )
        segment = result.scalar_one()

        # Load annotation data for this segment
        hl_result = await session.execute(
            select(SegmentHighlight.color).where(
                SegmentHighlight.segment_id == segment.id
            )
        )
        highlight_color = hl_result.scalar_one_or_none()

        cc_result = await session.execute(
            select(func.count(SegmentComment.id)).where(
                SegmentComment.segment_id == segment.id
            )
        )
        comment_count = cc_result.scalar() or 0

        # Reload all speakers (after potential add/delete)
        result = await session.execute(
            select(Speaker)
            .where(Speaker.transcript_id == request.transcript_id)
            .order_by(Speaker.speaker_label)
        )
        speakers = result.scalars().all()

        logger.info(
            "Reassigned segment %s from %s to %s in transcript %s",
            request.segment_id,
            old_speaker_label,
            segment.speaker,
            request.transcript_id,
        )

        return ReassignSegmentResponse(
            segment=SegmentResponse(
                id=segment.id,
                segment_index=segment.segment_index,
                speaker=segment.speaker,
                start_time=segment.start_time,
                end_time=segment.end_time,
                text=segment.text,
                confidence=segment.confidence,
                edited=segment.edited,
                highlight_color=highlight_color,
                comment_count=comment_count,
                created_at=segment.created_at.isoformat(),
                updated_at=segment.updated_at.isoformat(),
            ),
            speakers=[
                SpeakerResponse(
                    id=s.id,
                    transcript_id=s.transcript_id,
                    speaker_label=s.speaker_label,
                    speaker_name=s.speaker_name,
                    color=s.color,
                )
                for s in speakers
            ],
        )
