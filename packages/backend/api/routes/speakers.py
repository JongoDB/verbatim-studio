"""Speaker API routes."""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import distinct, func, select, update

from persistence.database import async_session
from persistence.models import Segment, Speaker, Transcript

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
    async with async_session() as session:
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
    async with async_session() as session:
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
    async with async_session() as session:
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
    async with async_session() as session:
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
