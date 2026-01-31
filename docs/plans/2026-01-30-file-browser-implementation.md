# File Browser Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a filesystem-style browser UI with folder tree navigation, enabling standard file operations (copy, move, rename, delete) across projects, recordings, and documents.

**Architecture:** Projects become navigable folders; recordings and documents become files within them. Recording-Project relationship simplified to single FK. Storage locations model added for future cloud sync.

**Tech Stack:** FastAPI, SQLAlchemy, React, TypeScript, TailwindCSS

---

## Phase 1: Data Model Changes

### Task 1.1: Add StorageLocation Model

**Files:**
- Modify: `packages/backend/persistence/models.py`

**Step 1: Add StorageLocation class after Setting class**

```python
class StorageLocation(Base):
    """Storage location configuration for file storage."""

    __tablename__ = "storage_locations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)  # "local", "s3", "azure", "gcs"
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())
```

**Step 2: Verify model loads**

Run: `cd packages/backend && source .venv/bin/activate && python -c "from persistence.models import StorageLocation; print('OK')"`
Expected: OK

**Step 3: Commit**

```bash
git add packages/backend/persistence/models.py
git commit -m "feat(models): add StorageLocation model for configurable storage"
```

---

### Task 1.2: Add Recording.project_id FK and source_id

**Files:**
- Modify: `packages/backend/persistence/models.py`

**Step 1: Add new fields to Recording class (after template_id)**

```python
    project_id: Mapped[str | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL")
    )
    source_id: Mapped[str | None] = mapped_column(
        ForeignKey("recordings.id", ondelete="SET NULL")
    )
    storage_location_id: Mapped[str | None] = mapped_column(
        ForeignKey("storage_locations.id", ondelete="SET NULL")
    )
```

**Step 2: Add project relationship to Recording (replace existing projects many-to-many)**

Change:
```python
    projects: Mapped[list[Project]] = relationship(
        secondary="project_recordings", back_populates="recordings"
    )
```

To:
```python
    project: Mapped[Project | None] = relationship(back_populates="recordings")
    source: Mapped["Recording | None"] = relationship(remote_side=[id])
    storage_location: Mapped["StorageLocation | None"] = relationship()
```

**Step 3: Update Project.recordings relationship**

Change:
```python
    recordings: Mapped[list["Recording"]] = relationship(
        secondary="project_recordings", back_populates="recordings"
    )
```

To:
```python
    recordings: Mapped[list["Recording"]] = relationship(back_populates="project")
```

**Step 4: Verify model loads**

Run: `cd packages/backend && source .venv/bin/activate && python -c "from persistence.models import Recording, Project; print('OK')"`
Expected: OK

**Step 5: Commit**

```bash
git add packages/backend/persistence/models.py
git commit -m "feat(models): add Recording.project_id FK, source_id, storage_location_id"
```

---

### Task 1.3: Add Document.source_id and storage_location_id

**Files:**
- Modify: `packages/backend/persistence/models.py`

**Step 1: Add new fields to Document class (after project_id)**

```python
    source_id: Mapped[str | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL")
    )
    storage_location_id: Mapped[str | None] = mapped_column(
        ForeignKey("storage_locations.id", ondelete="SET NULL")
    )
```

**Step 2: Add relationships**

```python
    source: Mapped["Document | None"] = relationship(remote_side=[id])
    storage_location: Mapped["StorageLocation | None"] = relationship()
```

**Step 3: Verify model loads**

Run: `cd packages/backend && source .venv/bin/activate && python -c "from persistence.models import Document; print('OK')"`
Expected: OK

**Step 4: Commit**

```bash
git add packages/backend/persistence/models.py
git commit -m "feat(models): add Document.source_id and storage_location_id"
```

---

### Task 1.4: Create Database Migration

**Files:**
- Create: `packages/backend/migrations/migrate_file_browser.py`

**Step 1: Create migration script**

```python
"""Migration for file browser feature.

Adds:
- storage_locations table
- Recording: project_id, source_id, storage_location_id columns
- Document: source_id, storage_location_id columns
- Migrates data from project_recordings junction to Recording.project_id
- Creates default local storage location
"""

import asyncio
import logging
from sqlalchemy import text
from persistence.database import engine, async_session_factory

logger = logging.getLogger(__name__)


async def migrate():
    """Run the migration."""
    async with engine.begin() as conn:
        # 1. Create storage_locations table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS storage_locations (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                type VARCHAR(50) NOT NULL,
                config JSON DEFAULT '{}',
                is_default BOOLEAN DEFAULT FALSE,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))
        logger.info("Created storage_locations table")

        # 2. Add columns to recordings (if not exist)
        try:
            await conn.execute(text("ALTER TABLE recordings ADD COLUMN project_id VARCHAR(36) REFERENCES projects(id) ON DELETE SET NULL"))
        except Exception:
            logger.info("recordings.project_id already exists")

        try:
            await conn.execute(text("ALTER TABLE recordings ADD COLUMN source_id VARCHAR(36) REFERENCES recordings(id) ON DELETE SET NULL"))
        except Exception:
            logger.info("recordings.source_id already exists")

        try:
            await conn.execute(text("ALTER TABLE recordings ADD COLUMN storage_location_id VARCHAR(36) REFERENCES storage_locations(id) ON DELETE SET NULL"))
        except Exception:
            logger.info("recordings.storage_location_id already exists")

        # 3. Add columns to documents (if not exist)
        try:
            await conn.execute(text("ALTER TABLE documents ADD COLUMN source_id VARCHAR(36) REFERENCES documents(id) ON DELETE SET NULL"))
        except Exception:
            logger.info("documents.source_id already exists")

        try:
            await conn.execute(text("ALTER TABLE documents ADD COLUMN storage_location_id VARCHAR(36) REFERENCES storage_locations(id) ON DELETE SET NULL"))
        except Exception:
            logger.info("documents.storage_location_id already exists")

        # 4. Migrate data from junction table to FK
        # For each recording, take the first project from junction (if any)
        await conn.execute(text("""
            UPDATE recordings
            SET project_id = (
                SELECT project_id FROM project_recordings
                WHERE project_recordings.recording_id = recordings.id
                LIMIT 1
            )
            WHERE project_id IS NULL
            AND EXISTS (
                SELECT 1 FROM project_recordings
                WHERE project_recordings.recording_id = recordings.id
            )
        """))
        logger.info("Migrated project_recordings data to Recording.project_id")

        # 5. Create default storage location
        from persistence.models import generate_uuid
        from core.config import settings

        default_id = generate_uuid()
        await conn.execute(text("""
            INSERT INTO storage_locations (id, name, type, config, is_default, is_active)
            SELECT :id, 'Local Storage', 'local', :config, TRUE, TRUE
            WHERE NOT EXISTS (SELECT 1 FROM storage_locations WHERE is_default = TRUE)
        """), {
            "id": default_id,
            "config": f'{{"path": "{settings.MEDIA_DIR}"}}'
        })
        logger.info("Created default local storage location")

    logger.info("Migration complete")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(migrate())
```

**Step 2: Run migration**

Run: `cd packages/backend && source .venv/bin/activate && python -m migrations.migrate_file_browser`
Expected: Migration complete (with log messages)

**Step 3: Verify tables**

Run: `cd packages/backend && source .venv/bin/activate && python -c "from sqlalchemy import inspect; from persistence.database import engine; import asyncio; asyncio.run(engine.dispose()); print('OK')"`

**Step 4: Commit**

```bash
git add packages/backend/migrations/migrate_file_browser.py
git commit -m "feat(migration): add file browser schema changes"
```

---

## Phase 2: Storage Service Updates

### Task 2.1: Add copy_file Method to Storage Service

**Files:**
- Modify: `packages/backend/services/storage.py`

**Step 1: Add copy_file method**

```python
    async def copy_file(self, source_path: Path | str, dest_relative_path: str) -> Path:
        """Copy a file to a new location.

        Args:
            source_path: Full path to source file
            dest_relative_path: Relative destination path like "recordings/{id}/{filename}"

        Returns:
            Full path where the file was copied.
        """
        source = Path(source_path)
        if not source.exists():
            raise FileNotFoundError(f"Source file not found: {source}")

        # Use save_file logic for destination
        dest_path = self.get_full_path(dest_relative_path)

        # Ensure directory exists
        await aiofiles.os.makedirs(dest_path.parent, exist_ok=True)

        # Copy file content
        async with aiofiles.open(source, "rb") as src:
            content = await src.read()
        async with aiofiles.open(dest_path, "wb") as dst:
            await dst.write(content)

        return dest_path
```

**Step 2: Test manually**

Run: `cd packages/backend && source .venv/bin/activate && python -c "from services.storage import storage_service; print(hasattr(storage_service, 'copy_file'))"`
Expected: True

**Step 3: Commit**

```bash
git add packages/backend/services/storage.py
git commit -m "feat(storage): add copy_file method for file duplication"
```

---

## Phase 3: Browse API

### Task 3.1: Create Browse Router with List Endpoint

**Files:**
- Create: `packages/backend/api/routes/browse.py`

**Step 1: Create browse router with types and list endpoint**

```python
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
```

**Step 2: Register router in main.py**

Add to `packages/backend/api/main.py`:

```python
from api.routes.browse import router as browse_router
app.include_router(browse_router, prefix="/api")
```

**Step 3: Test endpoint**

Run: `curl -s http://localhost:8000/api/browse | head -c 200`
Expected: JSON response with items array

**Step 4: Commit**

```bash
git add packages/backend/api/routes/browse.py packages/backend/api/main.py
git commit -m "feat(api): add browse endpoint for file browser listing"
```

---

### Task 3.2: Add Folder Tree Endpoint

**Files:**
- Modify: `packages/backend/api/routes/browse.py`

**Step 1: Add tree types and endpoint**

```python
class FolderTreeNode(BaseModel):
    """A node in the folder tree."""

    id: str
    name: str
    item_count: int
    children: list["FolderTreeNode"] = []


class FolderTreeResponse(BaseModel):
    """Response for folder tree."""

    root: FolderTreeNode


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
```

**Step 2: Test endpoint**

Run: `curl -s http://localhost:8000/api/browse/tree | head -c 300`
Expected: JSON with root node and children

**Step 3: Commit**

```bash
git add packages/backend/api/routes/browse.py
git commit -m "feat(api): add folder tree endpoint for sidebar navigation"
```

---

### Task 3.3: Add Move Operation

**Files:**
- Modify: `packages/backend/api/routes/browse.py`

**Step 1: Add move request model and endpoint**

```python
class MoveRequest(BaseModel):
    """Request to move an item."""

    item_id: str
    item_type: Literal["recording", "document"]
    target_project_id: str | None  # null = move to root


class MessageResponse(BaseModel):
    """Generic message response."""

    message: str
    item: BrowseItem | None = None


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
```

**Step 2: Commit**

```bash
git add packages/backend/api/routes/browse.py
git commit -m "feat(api): add move operation for file browser"
```

---

### Task 3.4: Add Copy Operation

**Files:**
- Modify: `packages/backend/api/routes/browse.py`

**Step 1: Add copy endpoint**

```python
from sqlalchemy.orm import selectinload
from services.storage import storage_service
from persistence.models import Transcript, Segment, Note, generate_uuid


class CopyRequest(BaseModel):
    """Request to copy an item."""

    item_id: str
    item_type: Literal["recording", "document"]
    target_project_id: str | None


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
```

**Step 2: Commit**

```bash
git add packages/backend/api/routes/browse.py
git commit -m "feat(api): add copy operation with file and transcript duplication"
```

---

### Task 3.5: Add Rename Operation

**Files:**
- Modify: `packages/backend/api/routes/browse.py`

**Step 1: Add rename endpoint**

```python
class RenameRequest(BaseModel):
    """Request to rename an item."""

    item_id: str
    item_type: Literal["folder", "recording", "document"]
    new_name: str


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
```

**Step 2: Commit**

```bash
git add packages/backend/api/routes/browse.py
git commit -m "feat(api): add rename operation for file browser"
```

---

### Task 3.6: Add Delete Operation

**Files:**
- Modify: `packages/backend/api/routes/browse.py`

**Step 1: Add delete endpoint**

```python
@router.delete("/{item_type}/{item_id}", response_model=MessageResponse)
async def delete_item(
    db: Annotated[AsyncSession, Depends(get_db)],
    item_type: Literal["folder", "recording", "document"],
    item_id: str,
    recursive: Annotated[bool, Query(description="Delete folder contents")] = False,
) -> MessageResponse:
    """Delete an item."""
    if item_type == "folder":
        project = await db.get(Project, item_id)
        if not project:
            raise HTTPException(status_code=404, detail="Folder not found")

        # Check if folder has contents
        rec_count = await db.scalar(
            select(func.count(Recording.id)).where(Recording.project_id == item_id)
        )
        doc_count = await db.scalar(
            select(func.count(Document.id)).where(Document.project_id == item_id)
        )

        if (rec_count or 0) + (doc_count or 0) > 0 and not recursive:
            raise HTTPException(
                status_code=400,
                detail="Folder is not empty. Use recursive=true to delete contents."
            )

        # If recursive, move contents to root instead of deleting
        if recursive:
            await db.execute(
                select(Recording).where(Recording.project_id == item_id)
            )
            # Update recordings to have no project
            from sqlalchemy import update
            await db.execute(
                update(Recording).where(Recording.project_id == item_id).values(project_id=None)
            )
            await db.execute(
                update(Document).where(Document.project_id == item_id).values(project_id=None)
            )

        await db.delete(project)
        await db.commit()
        return MessageResponse(message="Folder deleted")

    elif item_type == "recording":
        recording = await db.get(Recording, item_id)
        if not recording:
            raise HTTPException(status_code=404, detail="Recording not found")

        # Delete file
        try:
            await storage_service.delete_file(storage_service.get_full_path(recording.file_path))
        except Exception as e:
            logger.warning(f"Failed to delete file: {e}")

        await db.delete(recording)
        await db.commit()
        return MessageResponse(message="Recording deleted")

    elif item_type == "document":
        document = await db.get(Document, item_id)
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")

        # Delete file
        try:
            await storage_service.delete_file(storage_service.get_full_path(document.file_path))
        except Exception as e:
            logger.warning(f"Failed to delete file: {e}")

        await db.delete(document)
        await db.commit()
        return MessageResponse(message="Document deleted")

    else:
        raise HTTPException(status_code=400, detail="Invalid item type")
```

**Step 2: Commit**

```bash
git add packages/backend/api/routes/browse.py
git commit -m "feat(api): add delete operation for file browser"
```

---

## Phase 4: Frontend API Client

### Task 4.1: Add Browse Types and Methods to API Client

**Files:**
- Modify: `packages/frontend/src/lib/api.ts`

**Step 1: Add browse types**

```typescript
// Browse types
export interface BrowseItem {
  id: string;
  type: 'folder' | 'recording' | 'document';
  name: string;
  updated_at: string;
  item_count?: number;
  status?: string;
  duration_seconds?: number;
  mime_type?: string;
  file_size_bytes?: number;
}

export interface BrowseResponse {
  current: BrowseItem | null;
  breadcrumb: BrowseItem[];
  items: BrowseItem[];
  total: number;
}

export interface FolderTreeNode {
  id: string;
  name: string;
  item_count: number;
  children: FolderTreeNode[];
}

export interface FolderTreeResponse {
  root: FolderTreeNode;
}
```

**Step 2: Add browse API methods**

```typescript
  browse: {
    list: async (params?: {
      parent_id?: string | null;
      sort?: string;
      order?: string;
      search?: string;
    }): Promise<BrowseResponse> => {
      const searchParams = new URLSearchParams();
      if (params?.parent_id) searchParams.set('parent_id', params.parent_id);
      if (params?.sort) searchParams.set('sort', params.sort);
      if (params?.order) searchParams.set('order', params.order);
      if (params?.search) searchParams.set('search', params.search);
      const query = searchParams.toString();
      return get(`/browse${query ? `?${query}` : ''}`);
    },

    tree: async (): Promise<FolderTreeResponse> => {
      return get('/browse/tree');
    },

    move: async (itemId: string, itemType: 'recording' | 'document', targetProjectId: string | null): Promise<{ message: string; item: BrowseItem }> => {
      return post('/browse/move', {
        item_id: itemId,
        item_type: itemType,
        target_project_id: targetProjectId,
      });
    },

    copy: async (itemId: string, itemType: 'recording' | 'document', targetProjectId: string | null): Promise<{ message: string; item: BrowseItem }> => {
      return post('/browse/copy', {
        item_id: itemId,
        item_type: itemType,
        target_project_id: targetProjectId,
      });
    },

    rename: async (itemId: string, itemType: 'folder' | 'recording' | 'document', newName: string): Promise<{ message: string; item: BrowseItem }> => {
      return post('/browse/rename', {
        item_id: itemId,
        item_type: itemType,
        new_name: newName,
      });
    },

    delete: async (itemType: 'folder' | 'recording' | 'document', itemId: string, recursive?: boolean): Promise<{ message: string }> => {
      const query = recursive ? '?recursive=true' : '';
      return del(`/browse/${itemType}/${itemId}${query}`);
    },
  },
```

**Step 3: Verify TypeScript compiles**

Run: `cd packages/frontend && npm run build 2>&1 | head -20`
Expected: No type errors

**Step 4: Commit**

```bash
git add packages/frontend/src/lib/api.ts
git commit -m "feat(api-client): add browse API types and methods"
```

---

## Phase 5: Frontend Components

### Task 5.1: Create FolderTree Component

**Files:**
- Create: `packages/frontend/src/components/browser/FolderTree.tsx`

**Step 1: Create folder tree component**

```typescript
import { useState, useEffect } from 'react';
import { api, type FolderTreeNode } from '@/lib/api';

interface FolderTreeProps {
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
}

function TreeNode({
  node,
  level,
  selectedId,
  onSelect,
}: {
  node: FolderTreeNode;
  level: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(level === 0);
  const isSelected = node.id === '' ? selectedId === null : selectedId === node.id;
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <button
        onClick={() => onSelect(node.id || null)}
        className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors ${
          isSelected
            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
            : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
        }`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
      >
        {hasChildren && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
          >
            <svg
              className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
        {!hasChildren && <span className="w-4" />}
        <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>
        <span className="flex-1 text-left truncate">{node.name}</span>
        <span className="text-xs text-gray-400">{node.item_count}</span>
      </button>
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FolderTree({ selectedFolderId, onSelectFolder }: FolderTreeProps) {
  const [tree, setTree] = useState<FolderTreeNode | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.browse.tree()
      .then((res) => setTree(res.root))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-4 text-sm text-gray-500">Loading...</div>
    );
  }

  if (!tree) {
    return (
      <div className="p-4 text-sm text-gray-500">Failed to load folders</div>
    );
  }

  return (
    <div className="py-2">
      <TreeNode
        node={tree}
        level={0}
        selectedId={selectedFolderId}
        onSelect={onSelectFolder}
      />
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/browser/FolderTree.tsx
git commit -m "feat(ui): add FolderTree component for sidebar navigation"
```

---

### Task 5.2: Create Breadcrumb Component

**Files:**
- Create: `packages/frontend/src/components/browser/Breadcrumb.tsx`

**Step 1: Create breadcrumb component**

```typescript
import { type BrowseItem } from '@/lib/api';

interface BreadcrumbProps {
  items: BrowseItem[];
  onNavigate: (folderId: string | null) => void;
}

export function Breadcrumb({ items, onNavigate }: BreadcrumbProps) {
  return (
    <nav className="flex items-center gap-1 text-sm">
      {items.map((item, index) => (
        <div key={item.id || 'root'} className="flex items-center">
          {index > 0 && (
            <svg className="w-4 h-4 text-gray-400 mx-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
          <button
            onClick={() => onNavigate(item.id || null)}
            className={`px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${
              index === items.length - 1
                ? 'font-medium text-gray-900 dark:text-gray-100'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {item.name}
          </button>
        </div>
      ))}
    </nav>
  );
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/browser/Breadcrumb.tsx
git commit -m "feat(ui): add Breadcrumb component for path navigation"
```

---

### Task 5.3: Create BrowserItem Component

**Files:**
- Create: `packages/frontend/src/components/browser/BrowserItem.tsx`

**Step 1: Create browser item component**

```typescript
import { type BrowseItem } from '@/lib/api';

interface BrowserItemProps {
  item: BrowseItem;
  viewMode: 'grid' | 'list';
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function ItemIcon({ type, mimeType }: { type: string; mimeType?: string }) {
  if (type === 'folder') {
    return (
      <svg className="w-10 h-10 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
      </svg>
    );
  }
  if (type === 'recording') {
    return (
      <svg className="w-10 h-10 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
      </svg>
    );
  }
  // Document
  const isPdf = mimeType === 'application/pdf';
  const isImage = mimeType?.startsWith('image/');
  if (isPdf) {
    return (
      <svg className="w-10 h-10 text-red-500" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
      </svg>
    );
  }
  if (isImage) {
    return (
      <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }
  return (
    <svg className="w-10 h-10 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
    </svg>
  );
}

export function BrowserItem({ item, viewMode, selected, onSelect, onOpen, onContextMenu }: BrowserItemProps) {
  const subtitle = item.type === 'folder'
    ? `${item.item_count} items`
    : item.type === 'recording'
    ? item.duration_seconds ? formatDuration(item.duration_seconds) : item.status
    : item.file_size_bytes ? formatSize(item.file_size_bytes) : '';

  if (viewMode === 'grid') {
    return (
      <div
        onClick={onSelect}
        onDoubleClick={onOpen}
        onContextMenu={onContextMenu}
        className={`p-4 rounded-lg border cursor-pointer transition-all ${
          selected
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
        }`}
      >
        <div className="flex flex-col items-center text-center">
          <ItemIcon type={item.type} mimeType={item.mime_type} />
          <p className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100 truncate w-full">
            {item.name}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>
      </div>
    );
  }

  // List view
  return (
    <div
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      className={`flex items-center gap-4 px-4 py-2 rounded-lg cursor-pointer transition-all ${
        selected
          ? 'bg-blue-50 dark:bg-blue-900/20'
          : 'hover:bg-gray-50 dark:hover:bg-gray-800'
      }`}
    >
      <ItemIcon type={item.type} mimeType={item.mime_type} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{item.name}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
      </div>
      <p className="text-xs text-gray-400">{new Date(item.updated_at).toLocaleDateString()}</p>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/browser/BrowserItem.tsx
git commit -m "feat(ui): add BrowserItem component for file/folder display"
```

---

### Task 5.4: Create FileBrowserPage

**Files:**
- Create: `packages/frontend/src/pages/browser/FileBrowserPage.tsx`

**Step 1: Create main browser page**

```typescript
import { useState, useEffect, useCallback } from 'react';
import { api, type BrowseItem, type BrowseResponse } from '@/lib/api';
import { FolderTree } from '@/components/browser/FolderTree';
import { Breadcrumb } from '@/components/browser/Breadcrumb';
import { BrowserItem } from '@/components/browser/BrowserItem';

interface FileBrowserPageProps {
  initialFolderId?: string | null;
  onViewRecording: (recordingId: string) => void;
  onViewDocument: (documentId: string) => void;
}

export function FileBrowserPage({ initialFolderId, onViewRecording, onViewDocument }: FileBrowserPageProps) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(initialFolderId ?? null);
  const [browseData, setBrowseData] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: BrowseItem } | null>(null);

  const loadFolder = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.browse.list({
        parent_id: currentFolderId ?? undefined,
        search: search || undefined,
      });
      setBrowseData(data);
      setSelectedItems(new Set());
    } catch (err) {
      console.error('Failed to load folder:', err);
    } finally {
      setLoading(false);
    }
  }, [currentFolderId, search]);

  useEffect(() => {
    loadFolder();
  }, [loadFolder]);

  const handleNavigate = (folderId: string | null) => {
    setCurrentFolderId(folderId);
  };

  const handleOpen = (item: BrowseItem) => {
    if (item.type === 'folder') {
      setCurrentFolderId(item.id);
    } else if (item.type === 'recording') {
      onViewRecording(item.id);
    } else if (item.type === 'document') {
      onViewDocument(item.id);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, item: BrowseItem) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  };

  const handleRename = async (item: BrowseItem) => {
    const newName = prompt('Enter new name:', item.name);
    if (newName && newName !== item.name) {
      try {
        await api.browse.rename(item.id, item.type, newName);
        loadFolder();
      } catch (err) {
        console.error('Failed to rename:', err);
      }
    }
    setContextMenu(null);
  };

  const handleDelete = async (item: BrowseItem) => {
    if (!confirm(`Delete "${item.name}"?`)) return;
    try {
      await api.browse.delete(item.type, item.id);
      loadFolder();
    } catch (err) {
      console.error('Failed to delete:', err);
    }
    setContextMenu(null);
  };

  const handleMove = async (item: BrowseItem) => {
    if (item.type === 'folder') return;
    const targetId = prompt('Enter target folder ID (empty for root):');
    if (targetId !== null) {
      try {
        await api.browse.move(item.id, item.type as 'recording' | 'document', targetId || null);
        loadFolder();
      } catch (err) {
        console.error('Failed to move:', err);
      }
    }
    setContextMenu(null);
  };

  const handleCopy = async (item: BrowseItem) => {
    if (item.type === 'folder') return;
    try {
      await api.browse.copy(item.id, item.type as 'recording' | 'document', currentFolderId);
      loadFolder();
    } catch (err) {
      console.error('Failed to copy:', err);
    }
    setContextMenu(null);
  };

  return (
    <div className="flex h-full">
      {/* Sidebar with folder tree */}
      <div className="w-56 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
        <div className="p-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Folders</h3>
        </div>
        <FolderTree selectedFolderId={currentFolderId} onSelectFolder={handleNavigate} />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-4">
          <Breadcrumb items={browseData?.breadcrumb || []} onNavigate={handleNavigate} />
          <div className="flex-1" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
          />
          <div className="flex border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 ${viewMode === 'grid' ? 'bg-gray-100 dark:bg-gray-700' : ''}`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 ${viewMode === 'list' ? 'bg-gray-100 dark:bg-gray-700' : ''}`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <svg className="w-8 h-8 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : browseData?.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <svg className="w-16 h-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <p>This folder is empty</p>
            </div>
          ) : (
            <div className={viewMode === 'grid' ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4' : 'space-y-1'}>
              {browseData?.items.map((item) => (
                <BrowserItem
                  key={`${item.type}-${item.id}`}
                  item={item}
                  viewMode={viewMode}
                  selected={selectedItems.has(item.id)}
                  onSelect={() => setSelectedItems(new Set([item.id]))}
                  onOpen={() => handleOpen(item)}
                  onContextMenu={(e) => handleContextMenu(e, item)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => handleOpen(contextMenu.item)}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Open
            </button>
            <button
              onClick={() => handleRename(contextMenu.item)}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Rename
            </button>
            {contextMenu.item.type !== 'folder' && (
              <>
                <button
                  onClick={() => handleCopy(contextMenu.item)}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Copy here
                </button>
                <button
                  onClick={() => handleMove(contextMenu.item)}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Move to...
                </button>
              </>
            )}
            <hr className="my-1 border-gray-200 dark:border-gray-700" />
            <button
              onClick={() => handleDelete(contextMenu.item)}
              className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/pages/browser/FileBrowserPage.tsx
git commit -m "feat(ui): add FileBrowserPage with grid/list view and context menu"
```

---

## Phase 6: Navigation Integration

### Task 6.1: Add Browser to App Navigation

**Files:**
- Modify: `packages/frontend/src/app/App.tsx`

**Step 1: Add browser navigation type**

In the NavigationState type, add:
```typescript
  | { type: 'browser'; folderId?: string | null }
```

**Step 2: Add navigation handler**

```typescript
const handleNavigateToBrowser = (folderId?: string | null) => {
  setNavigation({ type: 'browser', folderId });
};
```

**Step 3: Add browser case in render**

```typescript
{navigation.type === 'browser' && (
  <FileBrowserPage
    initialFolderId={navigation.folderId}
    onViewRecording={(id) => setNavigation({ type: 'transcript'; recordingId: id })}
    onViewDocument={(id) => setNavigation({ type: 'document-viewer'; documentId: id })}
  />
)}
```

**Step 4: Import FileBrowserPage**

```typescript
import { FileBrowserPage } from '@/pages/browser/FileBrowserPage';
```

**Step 5: Commit**

```bash
git add packages/frontend/src/app/App.tsx
git commit -m "feat(nav): integrate FileBrowserPage into app navigation"
```

---

### Task 6.2: Add Files Item to Sidebar

**Files:**
- Modify: `packages/frontend/src/components/layout/Sidebar.tsx`

**Step 1: Add Files nav item**

In the nav items array, add after Dashboard or at desired position:
```typescript
{
  icon: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  ),
  label: 'Files',
  path: 'browser',
},
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/layout/Sidebar.tsx
git commit -m "feat(nav): add Files item to sidebar for file browser"
```

---

## Phase 7: Final Integration

### Task 7.1: Update Existing Code for Recording.project_id

**Files:**
- Modify: `packages/backend/api/routes/recordings.py` (if exists)
- Modify: `packages/backend/api/routes/projects.py` (if exists)

**Step 1: Update any code using Recording.projects relationship**

Search for `recording.projects` or `Recording.projects` and update to use `recording.project` or `Recording.project`.

**Step 2: Test the application**

Run: `cd packages/frontend && npm run build`
Expected: No errors

Run: `curl -s http://localhost:8000/api/browse | head -c 100`
Expected: Valid JSON response

**Step 3: Commit**

```bash
git add -A
git commit -m "fix: update code for Recording.project_id FK relationship"
```

---

### Task 7.2: Run Full Verification

**Step 1: Run backend tests**

Run: `cd packages/backend && source .venv/bin/activate && pytest tests/ -v --tb=short 2>&1 | tail -30`

**Step 2: Run frontend build**

Run: `cd packages/frontend && npm run build`

**Step 3: Manual testing checklist**

- [ ] Navigate to Files in sidebar
- [ ] See folder tree with projects
- [ ] Click folder to navigate into it
- [ ] See recordings and documents in folder
- [ ] Double-click to open item
- [ ] Right-click context menu works
- [ ] Rename works
- [ ] Copy creates duplicate
- [ ] Move changes location
- [ ] Delete removes item
- [ ] Search filters items
- [ ] Grid/list toggle works

**Step 4: Final commit and tag**

```bash
git add -A
git commit -m "feat: complete file browser implementation"
```

---

## Summary

| Phase | Tasks | Files |
|-------|-------|-------|
| 1. Data Model | 4 tasks | models.py, migration |
| 2. Storage | 1 task | storage.py |
| 3. Browse API | 6 tasks | browse.py, main.py |
| 4. API Client | 1 task | api.ts |
| 5. Components | 4 tasks | FolderTree, Breadcrumb, BrowserItem, FileBrowserPage |
| 6. Navigation | 2 tasks | App.tsx, Sidebar.tsx |
| 7. Integration | 2 tasks | Various fixes |

**Total: 20 tasks**
