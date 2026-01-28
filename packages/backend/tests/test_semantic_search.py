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
