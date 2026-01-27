"""Tag management endpoints."""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from persistence import get_db
from persistence.models import Recording, RecordingTag, Tag

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tags", tags=["tags"])


class TagResponse(BaseModel):
    """Response model for a tag."""

    id: str
    name: str
    color: str | None
    created_at: datetime

    class Config:
        from_attributes = True


class TagCreateRequest(BaseModel):
    """Request model for creating a tag."""

    name: str
    color: str | None = None


class TagListResponse(BaseModel):
    """Response model for list of tags."""

    items: list[TagResponse]


class TagAssignRequest(BaseModel):
    """Request model for assigning a tag to a recording."""

    tag_id: str


class MessageResponse(BaseModel):
    """Simple message response."""

    message: str


@router.get("", response_model=TagListResponse)
async def list_tags(
    db: AsyncSession = Depends(get_db),
) -> TagListResponse:
    """List all tags."""
    result = await db.execute(select(Tag).order_by(Tag.name))
    tags = result.scalars().all()
    return TagListResponse(
        items=[
            TagResponse(
                id=t.id,
                name=t.name,
                color=t.color,
                created_at=t.created_at,
            )
            for t in tags
        ]
    )


@router.post("", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
async def create_tag(
    request: TagCreateRequest,
    db: AsyncSession = Depends(get_db),
) -> TagResponse:
    """Create a new tag."""
    # Check for duplicate name
    existing = await db.execute(select(Tag).where(Tag.name == request.name))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Tag '{request.name}' already exists",
        )

    tag = Tag(name=request.name, color=request.color)
    db.add(tag)
    await db.flush()

    return TagResponse(
        id=tag.id,
        name=tag.name,
        color=tag.color,
        created_at=tag.created_at,
    )


@router.delete("/{tag_id}", response_model=MessageResponse)
async def delete_tag(
    tag_id: str,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Delete a tag."""
    result = await db.execute(select(Tag).where(Tag.id == tag_id))
    tag = result.scalar_one_or_none()

    if tag is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tag not found: {tag_id}",
        )

    await db.delete(tag)
    return MessageResponse(message="Tag deleted successfully")


@router.post(
    "/recordings/{recording_id}",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def assign_tag_to_recording(
    recording_id: str,
    request: TagAssignRequest,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Assign a tag to a recording."""
    # Verify recording exists
    rec_result = await db.execute(select(Recording).where(Recording.id == recording_id))
    if rec_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Recording not found: {recording_id}",
        )

    # Verify tag exists
    tag_result = await db.execute(select(Tag).where(Tag.id == request.tag_id))
    if tag_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tag not found: {request.tag_id}",
        )

    # Check if already assigned
    existing = await db.execute(
        select(RecordingTag).where(
            RecordingTag.recording_id == recording_id,
            RecordingTag.tag_id == request.tag_id,
        )
    )
    if existing.scalar_one_or_none() is not None:
        return MessageResponse(message="Tag already assigned")

    db.add(RecordingTag(recording_id=recording_id, tag_id=request.tag_id))
    return MessageResponse(message="Tag assigned successfully")


@router.delete(
    "/recordings/{recording_id}/{tag_id}",
    response_model=MessageResponse,
)
async def remove_tag_from_recording(
    recording_id: str,
    tag_id: str,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Remove a tag from a recording."""
    result = await db.execute(
        select(RecordingTag).where(
            RecordingTag.recording_id == recording_id,
            RecordingTag.tag_id == tag_id,
        )
    )
    link = result.scalar_one_or_none()

    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tag assignment not found",
        )

    await db.delete(link)
    return MessageResponse(message="Tag removed successfully")


@router.get(
    "/recordings/{recording_id}",
    response_model=TagListResponse,
)
async def get_recording_tags(
    recording_id: str,
    db: AsyncSession = Depends(get_db),
) -> TagListResponse:
    """Get all tags for a recording."""
    # Verify recording exists
    rec_result = await db.execute(select(Recording).where(Recording.id == recording_id))
    if rec_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Recording not found: {recording_id}",
        )

    result = await db.execute(
        select(Tag)
        .join(RecordingTag, RecordingTag.tag_id == Tag.id)
        .where(RecordingTag.recording_id == recording_id)
        .order_by(Tag.name)
    )
    tags = result.scalars().all()

    return TagListResponse(
        items=[
            TagResponse(
                id=t.id,
                name=t.name,
                color=t.color,
                created_at=t.created_at,
            )
            for t in tags
        ]
    )
