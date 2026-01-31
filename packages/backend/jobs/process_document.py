"""Background job for processing documents."""

import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from persistence.models import Document, DocumentEmbedding
from services.document_processor import document_processor, OFFICE_MIME_TYPES
from services.storage import storage_service

logger = logging.getLogger(__name__)

# Relative path for preview PDFs within document storage
PREVIEW_SUBDIR = "previews"


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

        # Convert Office documents to PDF for preview
        if doc.mime_type in OFFICE_MIME_TYPES:
            _convert_to_pdf_preview(db, doc, file_path)

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


def _convert_to_pdf_preview(db: Session, doc: Document, source_path: Path) -> None:
    """Convert Office document to PDF for preview."""
    try:
        # Output directory is same as document, in a 'previews' subfolder
        doc_dir = source_path.parent
        preview_dir = doc_dir / PREVIEW_SUBDIR

        # Convert to PDF
        pdf_path = document_processor.convert_to_pdf(source_path, preview_dir)

        if pdf_path and pdf_path.exists():
            # Store relative path from document directory
            relative_preview_path = f"{doc.file_path.rsplit('/', 1)[0]}/{PREVIEW_SUBDIR}/{pdf_path.name}"
            doc.metadata_["preview_path"] = relative_preview_path
            # Flag as modified so SQLAlchemy detects the change
            flag_modified(doc, "metadata_")
            logger.info(f"Created PDF preview: {relative_preview_path}")
        else:
            logger.warning(f"PDF preview conversion failed for {doc.id}")
    except Exception as e:
        logger.error(f"Failed to create PDF preview for {doc.id}: {e}")


def _generate_embeddings(db: Session, doc: Document) -> None:
    """Generate and store embeddings for document chunks."""
    from services.embedding import embedding_service

    if not embedding_service.is_available():
        logger.warning("Embedding service not available, skipping embeddings")
        return

    # Delete existing embeddings for this document
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
