"""Project type management endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from persistence.database import get_db
from persistence.models import Project, ProjectType

router = APIRouter(prefix="/project-types", tags=["project-types"])


class MetadataFieldSchema(BaseModel):
    """Schema for a metadata field definition."""

    name: str
    label: str
    field_type: str  # text, textarea, date, number, select
    options: list[str] | None = None
    required: bool = False
    default_value: str | None = None


class ProjectTypeCreate(BaseModel):
    """Request model for creating a project type."""

    name: str
    description: str | None = None
    metadata_schema: list[MetadataFieldSchema] = []


class ProjectTypeUpdate(BaseModel):
    """Request model for updating a project type."""

    name: str | None = None
    description: str | None = None
    metadata_schema: list[MetadataFieldSchema] | None = None


class ProjectTypeResponse(BaseModel):
    """Response model for a project type."""

    id: str
    name: str
    description: str | None
    metadata_schema: list[dict]
    is_system: bool
    project_count: int
    created_at: str
    updated_at: str


class ProjectTypeListResponse(BaseModel):
    """Response model for listing project types."""

    items: list[ProjectTypeResponse]
    total: int


class MessageResponse(BaseModel):
    """Generic message response."""

    message: str
    id: str | None = None


@router.get("", response_model=ProjectTypeListResponse)
async def list_project_types(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ProjectTypeListResponse:
    """List all project types with project counts."""
    result = await db.execute(select(ProjectType).order_by(ProjectType.name))
    project_types = result.scalars().all()

    items = []
    for pt in project_types:
        count_result = await db.execute(
            select(func.count(Project.id)).where(Project.project_type_id == pt.id)
        )
        project_count = count_result.scalar() or 0

        items.append(
            ProjectTypeResponse(
                id=pt.id,
                name=pt.name,
                description=pt.description,
                metadata_schema=pt.metadata_schema,
                is_system=pt.is_system,
                project_count=project_count,
                created_at=pt.created_at.isoformat(),
                updated_at=pt.updated_at.isoformat(),
            )
        )

    return ProjectTypeListResponse(items=items, total=len(items))


@router.get("/{type_id}", response_model=ProjectTypeResponse)
async def get_project_type(
    db: Annotated[AsyncSession, Depends(get_db)],
    type_id: str,
) -> ProjectTypeResponse:
    """Get a project type by ID."""
    result = await db.execute(select(ProjectType).where(ProjectType.id == type_id))
    pt = result.scalar_one_or_none()

    if not pt:
        raise HTTPException(status_code=404, detail="Project type not found")

    count_result = await db.execute(
        select(func.count(Project.id)).where(Project.project_type_id == pt.id)
    )
    project_count = count_result.scalar() or 0

    return ProjectTypeResponse(
        id=pt.id,
        name=pt.name,
        description=pt.description,
        metadata_schema=pt.metadata_schema,
        is_system=pt.is_system,
        project_count=project_count,
        created_at=pt.created_at.isoformat(),
        updated_at=pt.updated_at.isoformat(),
    )


@router.post("", response_model=ProjectTypeResponse, status_code=201)
async def create_project_type(
    db: Annotated[AsyncSession, Depends(get_db)],
    data: ProjectTypeCreate,
) -> ProjectTypeResponse:
    """Create a new project type."""
    # Check for duplicate name
    existing = await db.execute(select(ProjectType).where(ProjectType.name == data.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Project type with this name already exists")

    pt = ProjectType(
        name=data.name,
        description=data.description,
        metadata_schema=[f.model_dump() for f in data.metadata_schema],
        is_system=False,
    )
    db.add(pt)
    await db.commit()
    await db.refresh(pt)

    return ProjectTypeResponse(
        id=pt.id,
        name=pt.name,
        description=pt.description,
        metadata_schema=pt.metadata_schema,
        is_system=pt.is_system,
        project_count=0,
        created_at=pt.created_at.isoformat(),
        updated_at=pt.updated_at.isoformat(),
    )


@router.patch("/{type_id}", response_model=ProjectTypeResponse)
async def update_project_type(
    db: Annotated[AsyncSession, Depends(get_db)],
    type_id: str,
    data: ProjectTypeUpdate,
) -> ProjectTypeResponse:
    """Update a project type."""
    result = await db.execute(select(ProjectType).where(ProjectType.id == type_id))
    pt = result.scalar_one_or_none()

    if not pt:
        raise HTTPException(status_code=404, detail="Project type not found")

    if data.name is not None:
        # Check for duplicate name
        existing = await db.execute(
            select(ProjectType).where(ProjectType.name == data.name, ProjectType.id != type_id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Project type with this name already exists")
        pt.name = data.name

    if data.description is not None:
        pt.description = data.description

    if data.metadata_schema is not None:
        pt.metadata_schema = [f.model_dump() for f in data.metadata_schema]

    await db.commit()
    await db.refresh(pt)

    count_result = await db.execute(
        select(func.count(Project.id)).where(Project.project_type_id == pt.id)
    )
    project_count = count_result.scalar() or 0

    return ProjectTypeResponse(
        id=pt.id,
        name=pt.name,
        description=pt.description,
        metadata_schema=pt.metadata_schema,
        is_system=pt.is_system,
        project_count=project_count,
        created_at=pt.created_at.isoformat(),
        updated_at=pt.updated_at.isoformat(),
    )


@router.delete("/{type_id}", response_model=MessageResponse)
async def delete_project_type(
    db: Annotated[AsyncSession, Depends(get_db)],
    type_id: str,
) -> MessageResponse:
    """Delete a project type. System types cannot be deleted."""
    result = await db.execute(select(ProjectType).where(ProjectType.id == type_id))
    pt = result.scalar_one_or_none()

    if not pt:
        raise HTTPException(status_code=404, detail="Project type not found")

    if pt.is_system:
        raise HTTPException(status_code=400, detail="Cannot delete system project type")

    # Unassign projects from this type
    await db.execute(
        Project.__table__.update()
        .where(Project.project_type_id == type_id)
        .values(project_type_id=None)
    )

    await db.delete(pt)
    await db.commit()

    return MessageResponse(message="Project type deleted", id=type_id)
