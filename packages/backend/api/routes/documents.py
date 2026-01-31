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

from persistence import get_db
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

    # Validate file size
    MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024  # 10 GB
    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024 * 1024)} GB"
        )
    if file_size == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    # Generate storage path
    from persistence.models import generate_uuid
    doc_id = generate_uuid()

    # Sanitize filename for security
    safe_filename = Path(file.filename.replace("\\", "/")).name
    if not safe_filename or safe_filename in (".", ".."):
        safe_filename = "unknown"

    file_path = f"documents/{doc_id}/{safe_filename}"

    # Save to storage
    storage_service.save_file(file_path, content)

    # Create document record
    doc = Document(
        id=doc_id,
        title=title or safe_filename,
        filename=safe_filename,
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
        await storage_service.delete_file(doc.file_path)
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
