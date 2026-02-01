"""Search API endpoints."""

import logging
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from persistence import get_db
from persistence.models import Document, DocumentEmbedding, Note, Recording, Segment, SegmentEmbedding, Transcript
from services.embedding import bytes_to_embedding, embedding_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/search", tags=["search"])


class SearchResultSegment(BaseModel):
    """A segment matching the search query."""

    id: str
    segment_index: int
    speaker: str | None
    start_time: float
    end_time: float
    text: str
    confidence: float | None
    # Parent info
    transcript_id: str
    recording_id: str
    recording_title: str

    class Config:
        from_attributes = True


class SearchResponse(BaseModel):
    """Search results response."""

    query: str
    results: list[SearchResultSegment]
    total: int
    page: int
    page_size: int
    total_pages: int


@router.get("/segments", response_model=SearchResponse)
async def search_segments(
    db: Annotated[AsyncSession, Depends(get_db)],
    q: Annotated[str, Query(min_length=1, description="Search query")],
    transcript_id: Annotated[str | None, Query(description="Limit to specific transcript")] = None,
    recording_id: Annotated[str | None, Query(description="Limit to specific recording")] = None,
    page: Annotated[int, Query(ge=1, description="Page number")] = 1,
    page_size: Annotated[int, Query(ge=1, le=100, description="Results per page")] = 20,
) -> SearchResponse:
    """Search across all transcript segments.

    Full-text search across segment text content. Returns matching segments
    with their parent transcript and recording information.

    Args:
        db: Database session.
        q: Search query string.
        transcript_id: Optional filter to specific transcript.
        recording_id: Optional filter to specific recording.
        page: Page number (1-indexed).
        page_size: Number of results per page.

    Returns:
        Search results with pagination info.
    """
    # Build base query joining segments with transcripts and recordings
    base_query = (
        select(
            Segment,
            Transcript.recording_id,
            Recording.title.label("recording_title"),
        )
        .join(Transcript, Segment.transcript_id == Transcript.id)
        .join(Recording, Transcript.recording_id == Recording.id)
    )

    # Add search filter (case-insensitive)
    search_filter = Segment.text.ilike(f"%{q}%")
    base_query = base_query.where(search_filter)

    # Add optional filters
    if transcript_id:
        base_query = base_query.where(Segment.transcript_id == transcript_id)
    if recording_id:
        base_query = base_query.where(Transcript.recording_id == recording_id)

    # Get total count
    count_query = select(func.count()).select_from(base_query.subquery())
    total = await db.scalar(count_query) or 0

    # Apply pagination and ordering
    query = (
        base_query
        .order_by(Recording.created_at.desc(), Segment.start_time)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    result = await db.execute(query)
    rows = result.all()

    # Build response
    results = []
    for row in rows:
        segment = row[0]
        rec_id = row[1]
        rec_title = row[2]

        results.append(
            SearchResultSegment(
                id=segment.id,
                segment_index=segment.segment_index,
                speaker=segment.speaker,
                start_time=segment.start_time,
                end_time=segment.end_time,
                text=segment.text,
                confidence=segment.confidence,
                transcript_id=segment.transcript_id,
                recording_id=rec_id,
                recording_title=rec_title,
            )
        )

    total_pages = (total + page_size - 1) // page_size if page_size > 0 else 0

    return SearchResponse(
        query=q,
        results=results,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


class SearchResultDocumentChunk(BaseModel):
    """A document chunk matching the search query."""

    id: str
    chunk_index: int
    chunk_text: str
    chunk_metadata: dict | None
    # Parent info
    document_id: str
    document_title: str
    document_filename: str
    document_mime_type: str

    class Config:
        from_attributes = True


class DocumentSearchResponse(BaseModel):
    """Document search results response."""

    query: str
    results: list[SearchResultDocumentChunk]
    total: int
    page: int
    page_size: int
    total_pages: int


@router.get("/documents", response_model=DocumentSearchResponse)
async def search_documents(
    db: Annotated[AsyncSession, Depends(get_db)],
    q: Annotated[str, Query(min_length=1, description="Search query")],
    document_id: Annotated[str | None, Query(description="Limit to specific document")] = None,
    page: Annotated[int, Query(ge=1, description="Page number")] = 1,
    page_size: Annotated[int, Query(ge=1, le=100, description="Results per page")] = 20,
) -> DocumentSearchResponse:
    """Search across all document content (including OCR results).

    Full-text search across document chunks. Returns matching chunks
    with their parent document information.

    Args:
        db: Database session.
        q: Search query string.
        document_id: Optional filter to specific document.
        page: Page number (1-indexed).
        page_size: Number of results per page.

    Returns:
        Search results with pagination info.
    """
    # Build base query joining document embeddings with documents
    base_query = (
        select(
            DocumentEmbedding,
            Document.title.label("document_title"),
            Document.filename.label("document_filename"),
            Document.mime_type.label("document_mime_type"),
        )
        .join(Document, DocumentEmbedding.document_id == Document.id)
        .where(Document.status == "completed")
    )

    # Add search filter (case-insensitive)
    search_filter = DocumentEmbedding.chunk_text.ilike(f"%{q}%")
    base_query = base_query.where(search_filter)

    # Add optional filters
    if document_id:
        base_query = base_query.where(DocumentEmbedding.document_id == document_id)

    # Get total count
    count_query = select(func.count()).select_from(base_query.subquery())
    total = await db.scalar(count_query) or 0

    # Apply pagination and ordering
    query = (
        base_query
        .order_by(Document.created_at.desc(), DocumentEmbedding.chunk_index)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    result = await db.execute(query)
    rows = result.all()

    # Build response
    results = []
    for row in rows:
        chunk = row[0]
        doc_title = row[1]
        doc_filename = row[2]
        doc_mime_type = row[3]

        results.append(
            SearchResultDocumentChunk(
                id=chunk.id,
                chunk_index=chunk.chunk_index,
                chunk_text=chunk.chunk_text,
                chunk_metadata=chunk.chunk_metadata,
                document_id=chunk.document_id,
                document_title=doc_title,
                document_filename=doc_filename,
                document_mime_type=doc_mime_type,
            )
        )

    total_pages = (total + page_size - 1) // page_size if page_size > 0 else 0

    return DocumentSearchResponse(
        query=q,
        results=results,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


async def _semantic_search(
    db: AsyncSession,
    query_embedding: list[float],
    limit: int,
    exclude_ids: set[str],
) -> list["GlobalSearchResult"]:
    """Perform semantic search using embeddings.

    Args:
        db: Database session.
        query_embedding: The embedded query vector.
        limit: Maximum results.
        exclude_ids: Segment IDs to exclude (already found by keyword).

    Returns:
        List of semantic search results.
    """
    # Get all embeddings (for small datasets, in-memory similarity is fast enough)
    # For larger datasets, use sqlite-vec virtual table
    query = (
        select(
            SegmentEmbedding,
            Segment,
            Transcript.recording_id,
            Recording.title.label("recording_title"),
            Recording.created_at.label("recording_created_at"),
        )
        .join(Segment, SegmentEmbedding.segment_id == Segment.id)
        .join(Transcript, Segment.transcript_id == Transcript.id)
        .join(Recording, Transcript.recording_id == Recording.id)
    )

    result = await db.execute(query)
    rows = result.all()

    if not rows:
        return []

    # Calculate cosine similarity for each
    import math

    def cosine_similarity(a: list[float], b: list[float]) -> float:
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(x * x for x in b))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)

    # Score all embeddings
    scored = []
    for row in rows:
        seg_emb = row[0]
        segment = row[1]
        rec_id = row[2]
        rec_title = row[3]
        rec_created = row[4]

        if segment.id in exclude_ids:
            continue

        emb = bytes_to_embedding(seg_emb.embedding)
        score = cosine_similarity(query_embedding, emb)
        scored.append((score, segment, rec_id, rec_title, rec_created))

    # Sort by score descending, take top N
    scored.sort(key=lambda x: x[0], reverse=True)
    top_results = scored[:limit]

    # Convert to GlobalSearchResult
    results = []
    for score, segment, rec_id, rec_title, rec_created in top_results:
        # Only include if similarity is above threshold
        if score < 0.3:
            continue
        results.append(
            GlobalSearchResult(
                type="segment",
                id=segment.id,
                title=None,
                text=segment.text,
                recording_id=rec_id,
                recording_title=rec_title,
                start_time=segment.start_time,
                end_time=segment.end_time,
                created_at=rec_created,
                match_type="semantic",
            )
        )

    return results


async def _semantic_search_documents(
    db: AsyncSession,
    query_embedding: list[float],
    limit: int,
    exclude_ids: set[str],
) -> list["GlobalSearchResult"]:
    """Perform semantic search on document embeddings.

    Args:
        db: Database session.
        query_embedding: The embedded query vector.
        limit: Maximum results.
        exclude_ids: Document chunk IDs to exclude (already found by keyword).

    Returns:
        List of semantic search results for documents.
    """
    # Get all document embeddings
    query = (
        select(
            DocumentEmbedding,
            Document.title.label("document_title"),
            Document.filename.label("document_filename"),
            Document.created_at.label("document_created_at"),
        )
        .join(Document, DocumentEmbedding.document_id == Document.id)
        .where(Document.status == "completed")
    )

    result = await db.execute(query)
    rows = result.all()

    if not rows:
        return []

    # Calculate cosine similarity for each
    import math

    def cosine_similarity(a: list[float], b: list[float]) -> float:
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(x * x for x in b))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)

    # Score all embeddings
    scored = []
    for row in rows:
        doc_emb = row[0]
        doc_title = row[1]
        doc_filename = row[2]
        doc_created = row[3]

        if doc_emb.id in exclude_ids:
            continue

        emb = bytes_to_embedding(doc_emb.embedding)
        score = cosine_similarity(query_embedding, emb)
        scored.append((score, doc_emb, doc_title, doc_filename, doc_created))

    # Sort by score descending, take top N
    scored.sort(key=lambda x: x[0], reverse=True)
    top_results = scored[:limit]

    # Convert to GlobalSearchResult
    results = []
    for score, doc_emb, doc_title, doc_filename, doc_created in top_results:
        # Only include if similarity is above threshold
        if score < 0.3:
            continue
        results.append(
            GlobalSearchResult(
                type="document",
                id=doc_emb.id,
                title=doc_title,
                text=doc_emb.chunk_text,
                document_id=doc_emb.document_id,
                document_title=doc_title,
                chunk_index=doc_emb.chunk_index,
                chunk_metadata=doc_emb.chunk_metadata,
                created_at=doc_created,
                match_type="semantic",
            )
        )

    return results


class GlobalSearchResult(BaseModel):
    """A result from global search."""

    type: str  # "recording", "segment", "document", or "note"
    id: str
    title: str | None
    text: str | None
    # Recording fields (for recording/segment results)
    recording_id: str | None = None
    recording_title: str | None = None
    start_time: float | None = None
    end_time: float | None = None
    # Document fields (for document results)
    document_id: str | None = None
    document_title: str | None = None
    chunk_index: int | None = None
    chunk_metadata: dict | None = None
    # Note fields (for note results)
    note_id: str | None = None
    anchor_type: str | None = None
    anchor_data: dict | None = None
    # Common fields
    created_at: datetime
    match_type: str | None = None  # "keyword" or "semantic"


class GlobalSearchResponse(BaseModel):
    """Global search results."""

    query: str
    results: list[GlobalSearchResult]
    total: int


@router.get("/global", response_model=GlobalSearchResponse)
async def global_search(
    db: Annotated[AsyncSession, Depends(get_db)],
    q: Annotated[str, Query(min_length=1, description="Search query")],
    limit: Annotated[int, Query(ge=1, le=50, description="Maximum results")] = 20,
    semantic: Annotated[bool, Query(description="Include semantic search results")] = True,
) -> GlobalSearchResponse:
    """Search across recordings, segments, and documents.

    Returns a combined list of matching recordings (by title),
    segments (by text content), and documents (by OCR/extracted text).

    Args:
        db: Database session.
        q: Search query string.
        limit: Maximum number of results.
        semantic: Whether to include semantic search results.

    Returns:
        Combined search results.
    """
    results: list[GlobalSearchResult] = []

    # Allocate limits: recordings (1/5), segments (1/5), documents (1/5), notes (1/5), semantic (1/5)
    keyword_limit = limit // 5 or 1

    # Search recordings by title
    recording_query = (
        select(Recording)
        .where(Recording.title.ilike(f"%{q}%"))
        .order_by(Recording.created_at.desc())
        .limit(keyword_limit)
    )
    recording_result = await db.execute(recording_query)
    recordings = recording_result.scalars().all()

    for rec in recordings:
        results.append(
            GlobalSearchResult(
                type="recording",
                id=rec.id,
                title=rec.title,
                text=None,
                recording_id=rec.id,
                recording_title=rec.title,
                start_time=None,
                end_time=None,
                created_at=rec.created_at,
                match_type="keyword",
            )
        )

    # Search segments by text
    segment_query = (
        select(
            Segment,
            Transcript.recording_id,
            Recording.title.label("recording_title"),
            Recording.created_at.label("recording_created_at"),
        )
        .join(Transcript, Segment.transcript_id == Transcript.id)
        .join(Recording, Transcript.recording_id == Recording.id)
        .where(Segment.text.ilike(f"%{q}%"))
        .order_by(Recording.created_at.desc(), Segment.start_time)
        .limit(keyword_limit)
    )
    segment_result = await db.execute(segment_query)
    segments = segment_result.all()

    for row in segments:
        segment = row[0]
        rec_id = row[1]
        rec_title = row[2]
        rec_created = row[3]

        results.append(
            GlobalSearchResult(
                type="segment",
                id=segment.id,
                title=None,
                text=segment.text,
                recording_id=rec_id,
                recording_title=rec_title,
                start_time=segment.start_time,
                end_time=segment.end_time,
                created_at=rec_created,
                match_type="keyword",
            )
        )

    # Search document chunks by text (OCR results)
    document_query = (
        select(
            DocumentEmbedding,
            Document.title.label("document_title"),
            Document.created_at.label("document_created_at"),
        )
        .join(Document, DocumentEmbedding.document_id == Document.id)
        .where(Document.status == "completed")
        .where(DocumentEmbedding.chunk_text.ilike(f"%{q}%"))
        .order_by(Document.created_at.desc(), DocumentEmbedding.chunk_index)
        .limit(keyword_limit)
    )
    document_result = await db.execute(document_query)
    document_chunks = document_result.all()

    for row in document_chunks:
        doc_emb = row[0]
        doc_title = row[1]
        doc_created = row[2]

        results.append(
            GlobalSearchResult(
                type="document",
                id=doc_emb.id,
                title=doc_title,
                text=doc_emb.chunk_text,
                document_id=doc_emb.document_id,
                document_title=doc_title,
                chunk_index=doc_emb.chunk_index,
                chunk_metadata=doc_emb.chunk_metadata,
                created_at=doc_created,
                match_type="keyword",
            )
        )

    # Search notes by content
    note_query = (
        select(
            Note,
            Document.id.label("doc_id"),
            Document.title.label("doc_title"),
            Recording.id.label("rec_id"),
            Recording.title.label("rec_title"),
        )
        .outerjoin(Document, Note.document_id == Document.id)
        .outerjoin(Recording, Note.recording_id == Recording.id)
        .where(Note.content.ilike(f"%{q}%"))
        .order_by(Note.created_at.desc())
        .limit(keyword_limit)
    )
    note_result = await db.execute(note_query)
    notes = note_result.all()

    for row in notes:
        note = row[0]
        doc_id = row[1]
        doc_title = row[2]
        rec_id = row[3]
        rec_title = row[4]

        results.append(
            GlobalSearchResult(
                type="note",
                id=note.id,
                title=None,
                text=note.content,
                recording_id=rec_id,
                recording_title=rec_title,
                document_id=doc_id,
                document_title=doc_title,
                note_id=note.id,
                anchor_type=note.anchor_type,
                anchor_data=note.anchor_data,
                created_at=note.created_at,
                match_type="keyword",
            )
        )

    # Semantic search (if enabled and available)
    if semantic and embedding_service.is_available():
        try:
            seen_ids = {r.id for r in results}
            query_embedding = await embedding_service.embed_query(q)

            # Semantic search on segments
            remaining_slots = limit - len(results)
            if remaining_slots > 0:
                segment_semantic_results = await _semantic_search(
                    db, query_embedding, remaining_slots // 2 or 1, seen_ids
                )
                results.extend(segment_semantic_results)
                seen_ids.update(r.id for r in segment_semantic_results)

            # Semantic search on documents
            remaining_slots = limit - len(results)
            if remaining_slots > 0:
                document_semantic_results = await _semantic_search_documents(
                    db, query_embedding, remaining_slots, seen_ids
                )
                results.extend(document_semantic_results)
        except Exception as e:
            logger.warning("Semantic search failed: %s", e)

    return GlobalSearchResponse(
        query=q,
        results=results,
        total=len(results),
    )
