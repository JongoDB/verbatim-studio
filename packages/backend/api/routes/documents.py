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

    # Validate project exists if provided and get name for path
    project_name = None
    if project_id:
        project = await db.get(Project, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        project_name = project.name

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

    # Sanitize filename for security
    safe_filename = Path(file.filename.replace("\\", "/")).name
    if not safe_filename or safe_filename in (".", ".."):
        safe_filename = "unknown"

    # Generate document ID
    from persistence.models import generate_uuid
    doc_id = generate_uuid()

    # Determine title
    doc_title = title or safe_filename.rsplit(".", 1)[0]

    # Save to storage with human-readable path
    file_path = await storage_service.save_upload(
        content=content,
        title=doc_title,
        filename=safe_filename,
        project_name=project_name,
    )

    # Create document record
    doc = Document(
        id=doc_id,
        title=doc_title,
        filename=file_path.name,  # Actual filename (may have collision suffix)
        file_path=str(file_path),  # Full path
        mime_type=mime_type,
        file_size_bytes=file_size,
        project_id=project_id,
        status="pending",
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    # Queue processing job
    from services.jobs import job_queue
    await job_queue.enqueue("process_document", {"document_id": doc.id})

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

    # Handle title change - rename file on disk
    if update.title is not None and update.title != doc.title:
        try:
            old_path = Path(doc.file_path)
            if old_path.exists():
                new_path = await storage_service.rename_item(old_path, update.title)
                doc.file_path = str(new_path)
                doc.filename = new_path.name
        except Exception as e:
            logger.warning(f"Could not rename file for document {document_id}: {e}")
        doc.title = update.title

    # Handle project change - move file to new project folder
    if update.project_id is not None and update.project_id != doc.project_id:
        new_project_name = None
        if update.project_id:
            project = await db.get(Project, update.project_id)
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")
            new_project_name = project.name

        try:
            old_path = Path(doc.file_path)
            if old_path.exists():
                new_path = await storage_service.move_to_project(old_path, new_project_name)
                doc.file_path = str(new_path)
        except Exception as e:
            logger.warning(f"Could not move file for document {document_id}: {e}")

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


class DocumentPropertiesResponse(BaseModel):
    """Response model for document file properties."""

    id: str
    title: str
    file_path: str
    filename: str
    file_size: int | None
    file_size_formatted: str
    file_exists: bool
    mime_type: str | None
    page_count: int | None
    status: str
    created_at: str
    updated_at: str
    storage_location: str | None = None


def _format_file_size(size: int | None) -> str:
    """Format file size in human-readable format."""
    if size is None:
        return "Unknown"
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


@router.get("/{document_id}/properties", response_model=DocumentPropertiesResponse)
async def get_document_properties(
    db: Annotated[AsyncSession, Depends(get_db)],
    document_id: str,
) -> DocumentPropertiesResponse:
    """Get detailed file properties for a document.

    Returns information useful for a Properties dialog including
    file path, size, whether file exists, etc.
    """
    from persistence.models import StorageLocation

    doc = await db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = Path(doc.file_path) if doc.file_path else None
    file_exists = file_path.exists() if file_path else False

    # Get actual file size from disk if possible
    actual_size = doc.file_size_bytes
    if file_exists and file_path:
        try:
            actual_size = file_path.stat().st_size
        except OSError:
            pass

    # Try to get storage location name
    storage_location_name = None
    loc_result = await db.execute(
        select(StorageLocation).where(StorageLocation.is_active == True)
    )
    storage_loc = loc_result.scalar_one_or_none()
    if storage_loc:
        storage_location_name = storage_loc.name

    return DocumentPropertiesResponse(
        id=doc.id,
        title=doc.title,
        file_path=doc.file_path or "",
        filename=doc.filename or "",
        file_size=actual_size,
        file_size_formatted=_format_file_size(actual_size),
        file_exists=file_exists,
        mime_type=doc.mime_type,
        page_count=doc.metadata_.get("page_count") if doc.metadata_ else None,
        status=doc.status,
        created_at=doc.created_at.isoformat() if doc.created_at else "",
        updated_at=doc.updated_at.isoformat() if doc.updated_at else "",
        storage_location=storage_location_name,
    )


@router.get("/{document_id}/file")
async def download_document_file(
    db: Annotated[AsyncSession, Depends(get_db)],
    document_id: str,
    inline: Annotated[bool, Query(description="Display inline instead of download")] = False,
) -> FileResponse:
    """Download or view the original document file.

    Use inline=true to display in browser (for iframe embedding).
    For Office documents (DOCX, XLSX, PPTX), returns the PDF preview when inline=true.
    """
    doc = await db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # For inline viewing of Office documents, use the PDF preview if available
    if inline and doc.metadata_.get("preview_path"):
        preview_path = Path(doc.metadata_["preview_path"])
        if not preview_path.is_absolute():
            preview_path = storage_service.get_full_path(doc.metadata_["preview_path"])
        if preview_path.exists():
            return FileResponse(
                path=preview_path,
                filename=doc.filename.rsplit(".", 1)[0] + ".pdf",
                media_type="application/pdf",
                content_disposition_type="inline",
            )

    # File path is now stored as full path
    file_path = Path(doc.file_path)
    if not file_path.is_absolute():
        # Backwards compatibility for old relative paths
        file_path = storage_service.get_full_path(doc.file_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    # For inline viewing (iframe), use content-disposition: inline
    content_disposition = "inline" if inline else "attachment"

    return FileResponse(
        path=file_path,
        filename=doc.filename,
        media_type=doc.mime_type,
        content_disposition_type=content_disposition,
    )


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
    await job_queue.enqueue("process_document", {"document_id": document_id})

    return MessageResponse(message="Processing queued", id=document_id)


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
