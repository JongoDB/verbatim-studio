# Document Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add document upload, OCR processing, notes, and RAG integration to Verbatim Studio.

**Architecture:** Documents stored in `media/documents/`, processed via background jobs using Chandra OCR for images/PDFs and python libraries for Office formats. Embeddings stored alongside transcript embeddings for unified RAG queries.

**Tech Stack:** FastAPI, SQLAlchemy, Chandra OCR, python-docx, openpyxl, python-pptx, React, TypeScript

**Working Directory:** `/Users/JonWFH/jondev/verbatim-studio/.worktrees/document-management`

---

## Phase 1: Database Models & Migrations

### Task 1.1: Add Document Model

**Files:**
- Modify: `packages/backend/persistence/models.py`

**Step 1: Add Document class after SegmentEmbedding class**

```python
class Document(Base):
    """Document model for uploaded files (PDF, Office docs, images)."""

    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    project_id: Mapped[str | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL")
    )

    # Processing state
    status: Mapped[str] = mapped_column(String(20), default="pending")
    error_message: Mapped[str | None] = mapped_column(Text)

    # Extracted content
    extracted_text: Mapped[str | None] = mapped_column(Text)
    extracted_markdown: Mapped[str | None] = mapped_column(Text)
    page_count: Mapped[int | None] = mapped_column(Integer)

    # Metadata
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    project: Mapped["Project | None"] = relationship()
    notes: Mapped[list["Note"]] = relationship(back_populates="document", cascade="all, delete-orphan")
```

**Step 2: Add Note class after Document class**

```python
class Note(Base):
    """Note attached to a recording or document with contextual anchor."""

    __tablename__ = "notes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # Polymorphic attachment (one of these set)
    recording_id: Mapped[str | None] = mapped_column(
        ForeignKey("recordings.id", ondelete="CASCADE")
    )
    document_id: Mapped[str | None] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE")
    )

    # Context anchoring
    anchor_type: Mapped[str] = mapped_column(String(20), nullable=False)  # timestamp, page, paragraph
    anchor_data: Mapped[dict] = mapped_column(JSON, nullable=False)

    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    recording: Mapped["Recording | None"] = relationship()
    document: Mapped["Document | None"] = relationship(back_populates="notes")
```

**Step 3: Add DocumentEmbedding class after Note class**

```python
class DocumentEmbedding(Base):
    """Embedding vector for a document chunk."""

    __tablename__ = "document_embeddings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    document_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    chunk_metadata: Mapped[dict] = mapped_column(JSON, default=dict)  # {page: 3, heading: "..."}
    embedding: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    model_used: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    document: Mapped["Document"] = relationship()
```

**Step 4: Commit**

```bash
git add packages/backend/persistence/models.py
git commit -m "feat: add Document, Note, and DocumentEmbedding models"
```

---

### Task 1.2: Create Database Tables

**Files:**
- Modify: `packages/backend/persistence/database.py` (if needed)

**Step 1: Run the app to auto-create tables**

The existing `create_tables()` function in database.py uses `Base.metadata.create_all()` which will create the new tables automatically.

**Step 2: Verify tables exist**

```bash
cd packages/backend
python3 -c "
from persistence.database import engine
from persistence.models import Document, Note, DocumentEmbedding
from sqlalchemy import inspect
inspector = inspect(engine)
tables = inspector.get_table_names()
print('documents' in tables, 'notes' in tables, 'document_embeddings' in tables)
"
```

Expected: `True True True`

**Step 3: Commit if any changes**

```bash
git add -A
git commit -m "chore: verify database tables created" --allow-empty
```

---

## Phase 2: Document CRUD API

### Task 2.1: Create Documents Router

**Files:**
- Create: `packages/backend/api/routes/documents.py`

**Step 1: Create the documents router file**

```python
"""Document management endpoints."""

import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from persistence.database import get_db
from persistence.models import Document, Project
from services.storage import storage_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/documents", tags=["documents"])

# Allowed MIME types
ALLOWED_MIME_TYPES = {
    # Documents
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # DOCX
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # XLSX
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",  # PPTX
    "text/plain",
    "text/markdown",
    # Images
    "image/png",
    "image/jpeg",
    "image/tiff",
    "image/webp",
}


class DocumentResponse(BaseModel):
    """Response model for a document."""

    id: str
    title: str
    filename: str
    file_path: str
    mime_type: str
    file_size_bytes: int
    project_id: str | None
    status: str
    error_message: str | None
    page_count: int | None
    metadata: dict
    created_at: str
    updated_at: str


class DocumentListResponse(BaseModel):
    """Response model for listing documents."""

    items: list[DocumentResponse]
    total: int


class DocumentUpdate(BaseModel):
    """Request model for updating a document."""

    title: str | None = None
    project_id: str | None = None


class MessageResponse(BaseModel):
    """Generic message response."""

    message: str
    id: str | None = None


def _doc_to_response(doc: Document) -> DocumentResponse:
    """Convert Document model to response."""
    return DocumentResponse(
        id=doc.id,
        title=doc.title,
        filename=doc.filename,
        file_path=doc.file_path,
        mime_type=doc.mime_type,
        file_size_bytes=doc.file_size_bytes,
        project_id=doc.project_id,
        status=doc.status,
        error_message=doc.error_message,
        page_count=doc.page_count,
        metadata=doc.metadata_,
        created_at=doc.created_at.isoformat(),
        updated_at=doc.updated_at.isoformat(),
    )


@router.post("", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(
    db: Annotated[AsyncSession, Depends(get_db)],
    file: UploadFile = File(...),
    title: str = Form(None),
    project_id: str = Form(None),
) -> DocumentResponse:
    """Upload a new document."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename required")

    # Validate MIME type
    mime_type = file.content_type or "application/octet-stream"
    if mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {mime_type}. Allowed: PDF, DOCX, XLSX, PPTX, TXT, MD, PNG, JPG, TIFF"
        )

    # Validate project exists if provided
    if project_id:
        project = await db.get(Project, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

    # Read file content
    content = await file.read()
    file_size = len(content)

    # Generate storage path
    from persistence.models import generate_uuid
    doc_id = generate_uuid()
    file_path = f"documents/{doc_id}/{file.filename}"

    # Save to storage
    storage_service.save_file(file_path, content)

    # Create document record
    doc = Document(
        id=doc_id,
        title=title or file.filename,
        filename=file.filename,
        file_path=file_path,
        mime_type=mime_type,
        file_size_bytes=file_size,
        project_id=project_id,
        status="pending",
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    # TODO: Queue processing job

    return _doc_to_response(doc)


@router.get("", response_model=DocumentListResponse)
async def list_documents(
    db: Annotated[AsyncSession, Depends(get_db)],
    project_id: Annotated[str | None, Query(description="Filter by project")] = None,
    status_filter: Annotated[str | None, Query(alias="status", description="Filter by status")] = None,
    search: Annotated[str | None, Query(description="Search by title")] = None,
) -> DocumentListResponse:
    """List all documents with optional filters."""
    query = select(Document).order_by(Document.created_at.desc())

    if project_id:
        query = query.where(Document.project_id == project_id)
    if status_filter:
        query = query.where(Document.status == status_filter)
    if search:
        query = query.where(Document.title.ilike(f"%{search}%"))

    result = await db.execute(query)
    docs = result.scalars().all()

    return DocumentListResponse(
        items=[_doc_to_response(doc) for doc in docs],
        total=len(docs),
    )


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    db: Annotated[AsyncSession, Depends(get_db)],
    document_id: str,
) -> DocumentResponse:
    """Get a single document by ID."""
    doc = await db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return _doc_to_response(doc)


@router.patch("/{document_id}", response_model=DocumentResponse)
async def update_document(
    db: Annotated[AsyncSession, Depends(get_db)],
    document_id: str,
    update: DocumentUpdate,
) -> DocumentResponse:
    """Update a document's title or project assignment."""
    doc = await db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if update.title is not None:
        doc.title = update.title
    if update.project_id is not None:
        if update.project_id:
            project = await db.get(Project, update.project_id)
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")
        doc.project_id = update.project_id or None

    await db.commit()
    await db.refresh(doc)
    return _doc_to_response(doc)


@router.delete("/{document_id}", response_model=MessageResponse)
async def delete_document(
    db: Annotated[AsyncSession, Depends(get_db)],
    document_id: str,
) -> MessageResponse:
    """Delete a document and its file."""
    doc = await db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Delete file from storage
    try:
        storage_service.delete_file(doc.file_path)
    except Exception as e:
        logger.warning(f"Failed to delete file {doc.file_path}: {e}")

    await db.delete(doc)
    await db.commit()

    return MessageResponse(message="Document deleted", id=document_id)


@router.get("/{document_id}/file")
async def download_document_file(
    db: Annotated[AsyncSession, Depends(get_db)],
    document_id: str,
) -> FileResponse:
    """Download the original document file."""
    doc = await db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = storage_service.get_full_path(doc.file_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=file_path,
        filename=doc.filename,
        media_type=doc.mime_type,
    )


@router.get("/{document_id}/content")
async def get_document_content(
    db: Annotated[AsyncSession, Depends(get_db)],
    document_id: str,
    format: Annotated[str, Query(description="Output format: text or markdown")] = "markdown",
) -> dict:
    """Get extracted text content from a document."""
    doc = await db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if doc.status != "completed":
        raise HTTPException(status_code=400, detail=f"Document not processed yet (status: {doc.status})")

    if format == "markdown" and doc.extracted_markdown:
        return {"content": doc.extracted_markdown, "format": "markdown"}
    elif doc.extracted_text:
        return {"content": doc.extracted_text, "format": "text"}
    else:
        raise HTTPException(status_code=404, detail="No extracted content available")
```

**Step 2: Commit**

```bash
git add packages/backend/api/routes/documents.py
git commit -m "feat: add documents CRUD API endpoints"
```

---

### Task 2.2: Register Documents Router

**Files:**
- Modify: `packages/backend/api/main.py`

**Step 1: Import and include documents router**

Add import at top with other route imports:
```python
from api.routes.documents import router as documents_router
```

Add router registration with other routers:
```python
app.include_router(documents_router, prefix="/api")
```

**Step 2: Verify the app starts**

```bash
cd packages/backend
python3 -c "from api.main import app; print('OK')"
```

Expected: `OK`

**Step 3: Commit**

```bash
git add packages/backend/api/main.py
git commit -m "feat: register documents router"
```

---

### Task 2.3: Add Storage Service Support for Documents

**Files:**
- Modify: `packages/backend/services/storage.py`

**Step 1: Verify storage service has needed methods**

Check if `save_file`, `delete_file`, and `get_full_path` methods exist. If not, add them.

The storage service should support saving to subdirectories like `documents/{uuid}/filename`.

**Step 2: Commit if changes needed**

```bash
git add packages/backend/services/storage.py
git commit -m "feat: add document storage support" --allow-empty
```

---

## Phase 3: Notes API

### Task 3.1: Create Notes Router

**Files:**
- Create: `packages/backend/api/routes/notes.py`

**Step 1: Create the notes router file**

```python
"""Notes management endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from persistence.database import get_db
from persistence.models import Document, Note, Recording

router = APIRouter(prefix="/notes", tags=["notes"])


class NoteCreate(BaseModel):
    """Request model for creating a note."""

    content: str
    recording_id: str | None = None
    document_id: str | None = None
    anchor_type: str  # timestamp, page, paragraph, selection
    anchor_data: dict  # {time: 45.2} or {page: 3}


class NoteUpdate(BaseModel):
    """Request model for updating a note."""

    content: str | None = None
    anchor_type: str | None = None
    anchor_data: dict | None = None


class NoteResponse(BaseModel):
    """Response model for a note."""

    id: str
    content: str
    recording_id: str | None
    document_id: str | None
    anchor_type: str
    anchor_data: dict
    created_at: str
    updated_at: str


class NoteListResponse(BaseModel):
    """Response model for listing notes."""

    items: list[NoteResponse]
    total: int


class MessageResponse(BaseModel):
    """Generic message response."""

    message: str
    id: str | None = None


def _note_to_response(note: Note) -> NoteResponse:
    """Convert Note model to response."""
    return NoteResponse(
        id=note.id,
        content=note.content,
        recording_id=note.recording_id,
        document_id=note.document_id,
        anchor_type=note.anchor_type,
        anchor_data=note.anchor_data,
        created_at=note.created_at.isoformat(),
        updated_at=note.updated_at.isoformat(),
    )


@router.post("", response_model=NoteResponse, status_code=status.HTTP_201_CREATED)
async def create_note(
    db: Annotated[AsyncSession, Depends(get_db)],
    note_in: NoteCreate,
) -> NoteResponse:
    """Create a new note attached to a recording or document."""
    # Validate exactly one parent is set
    if not note_in.recording_id and not note_in.document_id:
        raise HTTPException(status_code=400, detail="Must specify either recording_id or document_id")
    if note_in.recording_id and note_in.document_id:
        raise HTTPException(status_code=400, detail="Cannot specify both recording_id and document_id")

    # Validate parent exists
    if note_in.recording_id:
        recording = await db.get(Recording, note_in.recording_id)
        if not recording:
            raise HTTPException(status_code=404, detail="Recording not found")
    if note_in.document_id:
        document = await db.get(Document, note_in.document_id)
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")

    # Validate anchor_type
    valid_anchor_types = {"timestamp", "page", "paragraph", "selection"}
    if note_in.anchor_type not in valid_anchor_types:
        raise HTTPException(status_code=400, detail=f"Invalid anchor_type. Must be one of: {valid_anchor_types}")

    note = Note(
        content=note_in.content,
        recording_id=note_in.recording_id,
        document_id=note_in.document_id,
        anchor_type=note_in.anchor_type,
        anchor_data=note_in.anchor_data,
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)

    return _note_to_response(note)


@router.get("", response_model=NoteListResponse)
async def list_notes(
    db: Annotated[AsyncSession, Depends(get_db)],
    recording_id: Annotated[str | None, Query(description="Filter by recording")] = None,
    document_id: Annotated[str | None, Query(description="Filter by document")] = None,
) -> NoteListResponse:
    """List notes for a recording or document."""
    if not recording_id and not document_id:
        raise HTTPException(status_code=400, detail="Must specify either recording_id or document_id")

    query = select(Note).order_by(Note.created_at.asc())

    if recording_id:
        query = query.where(Note.recording_id == recording_id)
    if document_id:
        query = query.where(Note.document_id == document_id)

    result = await db.execute(query)
    notes = result.scalars().all()

    return NoteListResponse(
        items=[_note_to_response(note) for note in notes],
        total=len(notes),
    )


@router.get("/{note_id}", response_model=NoteResponse)
async def get_note(
    db: Annotated[AsyncSession, Depends(get_db)],
    note_id: str,
) -> NoteResponse:
    """Get a single note by ID."""
    note = await db.get(Note, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return _note_to_response(note)


@router.patch("/{note_id}", response_model=NoteResponse)
async def update_note(
    db: Annotated[AsyncSession, Depends(get_db)],
    note_id: str,
    update: NoteUpdate,
) -> NoteResponse:
    """Update a note's content or anchor."""
    note = await db.get(Note, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    if update.content is not None:
        note.content = update.content
    if update.anchor_type is not None:
        valid_anchor_types = {"timestamp", "page", "paragraph", "selection"}
        if update.anchor_type not in valid_anchor_types:
            raise HTTPException(status_code=400, detail=f"Invalid anchor_type")
        note.anchor_type = update.anchor_type
    if update.anchor_data is not None:
        note.anchor_data = update.anchor_data

    await db.commit()
    await db.refresh(note)
    return _note_to_response(note)


@router.delete("/{note_id}", response_model=MessageResponse)
async def delete_note(
    db: Annotated[AsyncSession, Depends(get_db)],
    note_id: str,
) -> MessageResponse:
    """Delete a note."""
    note = await db.get(Note, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    await db.delete(note)
    await db.commit()

    return MessageResponse(message="Note deleted", id=note_id)
```

**Step 2: Register notes router in main.py**

Add import:
```python
from api.routes.notes import router as notes_router
```

Add registration:
```python
app.include_router(notes_router, prefix="/api")
```

**Step 3: Commit**

```bash
git add packages/backend/api/routes/notes.py packages/backend/api/main.py
git commit -m "feat: add notes CRUD API endpoints"
```

---

## Phase 4: Document Processing Service

### Task 4.1: Create Document Processor Service

**Files:**
- Create: `packages/backend/services/document_processor.py`

**Step 1: Create the document processor service**

```python
"""Document processing service for text extraction."""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class DocumentProcessor:
    """Extracts text from various document formats."""

    def process(self, file_path: Path, mime_type: str) -> dict:
        """
        Process a document and extract text content.

        Returns:
            dict with keys: text, markdown, page_count, metadata
        """
        if mime_type == "application/pdf":
            return self._process_pdf(file_path)
        elif mime_type.startswith("image/"):
            return self._process_image(file_path)
        elif mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            return self._process_docx(file_path)
        elif mime_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
            return self._process_xlsx(file_path)
        elif mime_type == "application/vnd.openxmlformats-officedocument.presentationml.presentation":
            return self._process_pptx(file_path)
        elif mime_type in ("text/plain", "text/markdown"):
            return self._process_text(file_path)
        else:
            raise ValueError(f"Unsupported MIME type: {mime_type}")

    def _process_pdf(self, file_path: Path) -> dict:
        """Process PDF using Chandra OCR."""
        try:
            from chandra_ocr import ocr
            result = ocr(str(file_path), output_format="markdown")
            return {
                "text": result.plain_text if hasattr(result, 'plain_text') else str(result),
                "markdown": result.markdown if hasattr(result, 'markdown') else str(result),
                "page_count": result.page_count if hasattr(result, 'page_count') else None,
                "metadata": {"ocr_engine": "chandra"},
            }
        except ImportError:
            logger.warning("chandra-ocr not installed, falling back to basic PDF extraction")
            return self._process_pdf_fallback(file_path)
        except Exception as e:
            logger.error(f"Chandra OCR failed: {e}")
            return self._process_pdf_fallback(file_path)

    def _process_pdf_fallback(self, file_path: Path) -> dict:
        """Fallback PDF processing using PyMuPDF or pdfplumber."""
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(file_path)
            text_parts = []
            for page in doc:
                text_parts.append(page.get_text())
            text = "\n\n".join(text_parts)
            return {
                "text": text,
                "markdown": text,
                "page_count": len(doc),
                "metadata": {"ocr_engine": "pymupdf"},
            }
        except ImportError:
            logger.warning("PyMuPDF not installed")
            return {"text": "", "markdown": "", "page_count": None, "metadata": {}}

    def _process_image(self, file_path: Path) -> dict:
        """Process image using Chandra OCR."""
        try:
            from chandra_ocr import ocr
            result = ocr(str(file_path), output_format="markdown")
            return {
                "text": result.plain_text if hasattr(result, 'plain_text') else str(result),
                "markdown": result.markdown if hasattr(result, 'markdown') else str(result),
                "page_count": 1,
                "metadata": {"ocr_engine": "chandra"},
            }
        except ImportError:
            logger.warning("chandra-ocr not installed for image processing")
            return {"text": "", "markdown": "", "page_count": 1, "metadata": {}}
        except Exception as e:
            logger.error(f"Image OCR failed: {e}")
            return {"text": "", "markdown": "", "page_count": 1, "metadata": {}}

    def _process_docx(self, file_path: Path) -> dict:
        """Process DOCX using python-docx."""
        try:
            from docx import Document as DocxDocument
            doc = DocxDocument(file_path)
            paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
            text = "\n\n".join(paragraphs)
            return {
                "text": text,
                "markdown": text,
                "page_count": None,
                "metadata": {"format": "docx"},
            }
        except ImportError:
            logger.warning("python-docx not installed")
            return {"text": "", "markdown": "", "page_count": None, "metadata": {}}
        except Exception as e:
            logger.error(f"DOCX processing failed: {e}")
            return {"text": "", "markdown": "", "page_count": None, "metadata": {}}

    def _process_xlsx(self, file_path: Path) -> dict:
        """Process XLSX using openpyxl."""
        try:
            from openpyxl import load_workbook
            wb = load_workbook(file_path, read_only=True, data_only=True)
            markdown_parts = []
            text_parts = []

            for sheet_name in wb.sheetnames:
                sheet = wb[sheet_name]
                markdown_parts.append(f"## {sheet_name}\n")
                rows = list(sheet.iter_rows(values_only=True))
                if rows:
                    # Create markdown table
                    header = rows[0]
                    markdown_parts.append("| " + " | ".join(str(c or "") for c in header) + " |")
                    markdown_parts.append("| " + " | ".join("---" for _ in header) + " |")
                    for row in rows[1:]:
                        markdown_parts.append("| " + " | ".join(str(c or "") for c in row) + " |")
                        text_parts.append("\t".join(str(c or "") for c in row))
                markdown_parts.append("")

            return {
                "text": "\n".join(text_parts),
                "markdown": "\n".join(markdown_parts),
                "page_count": len(wb.sheetnames),
                "metadata": {"format": "xlsx", "sheets": wb.sheetnames},
            }
        except ImportError:
            logger.warning("openpyxl not installed")
            return {"text": "", "markdown": "", "page_count": None, "metadata": {}}
        except Exception as e:
            logger.error(f"XLSX processing failed: {e}")
            return {"text": "", "markdown": "", "page_count": None, "metadata": {}}

    def _process_pptx(self, file_path: Path) -> dict:
        """Process PPTX using python-pptx."""
        try:
            from pptx import Presentation
            prs = Presentation(file_path)
            markdown_parts = []
            text_parts = []

            for i, slide in enumerate(prs.slides, 1):
                markdown_parts.append(f"## Slide {i}\n")
                for shape in slide.shapes:
                    if hasattr(shape, "text") and shape.text.strip():
                        markdown_parts.append(shape.text)
                        text_parts.append(shape.text)
                markdown_parts.append("")

            return {
                "text": "\n\n".join(text_parts),
                "markdown": "\n".join(markdown_parts),
                "page_count": len(prs.slides),
                "metadata": {"format": "pptx"},
            }
        except ImportError:
            logger.warning("python-pptx not installed")
            return {"text": "", "markdown": "", "page_count": None, "metadata": {}}
        except Exception as e:
            logger.error(f"PPTX processing failed: {e}")
            return {"text": "", "markdown": "", "page_count": None, "metadata": {}}

    def _process_text(self, file_path: Path) -> dict:
        """Process plain text or markdown files."""
        try:
            text = file_path.read_text(encoding="utf-8")
            return {
                "text": text,
                "markdown": text,
                "page_count": 1,
                "metadata": {"format": "text"},
            }
        except Exception as e:
            logger.error(f"Text processing failed: {e}")
            return {"text": "", "markdown": "", "page_count": 1, "metadata": {}}


document_processor = DocumentProcessor()
```

**Step 2: Commit**

```bash
git add packages/backend/services/document_processor.py
git commit -m "feat: add document processor service for text extraction"
```

---

### Task 4.2: Create Document Processing Job

**Files:**
- Create: `packages/backend/jobs/process_document.py`

**Step 1: Create the processing job**

```python
"""Background job for processing documents."""

import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from persistence.models import Document, DocumentEmbedding
from services.document_processor import document_processor
from services.storage import storage_service

logger = logging.getLogger(__name__)


def process_document_job(db: Session, document_id: str) -> None:
    """
    Process a document: extract text, generate embeddings.

    Called by the job queue worker.
    """
    # Get document
    doc = db.get(Document, document_id)
    if not doc:
        logger.error(f"Document {document_id} not found")
        return

    # Update status to processing
    doc.status = "processing"
    db.commit()

    try:
        # Get file path
        file_path = storage_service.get_full_path(doc.file_path)
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        # Extract text
        result = document_processor.process(file_path, doc.mime_type)

        # Update document with extracted content
        doc.extracted_text = result.get("text")
        doc.extracted_markdown = result.get("markdown")
        doc.page_count = result.get("page_count")
        doc.metadata_.update(result.get("metadata", {}))

        # Generate embeddings if text was extracted
        if doc.extracted_text and len(doc.extracted_text.strip()) > 0:
            _generate_embeddings(db, doc)

        doc.status = "completed"
        doc.error_message = None
        db.commit()
        logger.info(f"Document {document_id} processed successfully")

    except Exception as e:
        logger.exception(f"Failed to process document {document_id}")
        doc.status = "failed"
        doc.error_message = str(e)
        db.commit()


def _generate_embeddings(db: Session, doc: Document) -> None:
    """Generate and store embeddings for document chunks."""
    from services.embedding import embedding_service

    if not embedding_service.is_available():
        logger.warning("Embedding service not available, skipping embeddings")
        return

    # Delete existing embeddings for this document
    db.execute(
        select(DocumentEmbedding).where(DocumentEmbedding.document_id == doc.id)
    )
    existing = db.scalars(
        select(DocumentEmbedding).where(DocumentEmbedding.document_id == doc.id)
    ).all()
    for emb in existing:
        db.delete(emb)

    # Chunk the text
    chunks = _chunk_text(doc.extracted_text, max_tokens=500)

    # Generate embeddings for each chunk
    for i, chunk in enumerate(chunks):
        try:
            embedding_vector = embedding_service.embed(chunk["text"])

            doc_embedding = DocumentEmbedding(
                document_id=doc.id,
                chunk_index=i,
                chunk_text=chunk["text"],
                chunk_metadata=chunk.get("metadata", {}),
                embedding=embedding_vector,
                model_used=embedding_service.model_name,
            )
            db.add(doc_embedding)
        except Exception as e:
            logger.warning(f"Failed to embed chunk {i}: {e}")

    db.commit()
    logger.info(f"Generated {len(chunks)} embeddings for document {doc.id}")


def _chunk_text(text: str, max_tokens: int = 500) -> list[dict]:
    """Split text into chunks of approximately max_tokens."""
    # Simple sentence-based chunking
    import re

    sentences = re.split(r'(?<=[.!?])\s+', text)
    chunks = []
    current_chunk = []
    current_length = 0

    for sentence in sentences:
        # Rough token estimate: 1 token ≈ 4 characters
        sentence_tokens = len(sentence) // 4

        if current_length + sentence_tokens > max_tokens and current_chunk:
            chunks.append({
                "text": " ".join(current_chunk),
                "metadata": {"chunk_index": len(chunks)},
            })
            current_chunk = []
            current_length = 0

        current_chunk.append(sentence)
        current_length += sentence_tokens

    if current_chunk:
        chunks.append({
            "text": " ".join(current_chunk),
            "metadata": {"chunk_index": len(chunks)},
        })

    return chunks
```

**Step 2: Commit**

```bash
git add packages/backend/jobs/process_document.py
git commit -m "feat: add document processing background job"
```

---

### Task 4.3: Integrate Processing Job with Upload

**Files:**
- Modify: `packages/backend/api/routes/documents.py`

**Step 1: Add job queuing after document creation**

In the `upload_document` function, after `await db.refresh(doc)`, add:

```python
    # Queue processing job
    from services.jobs import job_queue
    job_queue.enqueue("process_document", {"document_id": doc.id})
```

**Step 2: Add reprocess endpoint**

Add before the last endpoint:

```python
@router.post("/{document_id}/process", response_model=MessageResponse)
async def reprocess_document(
    db: Annotated[AsyncSession, Depends(get_db)],
    document_id: str,
) -> MessageResponse:
    """Re-trigger document processing."""
    doc = await db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Reset status and queue job
    doc.status = "pending"
    doc.error_message = None
    await db.commit()

    from services.jobs import job_queue
    job_queue.enqueue("process_document", {"document_id": document_id})

    return MessageResponse(message="Processing queued", id=document_id)
```

**Step 3: Commit**

```bash
git add packages/backend/api/routes/documents.py
git commit -m "feat: integrate document processing job with upload"
```

---

## Phase 5: Frontend - API Client

### Task 5.1: Add Document Types to API Client

**Files:**
- Modify: `packages/frontend/src/lib/api.ts`

**Step 1: Add Document and Note interfaces**

Add after the existing interfaces:

```typescript
export interface Document {
  id: string;
  title: string;
  filename: string;
  file_path: string;
  mime_type: string;
  file_size_bytes: number;
  project_id: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error_message: string | null;
  page_count: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DocumentListResponse {
  items: Document[];
  total: number;
}

export interface Note {
  id: string;
  content: string;
  recording_id: string | null;
  document_id: string | null;
  anchor_type: 'timestamp' | 'page' | 'paragraph' | 'selection';
  anchor_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface NoteListResponse {
  items: Note[];
  total: number;
}
```

**Step 2: Add documents API methods**

Add to the `api` object:

```typescript
  documents: {
    list: async (params?: { project_id?: string; status?: string; search?: string }): Promise<DocumentListResponse> => {
      const searchParams = new URLSearchParams();
      if (params?.project_id) searchParams.set('project_id', params.project_id);
      if (params?.status) searchParams.set('status', params.status);
      if (params?.search) searchParams.set('search', params.search);
      const query = searchParams.toString();
      const res = await fetch(`${API_BASE_URL}/api/documents${query ? `?${query}` : ''}`);
      if (!res.ok) throw new Error('Failed to fetch documents');
      return res.json();
    },

    get: async (id: string): Promise<Document> => {
      const res = await fetch(`${API_BASE_URL}/api/documents/${id}`);
      if (!res.ok) throw new Error('Failed to fetch document');
      return res.json();
    },

    upload: async (file: File, title?: string, projectId?: string): Promise<Document> => {
      const formData = new FormData();
      formData.append('file', file);
      if (title) formData.append('title', title);
      if (projectId) formData.append('project_id', projectId);

      const res = await fetch(`${API_BASE_URL}/api/documents`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Failed to upload document');
      return res.json();
    },

    update: async (id: string, data: { title?: string; project_id?: string | null }): Promise<Document> => {
      const res = await fetch(`${API_BASE_URL}/api/documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update document');
      return res.json();
    },

    delete: async (id: string): Promise<void> => {
      const res = await fetch(`${API_BASE_URL}/api/documents/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete document');
    },

    getContent: async (id: string, format: 'text' | 'markdown' = 'markdown'): Promise<{ content: string; format: string }> => {
      const res = await fetch(`${API_BASE_URL}/api/documents/${id}/content?format=${format}`);
      if (!res.ok) throw new Error('Failed to fetch document content');
      return res.json();
    },

    getFileUrl: (id: string): string => `${API_BASE_URL}/api/documents/${id}/file`,

    reprocess: async (id: string): Promise<void> => {
      const res = await fetch(`${API_BASE_URL}/api/documents/${id}/process`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to reprocess document');
    },
  },
```

**Step 3: Add notes API methods**

```typescript
  notes: {
    list: async (params: { recording_id?: string; document_id?: string }): Promise<NoteListResponse> => {
      const searchParams = new URLSearchParams();
      if (params.recording_id) searchParams.set('recording_id', params.recording_id);
      if (params.document_id) searchParams.set('document_id', params.document_id);
      const res = await fetch(`${API_BASE_URL}/api/notes?${searchParams.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch notes');
      return res.json();
    },

    create: async (data: {
      content: string;
      recording_id?: string;
      document_id?: string;
      anchor_type: string;
      anchor_data: Record<string, unknown>;
    }): Promise<Note> => {
      const res = await fetch(`${API_BASE_URL}/api/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create note');
      return res.json();
    },

    update: async (id: string, data: { content?: string; anchor_type?: string; anchor_data?: Record<string, unknown> }): Promise<Note> => {
      const res = await fetch(`${API_BASE_URL}/api/notes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update note');
      return res.json();
    },

    delete: async (id: string): Promise<void> => {
      const res = await fetch(`${API_BASE_URL}/api/notes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete note');
    },
  },
```

**Step 4: Commit**

```bash
git add packages/frontend/src/lib/api.ts
git commit -m "feat: add documents and notes API client methods"
```

---

## Phase 6: Frontend - Documents Page

### Task 6.1: Create DocumentCard Component

**Files:**
- Create: `packages/frontend/src/components/documents/DocumentCard.tsx`

**Step 1: Create the component**

```tsx
import type { Document } from '@/lib/api';

interface DocumentCardProps {
  document: Document;
  onClick: () => void;
  onDelete?: () => void;
}

const MIME_ICONS: Record<string, string> = {
  'application/pdf': '📄',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '📊',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '📽️',
  'image/png': '🖼️',
  'image/jpeg': '🖼️',
  'image/tiff': '🖼️',
  'text/plain': '📃',
  'text/markdown': '📃',
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  if (diffMins < 10080) return `${Math.floor(diffMins / 1440)}d ago`;
  return date.toLocaleDateString();
}

export function DocumentCard({ document, onClick, onDelete }: DocumentCardProps) {
  const icon = MIME_ICONS[document.mime_type] || '📄';
  const statusStyle = STATUS_STYLES[document.status] || STATUS_STYLES.pending;

  return (
    <div
      onClick={onClick}
      className="group relative p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md transition-all cursor-pointer"
    >
      <div className="flex items-start gap-3">
        <div className="text-3xl">{icon}</div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
            {document.title}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
            {document.filename}
          </p>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className={`px-2 py-0.5 rounded-full ${statusStyle}`}>
              {document.status}
            </span>
            <span className="text-gray-400 dark:text-gray-500">
              {formatBytes(document.file_size_bytes)}
            </span>
            {document.page_count && (
              <span className="text-gray-400 dark:text-gray-500">
                {document.page_count} pages
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {formatDate(document.created_at)}
          </p>
        </div>
      </div>

      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-2 right-2 p-1.5 rounded-md opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
          title="Delete document"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/documents/DocumentCard.tsx
git commit -m "feat: add DocumentCard component"
```

---

### Task 6.2: Create Upload Dialog Component

**Files:**
- Create: `packages/frontend/src/components/documents/UploadDocumentDialog.tsx`

**Step 1: Create the component**

```tsx
import { useState, useCallback, useRef } from 'react';
import { api, type Project } from '@/lib/api';

interface UploadDocumentDialogProps {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
  projects?: Project[];
  defaultProjectId?: string;
}

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
  'image/tiff',
  'text/plain',
  'text/markdown',
].join(',');

export function UploadDocumentDialog({
  open,
  onClose,
  onUploaded,
  projects = [],
  defaultProjectId,
}: UploadDocumentDialogProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [projectId, setProjectId] = useState(defaultProjectId || '');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...droppedFiles]);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      setFiles((prev) => [...prev, ...selectedFiles]);
    }
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpload = async () => {
    if (files.length === 0) return;

    setUploading(true);
    setErrors({});

    for (const file of files) {
      try {
        setProgress((prev) => ({ ...prev, [file.name]: 0 }));
        await api.documents.upload(file, file.name, projectId || undefined);
        setProgress((prev) => ({ ...prev, [file.name]: 100 }));
      } catch (err) {
        setErrors((prev) => ({
          ...prev,
          [file.name]: err instanceof Error ? err.message : 'Upload failed',
        }));
      }
    }

    setUploading(false);
    onUploaded();
    onClose();
    setFiles([]);
    setProgress({});
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full mx-4 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Upload Documents
        </h2>

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
        >
          <svg className="w-10 h-10 mx-auto text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
          </svg>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Drag and drop files here, or click to browse
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            PDF, DOCX, XLSX, PPTX, PNG, JPG, TXT, MD
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="mt-4 space-y-2 max-h-40 overflow-y-auto">
            {files.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-700/50"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 dark:text-gray-100 truncate">
                    {file.name}
                  </p>
                  {progress[file.name] !== undefined && (
                    <div className="mt-1 h-1 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all"
                        style={{ width: `${progress[file.name]}%` }}
                      />
                    </div>
                  )}
                  {errors[file.name] && (
                    <p className="text-xs text-red-500 mt-1">{errors[file.name]}</p>
                  )}
                </div>
                {!uploading && (
                  <button
                    onClick={() => removeFile(index)}
                    className="ml-2 p-1 text-gray-400 hover:text-red-500"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Project selector */}
        {projects.length > 0 && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Add to Project (optional)
            </label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm"
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={uploading}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={files.length === 0 || uploading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {uploading ? 'Uploading...' : `Upload ${files.length} file${files.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/documents/UploadDocumentDialog.tsx
git commit -m "feat: add UploadDocumentDialog component"
```

---

### Task 6.3: Create Documents Page

**Files:**
- Create: `packages/frontend/src/pages/documents/DocumentsPage.tsx`

**Step 1: Create the page component**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { api, type Document, type Project } from '@/lib/api';
import { DocumentCard } from '@/components/documents/DocumentCard';
import { UploadDocumentDialog } from '@/components/documents/UploadDocumentDialog';

interface DocumentsPageProps {
  onViewDocument: (documentId: string) => void;
}

export function DocumentsPage({ onViewDocument }: DocumentsPageProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const loadDocuments = useCallback(async () => {
    try {
      const params: { search?: string; status?: string } = {};
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const response = await api.documents.list(params);
      setDocuments(response.items);
    } catch (err) {
      console.error('Failed to load documents:', err);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    loadDocuments();
    api.projects.list().then((r) => setProjects(r.items)).catch(console.error);
  }, [loadDocuments]);

  const handleDelete = async (docId: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return;
    try {
      await api.documents.delete(docId);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch (err) {
      console.error('Failed to delete document:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Documents</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Upload and manage your documents
          </p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Upload Document
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <input
          type="text"
          placeholder="Search documents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Document grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <svg className="w-8 h-8 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-12">
          <svg className="w-12 h-12 mx-auto text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="mt-4 text-sm font-medium text-gray-900 dark:text-gray-100">No documents</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Upload your first document to get started
          </p>
          <button
            onClick={() => setShowUpload(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Upload Document
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map((doc) => (
            <DocumentCard
              key={doc.id}
              document={doc}
              onClick={() => onViewDocument(doc.id)}
              onDelete={() => handleDelete(doc.id)}
            />
          ))}
        </div>
      )}

      {/* Upload dialog */}
      <UploadDocumentDialog
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onUploaded={loadDocuments}
        projects={projects}
      />
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/pages/documents/DocumentsPage.tsx
git commit -m "feat: add DocumentsPage"
```

---

### Task 6.4: Add Documents to App Navigation

**Files:**
- Modify: `packages/frontend/src/app/App.tsx`
- Modify: `packages/frontend/src/components/layout/Sidebar.tsx`

**Step 1: Add documents navigation type in App.tsx**

Add to `NavigationState` type:
```typescript
  | { type: 'documents' }
  | { type: 'document-viewer'; documentId: string }
```

Add to `navigationToPath`:
```typescript
    case 'documents': return '/documents';
    case 'document-viewer': return `/documents/${nav.documentId}`;
```

Add to `pathToNavigation`:
```typescript
  if (cleanPath === '/documents') return { type: 'documents' };

  const documentMatch = cleanPath.match(/^\/documents\/([^/]+)$/);
  if (documentMatch) return { type: 'document-viewer', documentId: documentMatch[1] };
```

Add handler:
```typescript
  const handleNavigateToDocuments = useCallback(() => {
    setNavigation({ type: 'documents' });
  }, []);

  const handleViewDocument = useCallback((documentId: string) => {
    setNavigation({ type: 'document-viewer', documentId });
  }, []);
```

Add to `currentTab`:
```typescript
      case 'document-viewer':
        return 'documents';
```

Add to render section:
```typescript
            {navigation.type === 'documents' && (
              <DocumentsPage onViewDocument={handleViewDocument} />
            )}
```

Add import:
```typescript
import { DocumentsPage } from '@/pages/documents/DocumentsPage';
```

**Step 2: Add documents to Sidebar.tsx NAV_ITEMS**

Add after 'search' item:
```typescript
  {
    key: 'documents' as const,
    label: 'Documents',
    icon: (
      <svg className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
```

Update type definitions to include 'documents'.

**Step 3: Commit**

```bash
git add packages/frontend/src/app/App.tsx packages/frontend/src/components/layout/Sidebar.tsx
git commit -m "feat: add documents navigation to app"
```

---

## Phase 7: Frontend - Document Viewer Page

### Task 7.1: Create Document Viewer Page

**Files:**
- Create: `packages/frontend/src/pages/documents/DocumentViewerPage.tsx`

**Step 1: Create the page component**

```tsx
import { useState, useEffect } from 'react';
import { api, type Document } from '@/lib/api';

interface DocumentViewerPageProps {
  documentId: string;
  onBack: () => void;
}

export function DocumentViewerPage({ documentId, onBack }: DocumentViewerPageProps) {
  const [document, setDocument] = useState<Document | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const doc = await api.documents.get(documentId);
        setDocument(doc);

        if (doc.status === 'completed') {
          const contentRes = await api.documents.getContent(documentId);
          setContent(contentRes.content);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load document');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [documentId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <svg className="w-8 h-8 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500">{error || 'Document not found'}</p>
        <button onClick={onBack} className="mt-4 text-blue-500 hover:underline">
          Go back
        </button>
      </div>
    );
  }

  const isPdf = document.mime_type === 'application/pdf';
  const isImage = document.mime_type.startsWith('image/');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {document.title}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {document.filename} • {document.status}
          </p>
        </div>
        <a
          href={api.documents.getFileUrl(documentId)}
          download={document.filename}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download
        </a>
      </div>

      {/* Content */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        {document.status === 'processing' && (
          <div className="p-8 text-center">
            <svg className="w-8 h-8 animate-spin text-blue-500 mx-auto" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="mt-4 text-gray-500 dark:text-gray-400">Processing document...</p>
          </div>
        )}

        {document.status === 'failed' && (
          <div className="p-8 text-center">
            <p className="text-red-500">Processing failed: {document.error_message}</p>
            <button
              onClick={() => api.documents.reprocess(documentId)}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Retry Processing
            </button>
          </div>
        )}

        {document.status === 'completed' && (
          <>
            {isPdf && (
              <iframe
                src={api.documents.getFileUrl(documentId)}
                className="w-full h-[600px]"
                title={document.title}
              />
            )}

            {isImage && (
              <div className="p-4 flex items-center justify-center">
                <img
                  src={api.documents.getFileUrl(documentId)}
                  alt={document.title}
                  className="max-w-full max-h-[600px] object-contain"
                />
              </div>
            )}

            {!isPdf && !isImage && content && (
              <div className="p-6 prose dark:prose-invert max-w-none">
                <pre className="whitespace-pre-wrap text-sm">{content}</pre>
              </div>
            )}
          </>
        )}

        {document.status === 'pending' && (
          <div className="p-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">Document queued for processing...</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Add to App.tsx render section**

```typescript
            {navigation.type === 'document-viewer' && (
              <DocumentViewerPage
                documentId={navigation.documentId}
                onBack={handleNavigateToDocuments}
              />
            )}
```

Add import:
```typescript
import { DocumentViewerPage } from '@/pages/documents/DocumentViewerPage';
```

**Step 3: Commit**

```bash
git add packages/frontend/src/pages/documents/DocumentViewerPage.tsx packages/frontend/src/app/App.tsx
git commit -m "feat: add DocumentViewerPage"
```

---

## Phase 8: Integration & Testing

### Task 8.1: Add Backend Dependencies

**Files:**
- Modify: `packages/backend/pyproject.toml`

**Step 1: Add new dependencies**

```toml
# Under [project.dependencies], add:
python-docx = "^1.1.0"
openpyxl = "^3.1.0"
python-pptx = "^0.6.23"
PyMuPDF = "^1.24.0"
# chandra-ocr - install separately due to large model requirements
```

**Step 2: Install dependencies**

```bash
cd packages/backend
pip install python-docx openpyxl python-pptx PyMuPDF
```

**Step 3: Commit**

```bash
git add packages/backend/pyproject.toml
git commit -m "chore: add document processing dependencies"
```

---

### Task 8.2: Build and Verify

**Step 1: Build frontend**

```bash
cd packages/frontend
npm run build
```

**Step 2: Start backend and test**

```bash
cd packages/backend
# Start the server and test document upload via API or frontend
```

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete document management feature (Phase 1-8)"
```

---

## Summary

This plan implements Document Management in 8 phases:

1. **Database Models** - Document, Note, DocumentEmbedding models
2. **Document CRUD API** - Upload, list, get, update, delete endpoints
3. **Notes API** - Create, list, update, delete notes with anchors
4. **Document Processing** - Text extraction service + background job
5. **Frontend API Client** - TypeScript types and API methods
6. **Documents Page** - List view with upload dialog
7. **Document Viewer** - View document content and metadata
8. **Integration** - Dependencies and final verification

Each task has specific files to modify, exact code to write, and commit checkpoints.
