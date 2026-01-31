"""File browser API for unified filesystem-like navigation."""

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from persistence import get_db
from persistence.models import Document, Project, Recording

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/browse", tags=["browse"])


class BrowseItem(BaseModel):
    """A file or folder in the browser."""

    id: str
    type: Literal["folder", "recording", "document"]
    name: str
    updated_at: str
    # Folder-specific
    item_count: int | None = None
    # Recording-specific
    status: str | None = None
    duration_seconds: float | None = None
    # Document-specific
    mime_type: str | None = None
    file_size_bytes: int | None = None


class BrowseResponse(BaseModel):
    """Response for browse listing."""

    current: BrowseItem | None  # null at root
    breadcrumb: list[BrowseItem]
    items: list[BrowseItem]
    total: int


def _project_to_item(project: Project, item_count: int = 0) -> BrowseItem:
    return BrowseItem(
        id=project.id,
        type="folder",
        name=project.name,
        updated_at=project.updated_at.isoformat(),
        item_count=item_count,
    )


def _recording_to_item(recording: Recording) -> BrowseItem:
    return BrowseItem(
        id=recording.id,
        type="recording",
        name=recording.title,
        updated_at=recording.updated_at.isoformat(),
        status=recording.status,
        duration_seconds=recording.duration_seconds,
    )


def _document_to_item(document: Document) -> BrowseItem:
    return BrowseItem(
        id=document.id,
        type="document",
        name=document.title,
        updated_at=document.updated_at.isoformat(),
        mime_type=document.mime_type,
        file_size_bytes=document.file_size_bytes,
    )


@router.get("", response_model=BrowseResponse)
async def browse(
    db: Annotated[AsyncSession, Depends(get_db)],
    parent_id: Annotated[str | None, Query(description="Folder ID (project_id), null for root")] = None,
    sort: Annotated[str, Query(description="Sort field: name, updated_at, type")] = "name",
    order: Annotated[str, Query(description="Sort order: asc, desc")] = "asc",
    search: Annotated[str | None, Query(description="Search filter")] = None,
) -> BrowseResponse:
    """List folders and files at the given path."""
    items: list[BrowseItem] = []
    breadcrumb: list[BrowseItem] = []
    current: BrowseItem | None = None

    # Build breadcrumb
    if parent_id:
        project = await db.get(Project, parent_id)
        if not project:
            raise HTTPException(status_code=404, detail="Folder not found")
        current = _project_to_item(project)
        breadcrumb = [
            BrowseItem(id="", type="folder", name="My Files", updated_at=""),
            current,
        ]
    else:
        breadcrumb = [BrowseItem(id="", type="folder", name="My Files", updated_at="")]

    # Get subfolders (projects at root, none within projects for now)
    if parent_id is None:
        # At root: show all projects as folders
        folder_query = select(Project)
        if search:
            folder_query = folder_query.where(Project.name.ilike(f"%{search}%"))
        folder_result = await db.execute(folder_query)
        projects = folder_result.scalars().all()

        for project in projects:
            # Count items in project
            rec_count = await db.scalar(
                select(func.count(Recording.id)).where(Recording.project_id == project.id)
            )
            doc_count = await db.scalar(
                select(func.count(Document.id)).where(Document.project_id == project.id)
            )
            items.append(_project_to_item(project, (rec_count or 0) + (doc_count or 0)))

    # Get recordings in current folder
    rec_query = select(Recording).where(Recording.project_id == parent_id)
    if search:
        rec_query = rec_query.where(Recording.title.ilike(f"%{search}%"))
    rec_result = await db.execute(rec_query)
    recordings = rec_result.scalars().all()
    for rec in recordings:
        items.append(_recording_to_item(rec))

    # Get documents in current folder
    doc_query = select(Document).where(Document.project_id == parent_id)
    if search:
        doc_query = doc_query.where(Document.title.ilike(f"%{search}%"))
    doc_result = await db.execute(doc_query)
    documents = doc_result.scalars().all()
    for doc in documents:
        items.append(_document_to_item(doc))

    # Sort items
    reverse = order == "desc"
    if sort == "name":
        items.sort(key=lambda x: x.name.lower(), reverse=reverse)
    elif sort == "updated_at":
        items.sort(key=lambda x: x.updated_at, reverse=reverse)
    elif sort == "type":
        type_order = {"folder": 0, "recording": 1, "document": 2}
        items.sort(key=lambda x: (type_order.get(x.type, 9), x.name.lower()), reverse=reverse)

    return BrowseResponse(
        current=current,
        breadcrumb=breadcrumb,
        items=items,
        total=len(items),
    )
