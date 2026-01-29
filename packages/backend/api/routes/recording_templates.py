"""Recording template management endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from persistence.database import get_db
from persistence.models import Recording, RecordingTemplate

router = APIRouter(prefix="/recording-templates", tags=["recording-templates"])


class MetadataFieldSchema(BaseModel):
    """Schema for a metadata field definition."""

    name: str
    label: str
    field_type: str  # text, textarea, date, number, select
    options: list[str] | None = None
    required: bool = False
    default_value: str | None = None


class RecordingTemplateCreate(BaseModel):
    """Request model for creating a recording template."""

    name: str
    description: str | None = None
    metadata_schema: list[MetadataFieldSchema] = []


class RecordingTemplateUpdate(BaseModel):
    """Request model for updating a recording template."""

    name: str | None = None
    description: str | None = None
    metadata_schema: list[MetadataFieldSchema] | None = None


class RecordingTemplateResponse(BaseModel):
    """Response model for a recording template."""

    id: str
    name: str
    description: str | None
    metadata_schema: list[dict]
    is_system: bool
    recording_count: int
    created_at: str
    updated_at: str


class RecordingTemplateListResponse(BaseModel):
    """Response model for listing recording templates."""

    items: list[RecordingTemplateResponse]
    total: int


class MessageResponse(BaseModel):
    """Generic message response."""

    message: str
    id: str | None = None


@router.get("", response_model=RecordingTemplateListResponse)
async def list_recording_templates(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RecordingTemplateListResponse:
    """List all recording templates with recording counts."""
    result = await db.execute(select(RecordingTemplate).order_by(RecordingTemplate.name))
    templates = result.scalars().all()

    items = []
    for rt in templates:
        count_result = await db.execute(
            select(func.count(Recording.id)).where(Recording.template_id == rt.id)
        )
        recording_count = count_result.scalar() or 0

        items.append(
            RecordingTemplateResponse(
                id=rt.id,
                name=rt.name,
                description=rt.description,
                metadata_schema=rt.metadata_schema,
                is_system=rt.is_system,
                recording_count=recording_count,
                created_at=rt.created_at.isoformat(),
                updated_at=rt.updated_at.isoformat(),
            )
        )

    return RecordingTemplateListResponse(items=items, total=len(items))


@router.get("/{template_id}", response_model=RecordingTemplateResponse)
async def get_recording_template(
    db: Annotated[AsyncSession, Depends(get_db)],
    template_id: str,
) -> RecordingTemplateResponse:
    """Get a recording template by ID."""
    result = await db.execute(
        select(RecordingTemplate).where(RecordingTemplate.id == template_id)
    )
    rt = result.scalar_one_or_none()

    if not rt:
        raise HTTPException(status_code=404, detail="Recording template not found")

    count_result = await db.execute(
        select(func.count(Recording.id)).where(Recording.template_id == rt.id)
    )
    recording_count = count_result.scalar() or 0

    return RecordingTemplateResponse(
        id=rt.id,
        name=rt.name,
        description=rt.description,
        metadata_schema=rt.metadata_schema,
        is_system=rt.is_system,
        recording_count=recording_count,
        created_at=rt.created_at.isoformat(),
        updated_at=rt.updated_at.isoformat(),
    )


@router.post("", response_model=RecordingTemplateResponse, status_code=201)
async def create_recording_template(
    db: Annotated[AsyncSession, Depends(get_db)],
    data: RecordingTemplateCreate,
) -> RecordingTemplateResponse:
    """Create a new recording template."""
    # Check for duplicate name
    existing = await db.execute(
        select(RecordingTemplate).where(RecordingTemplate.name == data.name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400, detail="Recording template with this name already exists"
        )

    rt = RecordingTemplate(
        name=data.name,
        description=data.description,
        metadata_schema=[f.model_dump() for f in data.metadata_schema],
        is_system=False,
    )
    db.add(rt)
    await db.commit()
    await db.refresh(rt)

    return RecordingTemplateResponse(
        id=rt.id,
        name=rt.name,
        description=rt.description,
        metadata_schema=rt.metadata_schema,
        is_system=rt.is_system,
        recording_count=0,
        created_at=rt.created_at.isoformat(),
        updated_at=rt.updated_at.isoformat(),
    )


@router.patch("/{template_id}", response_model=RecordingTemplateResponse)
async def update_recording_template(
    db: Annotated[AsyncSession, Depends(get_db)],
    template_id: str,
    data: RecordingTemplateUpdate,
) -> RecordingTemplateResponse:
    """Update a recording template."""
    result = await db.execute(
        select(RecordingTemplate).where(RecordingTemplate.id == template_id)
    )
    rt = result.scalar_one_or_none()

    if not rt:
        raise HTTPException(status_code=404, detail="Recording template not found")

    if data.name is not None:
        # Check for duplicate name
        existing = await db.execute(
            select(RecordingTemplate).where(
                RecordingTemplate.name == data.name, RecordingTemplate.id != template_id
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=400, detail="Recording template with this name already exists"
            )
        rt.name = data.name

    if data.description is not None:
        rt.description = data.description

    if data.metadata_schema is not None:
        rt.metadata_schema = [f.model_dump() for f in data.metadata_schema]

    await db.commit()
    await db.refresh(rt)

    count_result = await db.execute(
        select(func.count(Recording.id)).where(Recording.template_id == rt.id)
    )
    recording_count = count_result.scalar() or 0

    return RecordingTemplateResponse(
        id=rt.id,
        name=rt.name,
        description=rt.description,
        metadata_schema=rt.metadata_schema,
        is_system=rt.is_system,
        recording_count=recording_count,
        created_at=rt.created_at.isoformat(),
        updated_at=rt.updated_at.isoformat(),
    )


@router.delete("/{template_id}", response_model=MessageResponse)
async def delete_recording_template(
    db: Annotated[AsyncSession, Depends(get_db)],
    template_id: str,
) -> MessageResponse:
    """Delete a recording template. System templates cannot be deleted."""
    result = await db.execute(
        select(RecordingTemplate).where(RecordingTemplate.id == template_id)
    )
    rt = result.scalar_one_or_none()

    if not rt:
        raise HTTPException(status_code=404, detail="Recording template not found")

    if rt.is_system:
        raise HTTPException(status_code=400, detail="Cannot delete system recording template")

    # Unassign recordings from this template
    await db.execute(
        Recording.__table__.update()
        .where(Recording.template_id == template_id)
        .values(template_id=None)
    )

    await db.delete(rt)
    await db.commit()

    return MessageResponse(message="Recording template deleted", id=template_id)
