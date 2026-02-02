"""File browser API for unified filesystem-like navigation."""

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from persistence import get_db
from persistence.models import Document, Note, Project, Recording, Segment, Transcript, generate_uuid
from services.storage import storage_service, get_active_storage_location

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

    # Get active storage location for filtering
    active_location = await get_active_storage_location()
    active_location_id = active_location.id if active_location else None
    active_location_path = active_location.config.get("path") if active_location else None

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
            # Count items in project (filtered by storage location path)
            rec_count_query = select(func.count(Recording.id)).where(Recording.project_id == project.id)
            doc_count_query = select(func.count(Document.id)).where(Document.project_id == project.id)
            if active_location_path:
                rec_count_query = rec_count_query.where(Recording.file_path.startswith(active_location_path))
                doc_count_query = doc_count_query.where(Document.file_path.startswith(active_location_path))
            rec_count = await db.scalar(rec_count_query)
            doc_count = await db.scalar(doc_count_query)
            items.append(_project_to_item(project, (rec_count or 0) + (doc_count or 0)))

    # Get recordings in current folder (filtered by storage location path)
    rec_query = select(Recording).where(Recording.project_id == parent_id)
    if active_location_path:
        # Filter by file_path starting with storage location path
        rec_query = rec_query.where(Recording.file_path.startswith(active_location_path))
    if search:
        rec_query = rec_query.where(Recording.title.ilike(f"%{search}%"))
    rec_result = await db.execute(rec_query)
    recordings = rec_result.scalars().all()
    for rec in recordings:
        items.append(_recording_to_item(rec))

    # Get documents in current folder (filtered by storage location path)
    doc_query = select(Document).where(Document.project_id == parent_id)
    if active_location_path:
        # Filter by file_path starting with storage location path
        doc_query = doc_query.where(Document.file_path.startswith(active_location_path))
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
    # Get active storage location for filtering
    active_location = await get_active_storage_location()
    active_location_path = active_location.config.get("path") if active_location else None

    # Get all projects
    result = await db.execute(select(Project).order_by(Project.name))
    projects = result.scalars().all()

    children = []
    for project in projects:
        # Count items (filtered by storage location path)
        rec_count_query = select(func.count(Recording.id)).where(Recording.project_id == project.id)
        doc_count_query = select(func.count(Document.id)).where(Document.project_id == project.id)
        if active_location_path:
            rec_count_query = rec_count_query.where(Recording.file_path.startswith(active_location_path))
            doc_count_query = doc_count_query.where(Document.file_path.startswith(active_location_path))
        rec_count = await db.scalar(rec_count_query)
        doc_count = await db.scalar(doc_count_query)
        children.append(FolderTreeNode(
            id=project.id,
            name=project.name,
            item_count=(rec_count or 0) + (doc_count or 0),
            children=[],  # No nested folders yet
        ))

    # Count root items (filtered by storage location path)
    root_rec_query = select(func.count(Recording.id)).where(Recording.project_id.is_(None))
    root_doc_query = select(func.count(Document.id)).where(Document.project_id.is_(None))
    if active_location_path:
        root_rec_query = root_rec_query.where(Recording.file_path.startswith(active_location_path))
        root_doc_query = root_doc_query.where(Document.file_path.startswith(active_location_path))
    root_rec = await db.scalar(root_rec_query)
    root_doc = await db.scalar(root_doc_query)

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
    """Move an item to a different folder (updates DB and moves file on disk)."""
    from pathlib import Path

    # Validate target folder exists and get its name
    target_project_name = None
    if request.target_project_id:
        target = await db.get(Project, request.target_project_id)
        if not target:
            raise HTTPException(status_code=404, detail="Target folder not found")
        target_project_name = target.name

    if request.item_type == "recording":
        item = await db.get(Recording, request.item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Recording not found")

        # Move file on disk (works for both local and cloud storage)
        if item.file_path:
            try:
                new_path = await storage_service.move_to_project(item.file_path, target_project_name)
                item.file_path = str(new_path)
                item.file_name = new_path.name
            except Exception as e:
                logger.warning(f"Failed to move file on disk: {e}")

        item.project_id = request.target_project_id
        await db.commit()
        await db.refresh(item)
        return MessageResponse(message="Moved successfully", item=_recording_to_item(item))

    elif request.item_type == "document":
        item = await db.get(Document, request.item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Document not found")

        # Move file on disk (works for both local and cloud storage)
        if item.file_path:
            try:
                new_path = await storage_service.move_to_project(item.file_path, target_project_name)
                item.file_path = str(new_path)
                item.filename = new_path.name
            except Exception as e:
                logger.warning(f"Failed to move file on disk: {e}")

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
    from pathlib import Path
    import aiofiles

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
    new_title = f"{original.title} (Copy)"

    # Get target project name for path
    target_project_name = None
    if target_project_id:
        target = await db.get(Project, target_project_id)
        if target:
            target_project_name = target.name

    # Copy file to new human-readable path
    new_file_path = None
    new_file_name = original.file_name
    try:
        source_path = Path(original.file_path)
        if source_path.exists():
            async with aiofiles.open(source_path, "rb") as f:
                content = await f.read()
            new_path = await storage_service.save_upload(
                content=content,
                title=new_title,
                filename=original.file_name,
                project_name=target_project_name,
            )
            new_file_path = str(new_path)
            new_file_name = new_path.name
        else:
            logger.warning(f"Source file not found: {original.file_path}")
            new_file_path = original.file_path
    except Exception as e:
        logger.error(f"Failed to copy file: {e}")
        raise HTTPException(status_code=500, detail="Failed to copy file")

    # Create recording copy
    new_recording = Recording(
        id=new_id,
        title=new_title,
        file_path=new_file_path,
        file_name=new_file_name,
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
    from pathlib import Path
    import aiofiles

    result = await db.execute(
        select(Document)
        .options(selectinload(Document.notes))
        .where(Document.id == document_id)
    )
    original = result.scalar_one_or_none()
    if not original:
        raise HTTPException(status_code=404, detail="Document not found")

    new_id = generate_uuid()
    new_title = f"{original.title} (Copy)"

    # Get target project name for path
    target_project_name = None
    if target_project_id:
        target = await db.get(Project, target_project_id)
        if target:
            target_project_name = target.name

    # Copy file to new human-readable path
    new_file_path = None
    new_filename = original.filename
    try:
        source_path = Path(original.file_path)
        if source_path.exists():
            async with aiofiles.open(source_path, "rb") as f:
                content = await f.read()
            new_path = await storage_service.save_upload(
                content=content,
                title=new_title,
                filename=original.filename,
                project_name=target_project_name,
            )
            new_file_path = str(new_path)
            new_filename = new_path.name
        else:
            logger.warning(f"Source file not found: {original.file_path}")
            new_file_path = original.file_path
    except Exception as e:
        logger.error(f"Failed to copy file: {e}")
        raise HTTPException(status_code=500, detail="Failed to copy file")

    # Create document copy
    new_document = Document(
        id=new_id,
        title=new_title,
        filename=new_filename,
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
    """Rename an item (updates DB and renames file/folder on disk)."""
    from pathlib import Path

    if not request.new_name.strip():
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    new_name = request.new_name.strip()

    if request.item_type == "folder":
        item = await db.get(Project, request.item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Folder not found")

        old_name = item.name

        # Rename folder on disk and update all file paths
        try:
            new_folder = await storage_service.rename_project_folder(old_name, new_name)

            # Update file paths for all items in this project
            recordings = await db.execute(
                select(Recording).where(Recording.project_id == request.item_id)
            )
            for rec in recordings.scalars():
                if rec.file_path:
                    old_path = Path(rec.file_path)
                    new_path = new_folder / old_path.name
                    rec.file_path = str(new_path)

            documents = await db.execute(
                select(Document).where(Document.project_id == request.item_id)
            )
            for doc in documents.scalars():
                if doc.file_path:
                    old_path = Path(doc.file_path)
                    new_path = new_folder / old_path.name
                    doc.file_path = str(new_path)

        except Exception as e:
            logger.warning(f"Failed to rename folder on disk: {e}")

        item.name = new_name
        await db.commit()
        await db.refresh(item)
        return MessageResponse(message="Renamed successfully", item=_project_to_item(item))

    elif request.item_type == "recording":
        item = await db.get(Recording, request.item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Recording not found")

        # Rename file on disk
        if item.file_path:
            try:
                old_path = Path(item.file_path)
                if old_path.exists():
                    new_path = await storage_service.rename_item(old_path, new_name)
                    item.file_path = str(new_path)
                    item.file_name = new_path.name
            except Exception as e:
                logger.warning(f"Failed to rename file on disk: {e}")

        item.title = new_name
        await db.commit()
        await db.refresh(item)
        return MessageResponse(message="Renamed successfully", item=_recording_to_item(item))

    elif request.item_type == "document":
        item = await db.get(Document, request.item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Document not found")

        # Rename file on disk
        if item.file_path:
            try:
                old_path = Path(item.file_path)
                if old_path.exists():
                    new_path = await storage_service.rename_item(old_path, new_name)
                    item.file_path = str(new_path)
                    item.filename = new_path.name
            except Exception as e:
                logger.warning(f"Failed to rename file on disk: {e}")

        item.title = new_name
        await db.commit()
        await db.refresh(item)
        return MessageResponse(message="Renamed successfully", item=_document_to_item(item))

    else:
        raise HTTPException(status_code=400, detail="Invalid item type")


@router.delete("/{item_type}/{item_id}", response_model=MessageResponse)
async def delete_item(
    db: Annotated[AsyncSession, Depends(get_db)],
    item_type: Literal["folder", "recording", "document"],
    item_id: str,
    delete_files: Annotated[bool, Query(description="Delete all files in folder")] = False,
) -> MessageResponse:
    """Delete an item (removes from DB and deletes file from disk).

    For folders:
        - delete_files=True: Delete folder and all files inside
        - delete_files=False: Delete folder but move files to root
    """
    from pathlib import Path

    if item_type == "folder":
        project = await db.get(Project, item_id)
        if not project:
            raise HTTPException(status_code=404, detail="Folder not found")

        project_name = project.name

        # Get all recordings in this folder
        rec_result = await db.execute(
            select(Recording).where(Recording.project_id == item_id)
        )
        recordings = list(rec_result.scalars())

        # Get all documents in this folder
        doc_result = await db.execute(
            select(Document).where(Document.project_id == item_id)
        )
        documents = list(doc_result.scalars())

        if delete_files:
            # Delete all recordings and their files
            for rec in recordings:
                if rec.file_path:
                    try:
                        await storage_service.delete_file(rec.file_path)
                    except Exception as e:
                        logger.warning(f"Failed to delete recording file: {e}")
                await db.delete(rec)

            # Delete all documents and their files
            for doc in documents:
                if doc.file_path:
                    try:
                        await storage_service.delete_file(doc.file_path)
                    except Exception as e:
                        logger.warning(f"Failed to delete document file: {e}")
                await db.delete(doc)

            # Delete project
            await db.delete(project)
            await db.commit()

            # Delete project folder with any remaining contents
            try:
                await storage_service.delete_project_folder(project_name, delete_contents=True)
            except Exception as e:
                logger.warning(f"Failed to delete project folder: {e}")

            return MessageResponse(message="Folder and all files deleted")
        else:
            # Move contents to root (both DB and disk)
            for rec in recordings:
                if rec.file_path:
                    try:
                        new_path = await storage_service.move_to_project(rec.file_path, None)
                        rec.file_path = str(new_path)
                        rec.file_name = new_path.name
                    except Exception as e:
                        logger.warning(f"Failed to move recording file to root: {e}")
                rec.project_id = None

            for doc in documents:
                if doc.file_path:
                    try:
                        new_path = await storage_service.move_to_project(doc.file_path, None)
                        doc.file_path = str(new_path)
                        doc.filename = new_path.name
                    except Exception as e:
                        logger.warning(f"Failed to move document file to root: {e}")
                doc.project_id = None

            # Delete project
            await db.delete(project)
            await db.commit()

            # Delete project folder (should be empty now)
            try:
                await storage_service.delete_project_folder(project_name, delete_contents=False)
            except Exception as e:
                logger.warning(f"Failed to delete project folder: {e}")

            return MessageResponse(message="Folder deleted, files moved to root")

    elif item_type == "recording":
        recording = await db.get(Recording, item_id)
        if not recording:
            raise HTTPException(status_code=404, detail="Recording not found")

        # Delete file from disk (file_path is already the full path)
        if recording.file_path:
            try:
                await storage_service.delete_file(recording.file_path)
            except Exception as e:
                logger.warning(f"Failed to delete file: {e}")

        await db.delete(recording)
        await db.commit()
        return MessageResponse(message="Recording deleted")

    elif item_type == "document":
        document = await db.get(Document, item_id)
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")

        # Delete file from disk (file_path is already the full path)
        if document.file_path:
            try:
                await storage_service.delete_file(document.file_path)
            except Exception as e:
                logger.warning(f"Failed to delete file: {e}")

        await db.delete(document)
        await db.commit()
        return MessageResponse(message="Document deleted")

    else:
        raise HTTPException(status_code=400, detail="Invalid item type")
