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
