"""Test Phase 1: Recording management endpoints."""

import pytest
from httpx import AsyncClient
from pathlib import Path


@pytest.mark.asyncio
async def test_list_recordings_empty(client: AsyncClient):
    """Test listing recordings when none exist."""
    response = await client.get("/api/recordings")
    assert response.status_code == 200
    data = response.json()
    assert data["items"] == []
    assert data["total"] == 0
    assert data["page"] == 1


@pytest.mark.asyncio
async def test_list_recordings_pagination(client: AsyncClient):
    """Test recording list pagination parameters."""
    response = await client.get("/api/recordings?page=1&page_size=10")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "total" in data
    assert "page" in data
    assert "page_size" in data
    assert "total_pages" in data


@pytest.mark.asyncio
async def test_get_recording_not_found(client: AsyncClient):
    """Test getting non-existent recording returns 404."""
    response = await client.get("/api/recordings/nonexistent-id")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_delete_recording_not_found(client: AsyncClient):
    """Test deleting non-existent recording returns 404."""
    response = await client.delete("/api/recordings/nonexistent-id")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_upload_recording_no_file(client: AsyncClient):
    """Test upload endpoint requires a file."""
    response = await client.post("/api/recordings/upload")
    assert response.status_code == 422  # Validation error


@pytest.mark.asyncio
async def test_transcribe_recording_not_found(client: AsyncClient):
    """Test transcribe endpoint with non-existent recording."""
    response = await client.post("/api/recordings/nonexistent-id/transcribe")
    assert response.status_code == 404
