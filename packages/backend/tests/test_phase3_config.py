"""Test Phase 3: Config/Status endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_config_status(client: AsyncClient):
    """Test config status endpoint returns expected structure."""
    response = await client.get("/api/config/status")
    assert response.status_code == 200
    data = response.json()

    # Check top-level fields
    assert "mode" in data
    assert "whisperx" in data
    assert "ai" in data


@pytest.mark.asyncio
async def test_config_status_whisperx(client: AsyncClient):
    """Test config status includes WhisperX configuration."""
    response = await client.get("/api/config/status")
    assert response.status_code == 200
    data = response.json()

    whisperx = data["whisperx"]
    assert "mode" in whisperx
    assert whisperx["mode"] in ["local", "external"]
    assert "model" in whisperx
    assert "device" in whisperx
    assert "compute_type" in whisperx


@pytest.mark.asyncio
async def test_config_status_ai(client: AsyncClient):
    """Test config status includes AI configuration."""
    response = await client.get("/api/config/status")
    assert response.status_code == 200
    data = response.json()

    ai = data["ai"]
    assert "model_path" in ai
    assert "context_size" in ai
    assert "gpu_layers" in ai
