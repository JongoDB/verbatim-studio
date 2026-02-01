"""Background job for processing documents."""

import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

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
        # Get file path - check if already absolute (new storage format)
        file_path = Path(doc.file_path)
        if not file_path.is_absolute():
            # Backwards compatibility for old relative paths
            file_path = storage_service.get_full_path(doc.file_path)
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        # Check if OCR is enabled for this document
        enable_ocr = doc.metadata_.get("enable_ocr", False)

        # Extract text
        result = document_processor.process(file_path, doc.mime_type, enable_ocr=enable_ocr)

        # Update document with extracted content
        doc.extracted_text = result.get("text")
        doc.extracted_markdown = result.get("markdown")
        doc.page_count = result.get("page_count")
        if result.get("metadata"):
            doc.metadata_.update(result.get("metadata", {}))
            flag_modified(doc, "metadata_")

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
    import asyncio

    from services.embedding import embedding_service, embedding_to_bytes

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

    if not chunks:
        logger.info(f"No chunks generated for document {doc.id}")
        return

    # Batch embed all chunks at once
    chunk_texts = [chunk["text"] for chunk in chunks]
    try:
        embeddings = asyncio.run(embedding_service.embed_texts(chunk_texts))
    except Exception as e:
        logger.error(f"Failed to generate embeddings: {e}")
        return

    # Store each embedding
    for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
        doc_embedding = DocumentEmbedding(
            document_id=doc.id,
            chunk_index=i,
            chunk_text=chunk["text"],
            chunk_metadata=chunk.get("metadata", {}),
            embedding=embedding_to_bytes(embedding),
            model_used=embedding_service.model_name,
        )
        db.add(doc_embedding)

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
