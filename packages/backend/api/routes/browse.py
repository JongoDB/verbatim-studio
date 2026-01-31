"""File browser API for unified filesystem-like navigation."""

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from persistence import get_db
from persistence.models import Document, Note, Project, Recording, Segment, Transcript, generate_uuid
from services.storage import storage_service

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


class FolderTreeNode(BaseModel):
    """A node in the folder tree."""

    id: str
    name: str
    item_count: int
    children: list["FolderTreeNode"] = []


class FolderTreeResponse(BaseModel):
    """Response for folder tree."""

    root: FolderTreeNode


class MoveRequest(BaseModel):
    """Request to move an item."""

    item_id: str
    item_type: Literal["recording", "document"]
    target_project_id: str | None  # null = move to root


class CopyRequest(BaseModel):
    """Request to copy an item."""

    item_id: str
    item_type: Literal["recording", "document"]
    target_project_id: str | None


class RenameRequest(BaseModel):
    """Request to rename an item."""

    item_id: str
    item_type: Literal["folder", "recording", "document"]
    new_name: str


class MessageResponse(BaseModel):
    """Generic message response."""

    message: str
    item: BrowseItem | None = None


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


@router.get("/tree", response_model=FolderTreeResponse)
async def get_folder_tree(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FolderTreeResponse:
    """Get folder hierarchy for sidebar navigation."""
    # Get all projects
    result = await db.execute(select(Project).order_by(Project.name))
    projects = result.scalars().all()

    children = []
    for project in projects:
        # Count items
        rec_count = await db.scalar(
            select(func.count(Recording.id)).where(Recording.project_id == project.id)
        )
        doc_count = await db.scalar(
            select(func.count(Document.id)).where(Document.project_id == project.id)
        )
        children.append(FolderTreeNode(
            id=project.id,
            name=project.name,
            item_count=(rec_count or 0) + (doc_count or 0),
            children=[],  # No nested folders yet
        ))

    # Count root items
    root_rec = await db.scalar(
        select(func.count(Recording.id)).where(Recording.project_id.is_(None))
    )
    root_doc = await db.scalar(
        select(func.count(Document.id)).where(Document.project_id.is_(None))
    )

    root = FolderTreeNode(
        id="",
        name="My Files",
        item_count=(root_rec or 0) + (root_doc or 0) + len(children),
        children=children,
    )

    return FolderTreeResponse(root=root)


@router.post("/move", response_model=MessageResponse)
async def move_item(
    db: Annotated[AsyncSession, Depends(get_db)],
    request: MoveRequest,
) -> MessageResponse:
    """Move an item to a different folder."""
    # Validate target folder exists
    if request.target_project_id:
        target = await db.get(Project, request.target_project_id)
        if not target:
            raise HTTPException(status_code=404, detail="Target folder not found")

    if request.item_type == "recording":
        item = await db.get(Recording, request.item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Recording not found")
        item.project_id = request.target_project_id
        await db.commit()
        await db.refresh(item)
        return MessageResponse(message="Moved successfully", item=_recording_to_item(item))

    elif request.item_type == "document":
        item = await db.get(Document, request.item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Document not found")
        item.project_id = request.target_project_id
        await db.commit()
        await db.refresh(item)
        return MessageResponse(message="Moved successfully", item=_document_to_item(item))

    else:
        raise HTTPException(status_code=400, detail="Invalid item type")


@router.post("/copy", response_model=MessageResponse)
async def copy_item(
    db: Annotated[AsyncSession, Depends(get_db)],
    request: CopyRequest,
) -> MessageResponse:
    """Copy an item to a folder. Creates independent copy with file duplication."""
    # Validate target folder exists
    if request.target_project_id:
        target = await db.get(Project, request.target_project_id)
        if not target:
            raise HTTPException(status_code=404, detail="Target folder not found")

    if request.item_type == "recording":
        return await _copy_recording(db, request.item_id, request.target_project_id)
    elif request.item_type == "document":
        return await _copy_document(db, request.item_id, request.target_project_id)
    else:
        raise HTTPException(status_code=400, detail="Invalid item type")


async def _copy_recording(
    db: AsyncSession,
    recording_id: str,
    target_project_id: str | None,
) -> MessageResponse:
    """Copy a recording with its transcript and notes."""
    # Load recording with relationships
    result = await db.execute(
        select(Recording)
        .options(
            selectinload(Recording.transcript).selectinload(Transcript.segments),
            selectinload(Recording.notes),
        )
        .where(Recording.id == recording_id)
    )
    original = result.scalar_one_or_none()
    if not original:
        raise HTTPException(status_code=404, detail="Recording not found")

    new_id = generate_uuid()

    # Copy file
    try:
        source_path = storage_service.get_full_path(original.file_path)
        new_file_path = f"recordings/{new_id}/{original.file_name}"
        await storage_service.copy_file(source_path, new_file_path)
    except FileNotFoundError:
        logger.warning(f"Source file not found: {original.file_path}")
        new_file_path = original.file_path  # Keep original path if file missing
    except Exception as e:
        logger.error(f"Failed to copy file: {e}")
        raise HTTPException(status_code=500, detail="Failed to copy file")

    # Create recording copy
    new_recording = Recording(
        id=new_id,
        title=f"{original.title} (Copy)",
        file_path=new_file_path,
        file_name=original.file_name,
        file_size=original.file_size,
        duration_seconds=original.duration_seconds,
        mime_type=original.mime_type,
        metadata_=original.metadata_.copy() if original.metadata_ else {},
        status=original.status,
        project_id=target_project_id,
        source_id=original.id,
        template_id=original.template_id,
    )
    db.add(new_recording)

    # Copy transcript if exists
    if original.transcript:
        new_transcript = Transcript(
            id=generate_uuid(),
            recording_id=new_id,
            language=original.transcript.language,
            model_used=original.transcript.model_used,
            confidence_avg=original.transcript.confidence_avg,
            word_count=original.transcript.word_count,
        )
        db.add(new_transcript)

        # Copy segments
        for seg in original.transcript.segments:
            new_segment = Segment(
                id=generate_uuid(),
                transcript_id=new_transcript.id,
                segment_index=seg.segment_index,
                start_time=seg.start_time,
                end_time=seg.end_time,
                text=seg.text,
                speaker=seg.speaker,
                confidence=seg.confidence,
                edited=seg.edited,
            )
            db.add(new_segment)

    # Copy notes
    for note in original.notes:
        new_note = Note(
            id=generate_uuid(),
            recording_id=new_id,
            content=note.content,
            anchor_type=note.anchor_type,
            anchor_data=note.anchor_data.copy() if note.anchor_data else {},
        )
        db.add(new_note)

    await db.commit()
    await db.refresh(new_recording)

    return MessageResponse(message="Copied successfully", item=_recording_to_item(new_recording))


async def _copy_document(
    db: AsyncSession,
    document_id: str,
    target_project_id: str | None,
) -> MessageResponse:
    """Copy a document with its notes."""
    result = await db.execute(
        select(Document)
        .options(selectinload(Document.notes))
        .where(Document.id == document_id)
    )
    original = result.scalar_one_or_none()
    if not original:
        raise HTTPException(status_code=404, detail="Document not found")

    new_id = generate_uuid()

    # Copy file
    try:
        source_path = storage_service.get_full_path(original.file_path)
        new_file_path = f"documents/{new_id}/{original.filename}"
        await storage_service.copy_file(source_path, new_file_path)
    except FileNotFoundError:
        logger.warning(f"Source file not found: {original.file_path}")
        new_file_path = original.file_path
    except Exception as e:
        logger.error(f"Failed to copy file: {e}")
        raise HTTPException(status_code=500, detail="Failed to copy file")

    # Create document copy
    new_document = Document(
        id=new_id,
        title=f"{original.title} (Copy)",
        filename=original.filename,
        file_path=new_file_path,
        mime_type=original.mime_type,
        file_size_bytes=original.file_size_bytes,
        project_id=target_project_id,
        source_id=original.id,
        status=original.status,
        extracted_text=original.extracted_text,
        extracted_markdown=original.extracted_markdown,
        page_count=original.page_count,
        metadata_=original.metadata_.copy() if original.metadata_ else {},
    )
    db.add(new_document)

    # Copy notes
    for note in original.notes:
        new_note = Note(
            id=generate_uuid(),
            document_id=new_id,
            content=note.content,
            anchor_type=note.anchor_type,
            anchor_data=note.anchor_data.copy() if note.anchor_data else {},
        )
        db.add(new_note)

    await db.commit()
    await db.refresh(new_document)

    return MessageResponse(message="Copied successfully", item=_document_to_item(new_document))


@router.post("/rename", response_model=MessageResponse)
async def rename_item(
    db: Annotated[AsyncSession, Depends(get_db)],
    request: RenameRequest,
) -> MessageResponse:
    """Rename an item."""
    if not request.new_name.strip():
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    if request.item_type == "folder":
        item = await db.get(Project, request.item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Folder not found")
        item.name = request.new_name.strip()
        await db.commit()
        await db.refresh(item)
        return MessageResponse(message="Renamed successfully", item=_project_to_item(item))

    elif request.item_type == "recording":
        item = await db.get(Recording, request.item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Recording not found")
        item.title = request.new_name.strip()
        await db.commit()
        await db.refresh(item)
        return MessageResponse(message="Renamed successfully", item=_recording_to_item(item))

    elif request.item_type == "document":
        item = await db.get(Document, request.item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Document not found")
        item.title = request.new_name.strip()
        await db.commit()
        await db.refresh(item)
        return MessageResponse(message="Renamed successfully", item=_document_to_item(item))

    else:
        raise HTTPException(status_code=400, detail="Invalid item type")
