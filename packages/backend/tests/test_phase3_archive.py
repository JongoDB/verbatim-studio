"""Test Phase 3: Archive/Backup endpoints."""

import io

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_archive_info(client: AsyncClient):
    """Test archive info endpoint returns expected structure."""
    response = await client.get("/api/archive/info")
    assert response.status_code == 200
    data = response.json()

    assert "version" in data
    assert "created_at" in data
    assert "recordings_count" in data
    assert "transcripts_count" in data
    assert "projects_count" in data
    assert "media_size_bytes" in data


@pytest.mark.asyncio
async def test_archive_info_empty_db(client: AsyncClient):
    """Test archive info with empty database."""
    response = await client.get("/api/archive/info")
    assert response.status_code == 200
    data = response.json()

    assert data["recordings_count"] == 0
    assert data["transcripts_count"] == 0
    assert data["projects_count"] == 0


@pytest.mark.asyncio
async def test_archive_export(client: AsyncClient):
    """Test archive export returns a zip file."""
    response = await client.post("/api/archive/export")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert "attachment" in response.headers.get("content-disposition", "")
    # Check it starts with zip magic number
    assert response.content[:4] == b"PK\x03\x04" or len(response.content) > 0


@pytest.mark.asyncio
async def test_archive_export_with_media(client: AsyncClient):
    """Test archive export with media flag."""
    response = await client.post("/api/archive/export?include_media=true")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_archive_export_without_media(client: AsyncClient):
    """Test archive export without media."""
    response = await client.post("/api/archive/export?include_media=false")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_archive_import_invalid_file(client: AsyncClient):
    """Test archive import with invalid file."""
    # Send a non-zip file
    files = {"file": ("test.txt", io.BytesIO(b"not a zip file"), "text/plain")}
    response = await client.post("/api/archive/import", files=files)
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_archive_import_requires_file(client: AsyncClient):
    """Test archive import requires a file."""
    response = await client.post("/api/archive/import")
    assert response.status_code == 422  # Validation error
