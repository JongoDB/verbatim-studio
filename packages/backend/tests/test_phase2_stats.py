"""Test Phase 2: Stats/Dashboard endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_dashboard_stats(client: AsyncClient):
    """Test dashboard stats endpoint returns expected structure."""
    response = await client.get("/api/stats")
    assert response.status_code == 200
    data = response.json()

    # Check recordings stats
    assert "recordings" in data
    recordings = data["recordings"]
    assert "total_recordings" in recordings
    assert "total_duration_seconds" in recordings
    assert "by_status" in recordings
    assert "avg_duration_seconds" in recordings

    # Check transcriptions stats
    assert "transcriptions" in data
    transcriptions = data["transcriptions"]
    assert "total_transcripts" in transcriptions
    assert "total_segments" in transcriptions
    assert "total_words" in transcriptions
    assert "languages" in transcriptions


@pytest.mark.asyncio
async def test_dashboard_stats_empty_db(client: AsyncClient):
    """Test dashboard stats with empty database."""
    response = await client.get("/api/stats")
    assert response.status_code == 200
    data = response.json()

    assert data["recordings"]["total_recordings"] == 0
    assert data["recordings"]["total_duration_seconds"] == 0
    assert data["transcriptions"]["total_transcripts"] == 0
