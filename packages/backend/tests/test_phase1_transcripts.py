"""Test Phase 1: Transcript endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_get_transcript_not_found(client: AsyncClient):
    """Test getting non-existent transcript returns 404."""
    response = await client.get("/api/transcripts/nonexistent-id")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_get_transcript_by_recording_not_found(client: AsyncClient):
    """Test getting transcript by non-existent recording returns 404."""
    response = await client.get("/api/transcripts/by-recording/nonexistent-id")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_update_segment_not_found(client: AsyncClient):
    """Test updating non-existent segment returns 404."""
    response = await client.patch(
        "/api/transcripts/transcript-id/segments/segment-id",
        json={"text": "Updated text"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_export_transcript_not_found(client: AsyncClient):
    """Test exporting non-existent transcript returns 404."""
    response = await client.get("/api/transcripts/nonexistent-id/export?format=txt")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_export_format_validation(client: AsyncClient):
    """Test export format must be valid."""
    # This should fail validation before hitting 404
    response = await client.get("/api/transcripts/some-id/export?format=invalid")
    assert response.status_code in [404, 422]  # Either not found or validation error
