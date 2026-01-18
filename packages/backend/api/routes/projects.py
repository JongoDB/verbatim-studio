"""Project management endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from persistence.database import get_db
from persistence.models import Project, Recording

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    """Request model for creating a project."""

    name: str
    description: str | None = None


class ProjectUpdate(BaseModel):
    """Request model for updating a project."""

    name: str | None = None
    description: str | None = None


class ProjectResponse(BaseModel):
    """Response model for a project."""

    id: str
    name: str
    description: str | None
    recording_count: int
    created_at: str
    updated_at: str


class ProjectListResponse(BaseModel):
    """Response model for listing projects."""

    items: list[ProjectResponse]
    total: int


class MessageResponse(BaseModel):
    """Generic message response."""

    message: str
    id: str | None = None


@router.get("", response_model=ProjectListResponse)
async def list_projects(
    db: Annotated[AsyncSession, Depends(get_db)],
    search: Annotated[str | None, Query(description="Search by name")] = None,
) -> ProjectListResponse:
    """List all projects with recording counts."""
    # Base query
    query = select(Project).order_by(Project.updated_at.desc())

    if search:
        query = query.where(Project.name.ilike(f"%{search}%"))

    result = await db.execute(query)
    projects = result.scalars().all()

    # Get recording counts
    items = []
    for project in projects:
        count_result = await db.execute(
            select(func.count(Recording.id)).where(Recording.project_id == project.id)
        )
        recording_count = count_result.scalar() or 0

        items.append(
            ProjectResponse(
                id=project.id,
                name=project.name,
                description=project.description,
                recording_count=recording_count,
                created_at=project.created_at.isoformat(),
                updated_at=project.updated_at.isoformat(),
            )
        )

    return ProjectListResponse(items=items, total=len(items))


@router.post("", response_model=ProjectResponse, status_code=201)
async def create_project(
    db: Annotated[AsyncSession, Depends(get_db)],
    data: ProjectCreate,
) -> ProjectResponse:
    """Create a new project."""
    project = Project(
        name=data.name,
        description=data.description,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        recording_count=0,
        created_at=project.created_at.isoformat(),
        updated_at=project.updated_at.isoformat(),
    )


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    db: Annotated[AsyncSession, Depends(get_db)],
    project_id: str,
) -> ProjectResponse:
    """Get a project by ID."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    count_result = await db.execute(
        select(func.count(Recording.id)).where(Recording.project_id == project.id)
    )
    recording_count = count_result.scalar() or 0

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        recording_count=recording_count,
        created_at=project.created_at.isoformat(),
        updated_at=project.updated_at.isoformat(),
    )


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    db: Annotated[AsyncSession, Depends(get_db)],
    project_id: str,
    data: ProjectUpdate,
) -> ProjectResponse:
    """Update a project."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if data.name is not None:
        project.name = data.name
    if data.description is not None:
        project.description = data.description

    await db.commit()
    await db.refresh(project)

    count_result = await db.execute(
        select(func.count(Recording.id)).where(Recording.project_id == project.id)
    )
    recording_count = count_result.scalar() or 0

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        recording_count=recording_count,
        created_at=project.created_at.isoformat(),
        updated_at=project.updated_at.isoformat(),
    )


@router.delete("/{project_id}", response_model=MessageResponse)
async def delete_project(
    db: Annotated[AsyncSession, Depends(get_db)],
    project_id: str,
) -> MessageResponse:
    """Delete a project. Recordings are unassigned, not deleted."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Unassign recordings from project
    await db.execute(
        Recording.__table__.update()
        .where(Recording.project_id == project_id)
        .values(project_id=None)
    )

    await db.delete(project)
    await db.commit()

    return MessageResponse(message="Project deleted", id=project_id)


@router.post("/{project_id}/recordings/{recording_id}", response_model=MessageResponse)
async def add_recording_to_project(
    db: Annotated[AsyncSession, Depends(get_db)],
    project_id: str,
    recording_id: str,
) -> MessageResponse:
    """Add a recording to a project."""
    # Verify project exists
    project_result = await db.execute(select(Project).where(Project.id == project_id))
    if not project_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    # Verify recording exists
    recording_result = await db.execute(select(Recording).where(Recording.id == recording_id))
    recording = recording_result.scalar_one_or_none()
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    recording.project_id = project_id
    await db.commit()

    return MessageResponse(message="Recording added to project", id=recording_id)


@router.delete("/{project_id}/recordings/{recording_id}", response_model=MessageResponse)
async def remove_recording_from_project(
    db: Annotated[AsyncSession, Depends(get_db)],
    project_id: str,
    recording_id: str,
) -> MessageResponse:
    """Remove a recording from a project."""
    recording_result = await db.execute(
        select(Recording).where(
            Recording.id == recording_id,
            Recording.project_id == project_id,
        )
    )
    recording = recording_result.scalar_one_or_none()

    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found in project")

    recording.project_id = None
    await db.commit()

    return MessageResponse(message="Recording removed from project", id=recording_id)
