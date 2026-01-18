"""Test Phase 2: Search endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_search_segments_empty(client: AsyncClient):
    """Test segment search with no results."""
    response = await client.get("/api/search/segments?q=hello")
    assert response.status_code == 200
    data = response.json()
    assert data["query"] == "hello"
    assert data["results"] == []
    assert data["total"] == 0


@pytest.mark.asyncio
async def test_search_segments_pagination(client: AsyncClient):
    """Test segment search pagination."""
    response = await client.get("/api/search/segments?q=test&page=1&page_size=10")
    assert response.status_code == 200
    data = response.json()
    assert "results" in data
    assert "page" in data
    assert "page_size" in data


@pytest.mark.asyncio
async def test_search_segments_requires_query(client: AsyncClient):
    """Test segment search requires query parameter."""
    response = await client.get("/api/search/segments")
    assert response.status_code == 422  # Missing required parameter


@pytest.mark.asyncio
async def test_global_search_empty(client: AsyncClient):
    """Test global search with no results."""
    response = await client.get("/api/search/global?q=hello")
    assert response.status_code == 200
    data = response.json()
    assert data["query"] == "hello"
    assert data["results"] == []
    assert data["total"] == 0


@pytest.mark.asyncio
async def test_global_search_with_limit(client: AsyncClient):
    """Test global search with limit."""
    response = await client.get("/api/search/global?q=test&limit=5")
    assert response.status_code == 200
    data = response.json()
    assert "results" in data
