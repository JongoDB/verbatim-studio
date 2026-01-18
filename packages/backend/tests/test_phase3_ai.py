"""Test Phase 3: AI endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_ai_status(client: AsyncClient):
    """Test AI status endpoint returns expected structure."""
    response = await client.get("/api/ai/status")
    assert response.status_code == 200
    data = response.json()

    assert "available" in data
    assert "provider" in data
    assert "model_loaded" in data
    assert "model_path" in data
    assert "models" in data


@pytest.mark.asyncio
async def test_ai_chat_requires_message(client: AsyncClient):
    """Test AI chat endpoint requires message."""
    response = await client.post("/api/ai/chat", json={})
    assert response.status_code == 422  # Validation error


@pytest.mark.asyncio
async def test_ai_summarize_transcript_not_found(client: AsyncClient):
    """Test summarize endpoint with non-existent transcript.

    Returns 503 if AI service unavailable, 404 if transcript not found.
    """
    response = await client.post("/api/ai/transcripts/nonexistent-id/summarize")
    # 503 = AI service unavailable (valid), 404 = transcript not found
    assert response.status_code in [404, 503]


@pytest.mark.asyncio
async def test_ai_analyze_transcript_not_found(client: AsyncClient):
    """Test analyze endpoint with non-existent transcript.

    Returns 503 if AI service unavailable, 404 if transcript not found.
    """
    response = await client.post(
        "/api/ai/transcripts/nonexistent-id/analyze?analysis_type=sentiment"
    )
    # 503 = AI service unavailable (valid), 404 = transcript not found
    assert response.status_code in [404, 503]


@pytest.mark.asyncio
async def test_ai_analyze_invalid_type(client: AsyncClient):
    """Test analyze endpoint with invalid analysis type."""
    response = await client.post(
        "/api/ai/transcripts/some-id/analyze?analysis_type=invalid"
    )
    # Should be validation error, not found, or service unavailable
    assert response.status_code in [404, 422, 503]


@pytest.mark.asyncio
async def test_ai_ask_transcript_not_found(client: AsyncClient):
    """Test ask endpoint with non-existent transcript.

    Returns 503 if AI service unavailable, 404 if transcript not found.
    """
    response = await client.post(
        "/api/ai/transcripts/nonexistent-id/ask?question=What+is+this+about"
    )
    # 503 = AI service unavailable (valid), 404 = transcript not found
    assert response.status_code in [404, 503]
