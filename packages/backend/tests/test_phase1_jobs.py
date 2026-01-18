"""Test Phase 1: Jobs endpoints.

NOTE: Jobs tests require integration testing because the job service
uses its own database session (not dependency-injected), which requires
the actual database to be initialized. These tests are marked as
integration tests and will be skipped in normal unit test runs.
"""

import pytest
from httpx import AsyncClient

# Mark all tests in this module as integration tests
pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_list_jobs_empty(client: AsyncClient):
    """Test listing jobs when none exist."""
    response = await client.get("/api/jobs")
    assert response.status_code == 200
    data = response.json()
    assert data["items"] == []
    assert data["total"] == 0


@pytest.mark.asyncio
async def test_list_jobs_with_status_filter(client: AsyncClient):
    """Test listing jobs with status filter."""
    response = await client.get("/api/jobs?status=running")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data


@pytest.mark.asyncio
async def test_list_jobs_with_limit(client: AsyncClient):
    """Test listing jobs with limit parameter."""
    response = await client.get("/api/jobs?limit=5")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data


@pytest.mark.asyncio
async def test_get_job_not_found(client: AsyncClient):
    """Test getting non-existent job returns 404."""
    response = await client.get("/api/jobs/nonexistent-id")
    assert response.status_code == 404
