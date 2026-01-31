# packages/backend/tests/test_storage_locations_api.py
"""Tests for storage locations API endpoints.

Note: The storage locations API uses direct async_session access rather than
dependency injection, so database-related tests are limited. The /test endpoint
tests work correctly as they don't require database access.
"""

import pytest
import shutil
import tempfile
from pathlib import Path

from httpx import AsyncClient


@pytest.fixture
def temp_dir():
    """Create a temporary directory."""
    path = Path(tempfile.mkdtemp())
    yield path
    shutil.rmtree(path, ignore_errors=True)


@pytest.mark.asyncio
async def test_test_connection_local_valid(client: AsyncClient, temp_dir: Path):
    """Test connection should succeed for valid local path."""
    response = await client.post("/api/storage-locations/test", json={
        "type": "local",
        "config": {"path": str(temp_dir)}
    })
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["latency_ms"] is not None
    assert data["latency_ms"] > 0


@pytest.mark.asyncio
async def test_test_connection_local_invalid(client: AsyncClient):
    """Test connection should fail for invalid path."""
    response = await client.post("/api/storage-locations/test", json={
        "type": "local",
        "config": {"path": "/nonexistent/path/xyz123"}
    })
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert data["error"] is not None
    assert "Cannot connect" in data["error"] or "not exist" in data["error"].lower()


@pytest.mark.asyncio
async def test_test_connection_unknown_type(client: AsyncClient):
    """Test connection should fail for unknown type."""
    response = await client.post("/api/storage-locations/test", json={
        "type": "unknown_type",
        "config": {}
    })
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert "Unknown storage type" in data["error"]


@pytest.mark.asyncio
async def test_test_connection_with_subtype(client: AsyncClient, temp_dir: Path):
    """Test connection should work with subtype specified."""
    response = await client.post("/api/storage-locations/test", json={
        "type": "local",
        "subtype": None,
        "config": {"path": str(temp_dir)}
    })
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True


@pytest.mark.asyncio
async def test_test_connection_validates_all_config_fields(client: AsyncClient, temp_dir: Path):
    """Test connection accepts all possible config fields without error."""
    response = await client.post("/api/storage-locations/test", json={
        "type": "local",
        "config": {
            "path": str(temp_dir),
            # These fields are valid in schema but not used by local adapter
            "server": None,
            "share": None,
            "bucket": None,
        }
    })
    assert response.status_code == 200
    data = response.json()
    # Should still succeed since local adapter only needs path
    assert data["success"] is True


@pytest.mark.asyncio
async def test_test_connection_returns_latency(client: AsyncClient, temp_dir: Path):
    """Test connection should return latency measurement."""
    response = await client.post("/api/storage-locations/test", json={
        "type": "local",
        "config": {"path": str(temp_dir)}
    })
    assert response.status_code == 200
    data = response.json()
    assert "latency_ms" in data
    # Latency should be a positive number when successful
    assert isinstance(data["latency_ms"], (int, float))
    assert data["latency_ms"] >= 0


@pytest.mark.asyncio
async def test_test_connection_no_latency_on_failure(client: AsyncClient):
    """Test connection should not return latency on failure."""
    response = await client.post("/api/storage-locations/test", json={
        "type": "local",
        "config": {"path": "/nonexistent/path/xyz123"}
    })
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    # On failure, latency should be None
    assert data["latency_ms"] is None
