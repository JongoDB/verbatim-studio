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
from persistence.models import Document, DocumentEmbedding, Recording, Segment, SegmentEmbedding, Transcript
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


class DocumentSearchResult(BaseModel):
    """Single document search result."""

    document_id: str
    document_title: str
    chunk_text: str
    chunk_index: int
    similarity: float
    page: int | None = None


class DocumentSearchResponse(BaseModel):
    """Document search response."""

    results: list[DocumentSearchResult]
    total: int


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    import math

    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


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


class GlobalSearchResult(BaseModel):
    """A result from global search."""

    type: str  # "recording" or "segment"
    id: str
    title: str | None
    text: str | None
    recording_id: str
    recording_title: str
    start_time: float | None
    end_time: float | None
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
    """Search across recordings and segments.

    Returns a combined list of matching recordings (by title) and
    segments (by text content).

    Args:
        db: Database session.
        q: Search query string.
        limit: Maximum number of results.

    Returns:
        Combined search results.
    """
    results: list[GlobalSearchResult] = []

    # Search recordings by title
    recording_query = (
        select(Recording)
        .where(Recording.title.ilike(f"%{q}%"))
        .order_by(Recording.created_at.desc())
        .limit(limit // 2)
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
        .limit(limit - len(results))
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

    # Semantic search (if enabled and available)
    if semantic and embedding_service.is_available():
        try:
            seen_ids = {r.id for r in results}
            query_embedding = await embedding_service.embed_query(q)
            semantic_results = await _semantic_search(
                db, query_embedding, limit - len(results), seen_ids
            )
            results.extend(semantic_results)
        except Exception as e:
            logger.warning("Semantic search failed: %s", e)

    return GlobalSearchResponse(
        query=q,
        results=results,
        total=len(results),
    )


@router.get("/documents", response_model=DocumentSearchResponse)
async def search_documents(
    db: Annotated[AsyncSession, Depends(get_db)],
    query: Annotated[str, Query(min_length=1, description="Search query")],
    project_id: Annotated[str | None, Query(description="Filter by project")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    threshold: Annotated[float, Query(ge=0, le=1)] = 0.3,
) -> DocumentSearchResponse:
    """Semantic search across document content.

    Searches document chunks using embedding similarity. Returns matching
    chunks ranked by cosine similarity to the query.

    Args:
        db: Database session.
        query: Search query string.
        project_id: Optional filter to specific project.
        limit: Maximum number of results.
        threshold: Minimum similarity threshold (0-1).

    Returns:
        Document search results with similarity scores.
    """
    if not embedding_service.is_available():
        return DocumentSearchResponse(results=[], total=0)

    # Embed the query
    try:
        query_embedding = await embedding_service.embed_query(query)
    except Exception as e:
        logger.error(f"Failed to embed query: {e}")
        return DocumentSearchResponse(results=[], total=0)

    # Fetch document embeddings
    stmt = (
        select(DocumentEmbedding, Document)
        .join(Document, DocumentEmbedding.document_id == Document.id)
        .where(Document.status == "completed")
    )
    if project_id:
        stmt = stmt.where(Document.project_id == project_id)

    result = await db.execute(stmt)
    rows = result.all()

    if not rows:
        return DocumentSearchResponse(results=[], total=0)

    # Compute similarities
    scored_results = []
    for doc_emb, doc in rows:
        emb_vector = bytes_to_embedding(doc_emb.embedding)
        similarity = _cosine_similarity(query_embedding, emb_vector)

        if similarity >= threshold:
            scored_results.append(
                DocumentSearchResult(
                    document_id=doc.id,
                    document_title=doc.title,
                    chunk_text=doc_emb.chunk_text[:500],  # Truncate for response
                    chunk_index=doc_emb.chunk_index,
                    similarity=round(similarity, 4),
                    page=doc_emb.chunk_metadata.get("page") if doc_emb.chunk_metadata else None,
                )
            )

    # Sort by similarity descending
    scored_results.sort(key=lambda x: x.similarity, reverse=True)

    return DocumentSearchResponse(
        results=scored_results[:limit],
        total=len(scored_results),
    )
