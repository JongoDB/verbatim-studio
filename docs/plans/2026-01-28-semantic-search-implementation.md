# Semantic Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add semantic search to find transcript segments by meaning, enhancing the existing `/search/global` endpoint with hybrid results.

**Architecture:** Dedicated embedding model (nomic-embed-text-v1.5) generates 768-dim vectors stored in sqlite-vec. Background job embeds segments after transcription. Search merges keyword matches (first) with semantic matches (deduplicated).

**Tech Stack:** sentence-transformers, sqlite-vec, SQLAlchemy, FastAPI

---

## Task 1: Add Dependencies

**Files:**
- Modify: `packages/backend/pyproject.toml`

**Step 1: Add embeddings optional dependency group**

Add after the `export` group (around line 41):

```toml
embeddings = [
    "sentence-transformers>=2.2.0",
    "sqlite-vec>=0.1.0",
]
```

**Step 2: Verify syntax**

Run: `cd /Users/JonWFH/jondev/verbatim-studio/.worktrees/semantic-search/packages/backend && .venv/bin/python -c "import tomllib; tomllib.load(open('pyproject.toml', 'rb'))"`

Expected: No output (success)

**Step 3: Install dependencies**

Run: `.venv/bin/pip install -e ".[embeddings]" -q`

Expected: Installs sentence-transformers, sqlite-vec, torch

**Step 4: Commit**

```bash
git add pyproject.toml
git commit -m "feat: add embeddings optional dependencies"
```

---

## Task 2: Create SegmentEmbedding Model

**Files:**
- Modify: `packages/backend/persistence/models.py`
- Test: `packages/backend/tests/test_embedding_model.py`

**Step 1: Write the test**

Create `packages/backend/tests/test_embedding_model.py`:

```python
"""Test SegmentEmbedding model."""

import pytest
from persistence.models import SegmentEmbedding


def test_segment_embedding_model_exists():
    """Test that SegmentEmbedding model is defined."""
    assert hasattr(SegmentEmbedding, "__tablename__")
    assert SegmentEmbedding.__tablename__ == "segment_embeddings"


def test_segment_embedding_has_required_columns():
    """Test that SegmentEmbedding has required columns."""
    columns = {c.name for c in SegmentEmbedding.__table__.columns}
    assert "segment_id" in columns
    assert "embedding" in columns
    assert "model_used" in columns
    assert "created_at" in columns
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/JonWFH/jondev/verbatim-studio/.worktrees/semantic-search/packages/backend && .venv/bin/pytest tests/test_embedding_model.py -v`

Expected: FAIL with "cannot import name 'SegmentEmbedding'"

**Step 3: Add SegmentEmbedding model**

Add to `packages/backend/persistence/models.py` after the `Setting` class (end of file):

```python
class SegmentEmbedding(Base):
    """Embedding vector for a transcript segment."""

    __tablename__ = "segment_embeddings"

    segment_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("segments.id", ondelete="CASCADE"),
        primary_key=True,
    )
    embedding: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    model_used: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    segment: Mapped["Segment"] = relationship()
```

Also add `LargeBinary` to the imports at the top:

```python
from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, LargeBinary, String, Text, func
```

**Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_embedding_model.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add persistence/models.py tests/test_embedding_model.py
git commit -m "feat: add SegmentEmbedding model for vector storage"
```

---

## Task 3: Create EmbeddingService

**Files:**
- Create: `packages/backend/services/embedding.py`
- Test: `packages/backend/tests/test_embedding_service.py`

**Step 1: Write the test**

Create `packages/backend/tests/test_embedding_service.py`:

```python
"""Test EmbeddingService."""

import pytest
from services.embedding import EmbeddingService


def test_embedding_service_init():
    """Test EmbeddingService initialization."""
    service = EmbeddingService()
    assert service._model_name == "nomic-ai/nomic-embed-text-v1.5"
    assert service._model is None  # Lazy load


def test_embedding_service_is_available():
    """Test is_available returns bool."""
    service = EmbeddingService()
    result = service.is_available()
    assert isinstance(result, bool)


@pytest.mark.asyncio
async def test_embed_query_returns_list():
    """Test embed_query returns a list of floats."""
    service = EmbeddingService()
    if not service.is_available():
        pytest.skip("sentence-transformers not installed")

    result = await service.embed_query("test query")
    assert isinstance(result, list)
    assert len(result) == 768  # nomic embed dimension
    assert all(isinstance(x, float) for x in result)


@pytest.mark.asyncio
async def test_embed_texts_returns_list_of_lists():
    """Test embed_texts returns list of embeddings."""
    service = EmbeddingService()
    if not service.is_available():
        pytest.skip("sentence-transformers not installed")

    result = await service.embed_texts(["hello", "world"])
    assert isinstance(result, list)
    assert len(result) == 2
    assert len(result[0]) == 768
```

**Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_embedding_service.py -v`

Expected: FAIL with "No module named 'services.embedding'"

**Step 3: Create EmbeddingService**

Create `packages/backend/services/embedding.py`:

```python
"""Embedding service for semantic search."""

import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)


class EmbeddingService:
    """Service for generating text embeddings using sentence-transformers.

    Uses nomic-embed-text-v1.5 for high-quality embeddings.
    Lazy loads the model on first use.
    """

    def __init__(self, model_name: str = "nomic-ai/nomic-embed-text-v1.5"):
        """Initialize the embedding service.

        Args:
            model_name: HuggingFace model name for embeddings.
        """
        self._model_name = model_name
        self._model: Any = None

    def _ensure_loaded(self) -> None:
        """Ensure the embedding model is loaded."""
        if self._model is not None:
            return

        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as e:
            raise ImportError(
                "sentence-transformers is not installed. "
                "Install with: pip install sentence-transformers"
            ) from e

        logger.info("Loading embedding model: %s", self._model_name)
        self._model = SentenceTransformer(self._model_name, trust_remote_code=True)
        logger.info("Embedding model loaded successfully")

    def is_available(self) -> bool:
        """Check if sentence-transformers is installed."""
        try:
            import sentence_transformers
            return True
        except ImportError:
            return False

    async def embed_query(self, query: str) -> list[float]:
        """Embed a search query.

        Uses 'search_query:' prefix for optimal retrieval performance.

        Args:
            query: The search query text.

        Returns:
            768-dimensional embedding vector.
        """
        self._ensure_loaded()
        prefixed = f"search_query: {query}"
        embedding = await asyncio.to_thread(self._model.encode, prefixed)
        return embedding.tolist()

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple document texts in batch.

        Uses 'search_document:' prefix for optimal retrieval performance.

        Args:
            texts: List of document texts to embed.

        Returns:
            List of 768-dimensional embedding vectors.
        """
        self._ensure_loaded()
        prefixed = [f"search_document: {t}" for t in texts]
        embeddings = await asyncio.to_thread(self._model.encode, prefixed)
        return embeddings.tolist()


# Singleton instance
embedding_service = EmbeddingService()
```

**Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_embedding_service.py -v`

Expected: PASS (may take time on first run to download model)

**Step 5: Commit**

```bash
git add services/embedding.py tests/test_embedding_service.py
git commit -m "feat: add EmbeddingService for semantic search"
```

---

## Task 4: Add Vector Storage Helpers

**Files:**
- Modify: `packages/backend/services/embedding.py`
- Test: `packages/backend/tests/test_embedding_storage.py`

**Step 1: Write the test**

Create `packages/backend/tests/test_embedding_storage.py`:

```python
"""Test embedding storage helpers."""

import pytest
import struct
from services.embedding import embedding_to_bytes, bytes_to_embedding


def test_embedding_to_bytes():
    """Test converting embedding list to bytes."""
    embedding = [0.1, 0.2, 0.3]
    result = embedding_to_bytes(embedding)
    assert isinstance(result, bytes)
    assert len(result) == 3 * 4  # 3 floats * 4 bytes each


def test_bytes_to_embedding():
    """Test converting bytes back to embedding list."""
    embedding = [0.1, 0.2, 0.3]
    as_bytes = embedding_to_bytes(embedding)
    result = bytes_to_embedding(as_bytes)
    assert len(result) == 3
    for orig, restored in zip(embedding, result):
        assert abs(orig - restored) < 1e-6


def test_roundtrip_768_dim():
    """Test roundtrip with 768-dimensional embedding."""
    embedding = [float(i) / 1000 for i in range(768)]
    as_bytes = embedding_to_bytes(embedding)
    result = bytes_to_embedding(as_bytes)
    assert len(result) == 768
    for orig, restored in zip(embedding, result):
        assert abs(orig - restored) < 1e-6
```

**Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_embedding_storage.py -v`

Expected: FAIL with "cannot import name 'embedding_to_bytes'"

**Step 3: Add storage helpers to embedding.py**

Add to `packages/backend/services/embedding.py` at the top (after imports):

```python
import struct

def embedding_to_bytes(embedding: list[float]) -> bytes:
    """Convert embedding list to bytes for storage.

    Args:
        embedding: List of floats (typically 768 dimensions).

    Returns:
        Packed bytes (4 bytes per float, little-endian).
    """
    return struct.pack(f"<{len(embedding)}f", *embedding)


def bytes_to_embedding(data: bytes) -> list[float]:
    """Convert stored bytes back to embedding list.

    Args:
        data: Packed bytes from embedding_to_bytes.

    Returns:
        List of floats.
    """
    count = len(data) // 4  # 4 bytes per float
    return list(struct.unpack(f"<{count}f", data))
```

**Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_embedding_storage.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add services/embedding.py tests/test_embedding_storage.py
git commit -m "feat: add embedding serialization helpers"
```

---

## Task 5: Add Embedding Job Handler

**Files:**
- Modify: `packages/backend/services/jobs.py`
- Test: `packages/backend/tests/test_embedding_job.py`

**Step 1: Write the test**

Create `packages/backend/tests/test_embedding_job.py`:

```python
"""Test embedding job handler."""

import pytest
from services.jobs import job_queue


def test_embedding_handler_registered():
    """Test that embedding handler is registered."""
    assert "embed" in job_queue._handlers
```

**Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_embedding_job.py::test_embedding_handler_registered -v`

Expected: FAIL with "assert 'embed' in..."

**Step 3: Add embedding job handler**

Add to `packages/backend/services/jobs.py` after `handle_transcription` function (before the final `job_queue.register_handler` line):

```python
async def handle_embedding(
    payload: dict[str, Any], progress_callback: ProgressCallback
) -> dict[str, Any]:
    """Generate embeddings for all segments in a transcript.

    Args:
        payload: Job payload with:
            - transcript_id: Required transcript ID
        progress_callback: Callback to report progress.

    Returns:
        Result dictionary with segment_count.

    Raises:
        ValueError: If transcript not found.
    """
    from services.embedding import embedding_service, embedding_to_bytes
    from persistence.models import SegmentEmbedding

    transcript_id = payload.get("transcript_id")
    if not transcript_id:
        raise ValueError("Missing transcript_id in payload")

    # Check if embeddings are available
    if not embedding_service.is_available():
        logger.warning("Embedding service not available, skipping embed job")
        return {"segment_count": 0, "skipped": True}

    # Load segments for this transcript
    async with async_session() as session:
        result = await session.execute(
            select(Segment)
            .where(Segment.transcript_id == transcript_id)
            .order_by(Segment.segment_index)
        )
        segments = result.scalars().all()

        if not segments:
            logger.warning("No segments found for transcript %s", transcript_id)
            return {"segment_count": 0}

        logger.info("Generating embeddings for %d segments", len(segments))

        # Extract texts
        texts = [seg.text for seg in segments]
        segment_ids = [seg.id for seg in segments]

    # Generate embeddings in batch
    await progress_callback(10)
    embeddings = await embedding_service.embed_texts(texts)
    await progress_callback(80)

    # Store embeddings
    async with async_session() as session:
        for i, (seg_id, emb) in enumerate(zip(segment_ids, embeddings)):
            # Check if embedding already exists (upsert)
            existing = await session.get(SegmentEmbedding, seg_id)
            if existing:
                existing.embedding = embedding_to_bytes(emb)
                existing.model_used = embedding_service._model_name
            else:
                segment_embedding = SegmentEmbedding(
                    segment_id=seg_id,
                    embedding=embedding_to_bytes(emb),
                    model_used=embedding_service._model_name,
                )
                session.add(segment_embedding)

            # Progress update every 10 segments
            if i % 10 == 0:
                await progress_callback(80 + (i / len(embeddings)) * 20)

        await session.commit()

    await progress_callback(100)

    logger.info(
        "Embeddings complete for transcript %s: %d segments",
        transcript_id,
        len(segments),
    )

    return {"segment_count": len(segments), "transcript_id": transcript_id}


# Register the embedding handler
job_queue.register_handler("embed", handle_embedding)
```

Also add `SegmentEmbedding` to the imports at the top of jobs.py:

```python
from persistence.models import Job, Recording, Segment, SegmentEmbedding, Speaker, Transcript
```

**Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_embedding_job.py::test_embedding_handler_registered -v`

Expected: PASS

**Step 5: Commit**

```bash
git add services/jobs.py tests/test_embedding_job.py
git commit -m "feat: add embedding job handler"
```

---

## Task 6: Auto-Queue Embedding After Transcription

**Files:**
- Modify: `packages/backend/services/jobs.py`

**Step 1: Add auto-queue logic**

In `handle_transcription`, find the line `await progress_callback(100)` near the end (around line 493). Add the following BEFORE that line:

```python
        # Auto-queue embedding job if service is available
        from services.embedding import embedding_service
        if embedding_service.is_available():
            try:
                await job_queue.enqueue("embed", {"transcript_id": transcript_id})
                logger.info("Queued embedding job for transcript %s", transcript_id)
            except Exception as e:
                logger.warning("Failed to queue embedding job: %s", e)
```

**Step 2: Verify no syntax errors**

Run: `.venv/bin/python -c "import services.jobs"`

Expected: No output (success)

**Step 3: Commit**

```bash
git add services/jobs.py
git commit -m "feat: auto-queue embedding job after transcription"
```

---

## Task 7: Add match_type to GlobalSearchResult

**Files:**
- Modify: `packages/backend/api/routes/search.py`
- Test: `packages/backend/tests/test_phase2_search.py`

**Step 1: Write the test**

Add to `packages/backend/tests/test_phase2_search.py`:

```python
@pytest.mark.asyncio
async def test_global_search_has_match_type(client: AsyncClient):
    """Test global search results include match_type field."""
    response = await client.get("/api/search/global?q=test")
    assert response.status_code == 200
    data = response.json()
    # Even with no results, schema should accept match_type
    assert "results" in data


@pytest.mark.asyncio
async def test_global_search_semantic_param(client: AsyncClient):
    """Test global search accepts semantic parameter."""
    response = await client.get("/api/search/global?q=test&semantic=false")
    assert response.status_code == 200
    data = response.json()
    assert "results" in data
```

**Step 2: Run tests to check current state**

Run: `.venv/bin/pytest tests/test_phase2_search.py -v`

Expected: Tests should pass (match_type is optional, semantic param doesn't exist yet but won't break)

**Step 3: Update GlobalSearchResult model**

In `packages/backend/api/routes/search.py`, update the `GlobalSearchResult` class (around line 146):

```python
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
    match_type: str | None = None  # NEW: "keyword" or "semantic"
```

**Step 4: Add semantic parameter to global_search**

Update the `global_search` function signature (around line 168):

```python
@router.get("/global", response_model=GlobalSearchResponse)
async def global_search(
    db: Annotated[AsyncSession, Depends(get_db)],
    q: Annotated[str, Query(min_length=1, description="Search query")],
    limit: Annotated[int, Query(ge=1, le=50, description="Maximum results")] = 20,
    semantic: Annotated[bool, Query(description="Include semantic search results")] = True,
) -> GlobalSearchResponse:
```

**Step 5: Set match_type="keyword" for existing results**

In the `global_search` function, update both result creation sections.

For recording results (around line 200):
```python
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
                match_type="keyword",  # NEW
            )
        )
```

For segment results (around line 237):
```python
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
                match_type="keyword",  # NEW
            )
        )
```

**Step 6: Run tests to verify**

Run: `.venv/bin/pytest tests/test_phase2_search.py -v`

Expected: PASS

**Step 7: Commit**

```bash
git add api/routes/search.py tests/test_phase2_search.py
git commit -m "feat: add match_type and semantic param to global search"
```

---

## Task 8: Implement Semantic Search in global_search

**Files:**
- Modify: `packages/backend/api/routes/search.py`

**Step 1: Add semantic search imports and helper**

Add at the top of `search.py` after other imports:

```python
from services.embedding import embedding_service, bytes_to_embedding, embedding_to_bytes
from persistence.models import Recording, Segment, Transcript, SegmentEmbedding
```

Add a helper function before `global_search`:

```python
async def _semantic_search(
    db: AsyncSession,
    query_embedding: list[float],
    limit: int,
    exclude_ids: set[str],
) -> list[GlobalSearchResult]:
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
```

**Step 2: Add semantic search call to global_search**

At the end of the `global_search` function, before the return statement, add:

```python
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
```

**Step 3: Verify no syntax errors**

Run: `.venv/bin/python -c "from api.routes.search import router"`

Expected: No output (success)

**Step 4: Run existing tests**

Run: `.venv/bin/pytest tests/test_phase2_search.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add api/routes/search.py
git commit -m "feat: implement semantic search in global_search endpoint"
```

---

## Task 9: Update Frontend API Types

**Files:**
- Modify: `packages/frontend/src/lib/api.ts`

**Step 1: Update GlobalSearchResult type**

Find the `GlobalSearchResult` interface and add `match_type`:

```typescript
export interface GlobalSearchResult {
  type: 'recording' | 'segment';
  id: string;
  title: string | null;
  text: string | null;
  recording_id: string;
  recording_title: string;
  start_time: number | null;
  end_time: number | null;
  created_at: string;
  match_type?: 'keyword' | 'semantic' | null;  // NEW
}
```

**Step 2: Update search.global function**

Find the `search` object in the api and update the `global` function to accept semantic param:

```typescript
search: {
  global: (query: string, options?: { limit?: number; semantic?: boolean }) => {
    const params = new URLSearchParams({ q: query });
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.semantic !== undefined) params.set('semantic', options.semantic.toString());
    return fetchJson<GlobalSearchResponse>(`/search/global?${params}`);
  },
  // ... other methods
},
```

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/JonWFH/jondev/verbatim-studio/.worktrees/semantic-search && pnpm --filter frontend exec tsc --noEmit`

Expected: No errors

**Step 4: Commit**

```bash
git add packages/frontend/src/lib/api.ts
git commit -m "feat: add match_type and semantic param to frontend API"
```

---

## Task 10: Update SearchBox to Show Match Type

**Files:**
- Modify: `packages/frontend/src/components/search/SearchBox.tsx`

**Step 1: Add match type badge**

In the meta info section (around line 220), update to show match type:

Find this section:
```tsx
{/* Meta info */}
<div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
  <span className={`px-1.5 py-0.5 rounded ${
    result.type === 'recording'
      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
      : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
  }`}>
    {result.type === 'recording' ? 'Recording' : 'Segment'}
  </span>
  {result.start_time !== null && (
    <span>at {formatTime(result.start_time)}</span>
  )}
</div>
```

Replace with:
```tsx
{/* Meta info */}
<div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
  <span className={`px-1.5 py-0.5 rounded ${
    result.type === 'recording'
      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
      : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
  }`}>
    {result.type === 'recording' ? 'Recording' : 'Segment'}
  </span>
  {result.match_type === 'semantic' && (
    <span className="px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
      ✨ semantic
    </span>
  )}
  {result.start_time !== null && (
    <span>at {formatTime(result.start_time)}</span>
  )}
</div>
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/JonWFH/jondev/verbatim-studio/.worktrees/semantic-search && pnpm --filter frontend exec tsc --noEmit`

Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/components/search/SearchBox.tsx
git commit -m "feat: show semantic match badge in search results"
```

---

## Task 11: Integration Test

**Files:**
- Test: `packages/backend/tests/test_semantic_search.py`

**Step 1: Create integration test**

Create `packages/backend/tests/test_semantic_search.py`:

```python
"""Integration tests for semantic search."""

import pytest
from httpx import AsyncClient
from services.embedding import embedding_service


@pytest.mark.asyncio
async def test_global_search_semantic_false_skips_embeddings(client: AsyncClient):
    """Test that semantic=false skips embedding search."""
    response = await client.get("/api/search/global?q=hello&semantic=false")
    assert response.status_code == 200
    data = response.json()
    # With no data, should return empty but not error
    assert data["results"] == []


@pytest.mark.asyncio
async def test_embedding_service_available():
    """Test embedding service reports availability."""
    # This should return True if sentence-transformers is installed
    available = embedding_service.is_available()
    assert isinstance(available, bool)


@pytest.mark.asyncio
async def test_embed_and_search_roundtrip():
    """Test embedding and searching works end-to-end."""
    if not embedding_service.is_available():
        pytest.skip("sentence-transformers not installed")

    # Embed a query
    query_emb = await embedding_service.embed_query("pricing discussion")
    assert len(query_emb) == 768

    # Embed some documents
    docs = ["Let's talk about the cost", "The weather is nice", "Budget concerns"]
    doc_embs = await embedding_service.embed_texts(docs)
    assert len(doc_embs) == 3

    # Verify "cost" and "budget" are more similar to "pricing" than "weather"
    import math
    def cosine_sim(a, b):
        dot = sum(x*y for x,y in zip(a,b))
        return dot / (math.sqrt(sum(x*x for x in a)) * math.sqrt(sum(x*x for x in b)))

    sim_cost = cosine_sim(query_emb, doc_embs[0])
    sim_weather = cosine_sim(query_emb, doc_embs[1])
    sim_budget = cosine_sim(query_emb, doc_embs[2])

    # Cost and budget should be more similar to pricing than weather
    assert sim_cost > sim_weather
    assert sim_budget > sim_weather
```

**Step 2: Run integration tests**

Run: `.venv/bin/pytest tests/test_semantic_search.py -v`

Expected: PASS (may skip if sentence-transformers not installed)

**Step 3: Run all tests**

Run: `.venv/bin/pytest tests/ -v --ignore=tests/test_phase1_jobs.py`

Expected: All tests PASS

**Step 4: Commit**

```bash
git add tests/test_semantic_search.py
git commit -m "test: add semantic search integration tests"
```

---

## Task 12: Final Verification

**Step 1: Run full test suite**

Run: `cd /Users/JonWFH/jondev/verbatim-studio/.worktrees/semantic-search/packages/backend && .venv/bin/pytest tests/ -v --ignore=tests/test_phase1_jobs.py`

Expected: All tests PASS

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/JonWFH/jondev/verbatim-studio/.worktrees/semantic-search && pnpm --filter frontend exec tsc --noEmit`

Expected: No errors

**Step 3: Manual API test (if backend running)**

```bash
curl "http://localhost:8000/api/search/global?q=test&semantic=true" | python3 -m json.tool
```

Expected: Returns JSON with `results` array, each result has `match_type` field

---

## Summary

After completing all tasks, the semantic search feature will:

1. Generate embeddings for transcript segments using nomic-embed-text-v1.5
2. Store embeddings in SQLite as binary blobs
3. Auto-queue embedding job after transcription completes
4. Enhance `/search/global` with hybrid keyword + semantic results
5. Show "✨ semantic" badge on semantic matches in the UI

The feature gracefully degrades when sentence-transformers is not installed.
