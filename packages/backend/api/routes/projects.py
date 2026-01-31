"""Project management endpoints."""

import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from persistence.database import get_db
from persistence.models import Document, Project, ProjectType, Recording
from services.storage import storage_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    """Request model for creating a project."""

    name: str
    description: str | None = None
    project_type_id: str | None = None
    metadata: dict | None = None


class ProjectUpdate(BaseModel):
    """Request model for updating a project."""

    name: str | None = None
    description: str | None = None
    project_type_id: str | None = None
    metadata: dict | None = None


class ProjectTypeInfo(BaseModel):
    """Embedded project type info in response."""

    id: str
    name: str
    description: str | None
    metadata_schema: list[dict]
    is_system: bool


class ProjectResponse(BaseModel):
    """Response model for a project."""

    id: str
    name: str
    description: str | None
    project_type: ProjectTypeInfo | None
    metadata: dict
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


def _project_type_to_info(pt: ProjectType | None) -> ProjectTypeInfo | None:
    """Convert ProjectType to ProjectTypeInfo."""
    if not pt:
        return None
    return ProjectTypeInfo(
        id=pt.id,
        name=pt.name,
        description=pt.description,
        metadata_schema=pt.metadata_schema,
        is_system=pt.is_system,
    )


@router.get("", response_model=ProjectListResponse)
async def list_projects(
    db: Annotated[AsyncSession, Depends(get_db)],
    search: Annotated[str | None, Query(description="Search by name")] = None,
    project_type_id: Annotated[str | None, Query(description="Filter by project type")] = None,
    tag: Annotated[str | None, Query(description="Filter by tag in metadata.tags")] = None,
) -> ProjectListResponse:
    """List all projects with recording counts."""
    # Base query with project type eager load
    from sqlalchemy.orm import selectinload

    query = (
        select(Project)
        .options(selectinload(Project.project_type))
        .order_by(Project.updated_at.desc())
    )

    if search:
        query = query.where(Project.name.ilike(f"%{search}%"))

    if project_type_id:
        query = query.where(Project.project_type_id == project_type_id)

    result = await db.execute(query)
    projects = result.scalars().all()

    # Filter by tag if specified (stored in metadata.tags array)
    if tag:
        projects = [
            p for p in projects
            if tag in (p.metadata_.get("tags") or [])
        ]

    # Get recording counts
    items = []
    for project in projects:
        count_result = await db.execute(
            select(func.count(Recording.id)).where(
                Recording.project_id == project.id
            )
        )
        recording_count = count_result.scalar() or 0

        items.append(
            ProjectResponse(
                id=project.id,
                name=project.name,
                description=project.description,
                project_type=_project_type_to_info(project.project_type),
                metadata=project.metadata_,
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
    from sqlalchemy.orm import selectinload

    # Validate project_type_id if provided
    project_type = None
    if data.project_type_id:
        result = await db.execute(
            select(ProjectType).where(ProjectType.id == data.project_type_id)
        )
        project_type = result.scalar_one_or_none()
        if not project_type:
            raise HTTPException(status_code=400, detail="Invalid project type ID")

    project = Project(
        name=data.name,
        description=data.description,
        project_type_id=data.project_type_id,
        metadata_=data.metadata or {},
    )
    db.add(project)
    await db.commit()

    # Create project folder on disk
    try:
        await storage_service.ensure_project_folder(data.name)
    except Exception as e:
        logger.warning(f"Could not create folder for project {project.id}: {e}")

    # Refresh with relationships
    result = await db.execute(
        select(Project)
        .options(selectinload(Project.project_type))
        .where(Project.id == project.id)
    )
    project = result.scalar_one()

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        project_type=_project_type_to_info(project.project_type),
        metadata=project.metadata_,
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
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(Project)
        .options(selectinload(Project.project_type))
        .where(Project.id == project_id)
    )
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    count_result = await db.execute(
        select(func.count(Recording.id)).where(
            Recording.project_id == project.id
        )
    )
    recording_count = count_result.scalar() or 0

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        project_type=_project_type_to_info(project.project_type),
        metadata=project.metadata_,
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
    from sqlalchemy.orm import selectinload

    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Handle name change - rename folder and update all file paths
    if data.name is not None and data.name != project.name:
        old_name = project.name
        new_name = data.name

        try:
            # Rename the project folder
            new_folder = await storage_service.rename_project_folder(old_name, new_name)

            # Update file paths for all recordings in this project
            rec_result = await db.execute(
                select(Recording).where(Recording.project_id == project_id)
            )
            for rec in rec_result.scalars():
                if rec.file_path:
                    old_path = Path(rec.file_path)
                    new_path = new_folder / old_path.name
                    rec.file_path = str(new_path)

            # Update file paths for all documents in this project
            doc_result = await db.execute(
                select(Document).where(Document.project_id == project_id)
            )
            for doc in doc_result.scalars():
                if doc.file_path:
                    old_path = Path(doc.file_path)
                    new_path = new_folder / old_path.name
                    doc.file_path = str(new_path)

        except Exception as e:
            logger.warning(f"Could not rename folder for project {project_id}: {e}")

        project.name = new_name

    if data.description is not None:
        project.description = data.description
    if data.project_type_id is not None:
        # Validate project_type_id
        if data.project_type_id:  # Not empty string
            pt_result = await db.execute(
                select(ProjectType).where(ProjectType.id == data.project_type_id)
            )
            if not pt_result.scalar_one_or_none():
                raise HTTPException(status_code=400, detail="Invalid project type ID")
        project.project_type_id = data.project_type_id if data.project_type_id else None
    if data.metadata is not None:
        project.metadata_ = data.metadata

    await db.commit()

    # Refresh with relationships
    result = await db.execute(
        select(Project)
        .options(selectinload(Project.project_type))
        .where(Project.id == project_id)
    )
    project = result.scalar_one()

    count_result = await db.execute(
        select(func.count(Recording.id)).where(
            Recording.project_id == project.id
        )
    )
    recording_count = count_result.scalar() or 0

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        project_type=_project_type_to_info(project.project_type),
        metadata=project.metadata_,
        recording_count=recording_count,
        created_at=project.created_at.isoformat(),
        updated_at=project.updated_at.isoformat(),
    )


@router.delete("/{project_id}", response_model=MessageResponse)
async def delete_project(
    db: Annotated[AsyncSession, Depends(get_db)],
    project_id: str,
) -> MessageResponse:
    """Delete a project. Files are moved to storage root, then folder deleted."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    project_name = project.name

    # Move recordings to root and clear project_id
    rec_result = await db.execute(
        select(Recording).where(Recording.project_id == project_id)
    )
    for rec in rec_result.scalars():
        if rec.file_path:
            try:
                old_path = Path(rec.file_path)
                if old_path.exists():
                    new_path = await storage_service.move_to_project(old_path, None)
                    rec.file_path = str(new_path)
            except Exception as e:
                logger.warning(f"Could not move file for recording {rec.id}: {e}")
        rec.project_id = None

    # Move documents to root and clear project_id
    doc_result = await db.execute(
        select(Document).where(Document.project_id == project_id)
    )
    for doc in doc_result.scalars():
        if doc.file_path:
            try:
                old_path = Path(doc.file_path)
                if old_path.exists():
                    new_path = await storage_service.move_to_project(old_path, None)
                    doc.file_path = str(new_path)
            except Exception as e:
                logger.warning(f"Could not move file for document {doc.id}: {e}")
        doc.project_id = None

    # Delete project
    await db.delete(project)
    await db.commit()

    # Delete project folder if empty
    try:
        await storage_service.delete_project_folder_if_empty(project_name)
    except Exception as e:
        logger.warning(f"Could not delete folder for project: {e}")

    return MessageResponse(message="Project deleted", id=project_id)


@router.post("/{project_id}/recordings/{recording_id}", response_model=MessageResponse)
async def add_recording_to_project(
    db: Annotated[AsyncSession, Depends(get_db)],
    project_id: str,
    recording_id: str,
) -> MessageResponse:
    """Add a recording to a project by setting its project_id and moving the file."""
    # Verify project exists
    project_result = await db.execute(select(Project).where(Project.id == project_id))
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Verify recording exists
    recording_result = await db.execute(select(Recording).where(Recording.id == recording_id))
    recording = recording_result.scalar_one_or_none()
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    # Check if already in this project
    if recording.project_id == project_id:
        return MessageResponse(message="Recording already in project", id=recording_id)

    # Move file to project folder
    if recording.file_path:
        try:
            old_path = Path(recording.file_path)
            if old_path.exists():
                new_path = await storage_service.move_to_project(old_path, project.name)
                recording.file_path = str(new_path)
        except Exception as e:
            logger.warning(f"Could not move file for recording {recording_id}: {e}")

    # Set the project_id
    recording.project_id = project_id
    await db.commit()

    return MessageResponse(message="Recording added to project", id=recording_id)


@router.delete("/{project_id}/recordings/{recording_id}", response_model=MessageResponse)
async def remove_recording_from_project(
    db: Annotated[AsyncSession, Depends(get_db)],
    project_id: str,
    recording_id: str,
) -> MessageResponse:
    """Remove a recording from a project by clearing its project_id and moving file to root."""
    recording_result = await db.execute(
        select(Recording).where(
            Recording.id == recording_id,
            Recording.project_id == project_id,
        )
    )
    recording = recording_result.scalar_one_or_none()

    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found in project")

    # Move file to root
    if recording.file_path:
        try:
            old_path = Path(recording.file_path)
            if old_path.exists():
                new_path = await storage_service.move_to_project(old_path, None)
                recording.file_path = str(new_path)
        except Exception as e:
            logger.warning(f"Could not move file for recording {recording_id}: {e}")

    recording.project_id = None
    await db.commit()

    return MessageResponse(message="Recording removed from project", id=recording_id)


class ProjectRecordingResponse(BaseModel):
    """Response model for a recording in a project context."""

    id: str
    title: str
    file_name: str
    duration_seconds: float | None
    status: str
    created_at: str
    updated_at: str


class ProjectRecordingsResponse(BaseModel):
    """Response model for listing recordings in a project."""

    items: list[ProjectRecordingResponse]
    total: int


@router.get("/{project_id}/recordings", response_model=ProjectRecordingsResponse)
async def get_project_recordings(
    db: Annotated[AsyncSession, Depends(get_db)],
    project_id: str,
) -> ProjectRecordingsResponse:
    """Get all recordings for a project."""
    # Verify project exists
    project_result = await db.execute(select(Project).where(Project.id == project_id))
    if not project_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    # Get recordings by project_id FK
    result = await db.execute(
        select(Recording)
        .where(Recording.project_id == project_id)
        .order_by(Recording.created_at.desc())
    )
    recordings = result.scalars().all()

    items = [
        ProjectRecordingResponse(
            id=r.id,
            title=r.title,
            file_name=r.file_name,
            duration_seconds=r.duration_seconds,
            status=r.status,
            created_at=r.created_at.isoformat(),
            updated_at=r.updated_at.isoformat(),
        )
        for r in recordings
    ]

    return ProjectRecordingsResponse(items=items, total=len(items))
