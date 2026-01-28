# Design: Semantic Search for Transcripts

## Summary

Add semantic search to find transcript segments by meaning, not just exact keyword matches. Enhances the existing `/search/global` endpoint with hybrid results: keyword matches first, semantic matches below.

## Decisions

- **Cross-transcript search** — Search across all transcripts. Within-transcript search can come later.
- **Dedicated embedding model** — `nomic-embed-text-v1.5` (274MB) via sentence-transformers. Fast, high-quality embeddings.
- **sqlite-vec** — Store embeddings in SQLite using the sqlite-vec extension. Single database file, easy backup.
- **Separate background job** — Embedding runs after transcription completes, not inline.
- **Hybrid search** — Keyword matches ranked first, semantic matches fill gaps. Single unified result list.

## Architecture

### Embedding Model

Uses `nomic-ai/nomic-embed-text-v1.5` via sentence-transformers:
- 768-dimensional embeddings
- Runs on CPU or MPS
- Lazy loads on first use
- Prefixes: `search_document:` for segments, `search_query:` for queries

### Data Flow

1. Transcription job completes
2. System auto-queues an `embed` job for that transcript
3. Embed job loads segments, generates embeddings in batch, stores in sqlite-vec
4. Transcript segments are now semantically searchable

### Search Flow

1. User types in search bar
2. Backend runs keyword search (existing `LIKE` query)
3. Backend embeds the query, runs vector similarity search
4. Results merged: keyword matches first, semantic matches appended (deduplicated)
5. Frontend displays unified results with match type badges

## Database Schema

### New Table: `segment_embeddings`

```sql
CREATE VIRTUAL TABLE segment_embeddings USING vec0(
    segment_id TEXT PRIMARY KEY,
    embedding FLOAT[768]
);
```

Or with standard table + sqlite-vec index:

```sql
CREATE TABLE segment_embeddings (
    segment_id TEXT PRIMARY KEY REFERENCES segments(id) ON DELETE CASCADE,
    embedding BLOB NOT NULL,  -- 768 floats as binary
    model_used TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

The `ON DELETE CASCADE` ensures embeddings are cleaned up when segments are deleted.

### Embedding Status

Derived from data rather than a status flag:
- Transcript is "embedded" if all its segments exist in `segment_embeddings`
- Avoids sync issues between flag and actual data

## Embedding Service

```python
# services/embedding.py
class EmbeddingService:
    def __init__(self, model_name: str = "nomic-ai/nomic-embed-text-v1.5"):
        self._model_name = model_name
        self._model = None  # Lazy load

    def _ensure_loaded(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer(self._model_name, trust_remote_code=True)

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple texts in batch."""
        self._ensure_loaded()
        prefixed = [f"search_document: {t}" for t in texts]
        embeddings = await asyncio.to_thread(self._model.encode, prefixed)
        return embeddings.tolist()

    async def embed_query(self, query: str) -> list[float]:
        """Embed a search query."""
        self._ensure_loaded()
        embedding = await asyncio.to_thread(
            self._model.encode, f"search_query: {query}"
        )
        return embedding.tolist()

    def is_available(self) -> bool:
        """Check if sentence-transformers is installed."""
        try:
            import sentence_transformers
            return True
        except ImportError:
            return False
```

## Job Handler

```python
# In services/jobs.py
async def handle_embedding(
    payload: dict[str, Any], progress_callback: ProgressCallback
) -> dict[str, Any]:
    """Generate embeddings for all segments in a transcript."""
    transcript_id = payload["transcript_id"]

    # Load segments
    segments = await get_segments_for_transcript(transcript_id)

    # Batch embed
    texts = [seg.text for seg in segments]
    embeddings = await embedding_service.embed_texts(texts)

    # Store in segment_embeddings
    for seg, emb in zip(segments, embeddings):
        await store_embedding(seg.id, emb)
        await progress_callback(...)

    return {"segment_count": len(segments)}

job_queue.register_handler("embed", handle_embedding)
```

Auto-queue after transcription in `handle_transcription`:

```python
# After successful transcription
await job_queue.enqueue("embed", {"transcript_id": transcript_id})
```

## Search API Enhancement

Enhance existing `GET /search/global`:

```python
class GlobalSearchResult(BaseModel):
    type: str  # "recording" or "segment"
    id: str
    title: str | None
    text: str | None
    recording_id: str
    recording_title: str
    start_time: float | None
    end_time: float | None
    created_at: datetime
    match_type: str | None  # NEW: "keyword" or "semantic"

@router.get("/global", response_model=GlobalSearchResponse)
async def global_search(
    db: Annotated[AsyncSession, Depends(get_db)],
    q: Annotated[str, Query(min_length=1)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    semantic: Annotated[bool, Query()] = True,  # NEW
) -> GlobalSearchResponse:
    results = []
    seen_ids = set()

    # 1. Keyword search (existing logic)
    keyword_results = await keyword_search(db, q, limit)
    for r in keyword_results:
        r.match_type = "keyword"
        results.append(r)
        seen_ids.add(r.id)

    # 2. Semantic search (if enabled and available)
    if semantic and embedding_service.is_available():
        query_embedding = await embedding_service.embed_query(q)
        semantic_results = await vector_search(db, query_embedding, limit)
        for r in semantic_results:
            if r.id not in seen_ids:
                r.match_type = "semantic"
                results.append(r)

    return GlobalSearchResponse(query=q, results=results[:limit], total=len(results))
```

Vector search query:

```sql
SELECT segment_id, distance
FROM segment_embeddings
WHERE embedding MATCH ?
ORDER BY distance
LIMIT ?
```

## Frontend Changes

### Search Bar Results

```
┌─────────────────────────────────────────────────┐
│ 🔍 "budget concerns"                            │
├─────────────────────────────────────────────────┤
│ 📝 Weekly Standup - Jan 15                      │
│    "...we need to revisit the pricing before..."│
│    keyword · 2:34                               │
├─────────────────────────────────────────────────┤
│ 📝 Client Call - Acme Corp                      │
│    "...the cost structure isn't sustainable..." │
│    ✨ semantic · 14:22                          │
└─────────────────────────────────────────────────┘
```

- Shows match type badge (keyword vs semantic)
- Click navigates to transcript at timestamp
- Graceful degradation: if embeddings not ready, only keyword results shown

### API Client

```typescript
// lib/api.ts
search: {
  global: (query: string, options?: { limit?: number; semantic?: boolean }) =>
    fetchJson<GlobalSearchResponse>(`/api/search/global?q=${encodeURIComponent(query)}&limit=${options?.limit ?? 20}&semantic=${options?.semantic ?? true}`)
}
```

## Dependencies

```toml
# pyproject.toml
[project.optional-dependencies]
embeddings = [
    "sentence-transformers>=2.2.0",
    "sqlite-vec>=0.1.0",
]
```

Separate optional group since sentence-transformers pulls in torch (~2GB).

## Files Changed

| File | Change |
|------|--------|
| `pyproject.toml` | Add `[embeddings]` optional deps |
| `persistence/models.py` | Add `SegmentEmbedding` model |
| `persistence/database.py` | Load sqlite-vec extension at init |
| `services/embedding.py` | **New:** EmbeddingService class |
| `services/jobs.py` | Add `handle_embedding` job, auto-queue after transcription |
| `api/routes/search.py` | Enhance `global_search` with semantic search, add `match_type` |
| `frontend/src/lib/api.ts` | Add `semantic` param to search |
| `frontend/src/components/SearchBar.tsx` | Show match type badge |

## Verification

1. Install deps: `pip install -e ".[embeddings]"`
2. Transcribe a recording → embed job auto-queues and completes
3. `curl "localhost:8000/api/search/global?q=budget"` returns results with `match_type`
4. Search "pricing" finds segments mentioning "cost", "fee", "budget"
5. Search bar shows keyword matches first, semantic below
6. Click result → navigates to transcript at correct timestamp
7. `semantic=false` returns only keyword matches (backward compatible)
