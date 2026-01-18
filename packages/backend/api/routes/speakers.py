"""Speaker API routes."""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update

from persistence.database import async_session
from persistence.models import Speaker, Transcript

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


class SpeakerListResponse(BaseModel):
    """Speaker list response model."""

    items: list[SpeakerResponse]


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
