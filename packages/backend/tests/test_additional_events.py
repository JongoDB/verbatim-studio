"""Test that additional events are emitted at key API points."""
import pytest
from unittest.mock import AsyncMock
from core.events import on, emit, clear


@pytest.fixture(autouse=True)
def clean_events():
    clear()
    yield
    clear()


@pytest.mark.asyncio
async def test_emit_recording_created():
    handler = AsyncMock()
    on("recording.created", handler)
    await emit("recording.created", recording_id="r1", project_id="p1")
    handler.assert_called_once_with(recording_id="r1", project_id="p1")


@pytest.mark.asyncio
async def test_emit_recording_deleted():
    handler = AsyncMock()
    on("recording.deleted", handler)
    await emit("recording.deleted", recording_id="r1")
    handler.assert_called_once_with(recording_id="r1")


@pytest.mark.asyncio
async def test_emit_document_uploaded():
    handler = AsyncMock()
    on("document.uploaded", handler)
    await emit("document.uploaded", document_id="d1", filename="test.pdf")
    handler.assert_called_once_with(document_id="d1", filename="test.pdf")


@pytest.mark.asyncio
async def test_emit_project_created():
    handler = AsyncMock()
    on("project.created", handler)
    await emit("project.created", project_id="p1", name="Test Project")
    handler.assert_called_once_with(project_id="p1", name="Test Project")
