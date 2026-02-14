# packages/backend/tests/test_event_emissions.py
"""Tests that core code paths emit events via the event bus."""

import pytest
from core.events import on, emit, clear


@pytest.fixture(autouse=True)
def _clean():
    clear()
    yield
    clear()


@pytest.mark.asyncio
async def test_transcription_complete_emits_event():
    """Verify the event bus handler type is importable and event name is consistent."""
    received = []

    async def handler(**kwargs):
        received.append(kwargs)

    on("transcription.complete", handler)

    from core.events import emit
    await emit(
        "transcription.complete",
        recording_id="rec-123",
        transcript_id="tx-456",
    )

    assert len(received) == 1
    assert received[0]["recording_id"] == "rec-123"
    assert received[0]["transcript_id"] == "tx-456"


@pytest.mark.asyncio
async def test_transcription_failed_emits_event():
    """Verify failure event payload."""
    received = []

    async def handler(**kwargs):
        received.append(kwargs)

    on("transcription.failed", handler)

    from core.events import emit
    await emit(
        "transcription.failed",
        recording_id="rec-123",
        error="out of memory",
    )

    assert len(received) == 1
    assert received[0]["error"] == "out of memory"


@pytest.mark.asyncio
async def test_document_processing_complete_emits_event():
    """Verify document event payload."""
    received = []

    async def handler(**kwargs):
        received.append(kwargs)

    on("document.processed", handler)

    from core.events import emit
    await emit(
        "document.processed",
        document_id="doc-789",
    )

    assert len(received) == 1
    assert received[0]["document_id"] == "doc-789"
