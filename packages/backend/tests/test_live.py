"""Test live transcription endpoints and session management."""

import uuid
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient

from api.routes.live import (
    LiveSession,
    SESSION_TTL_SECONDS,
    _cleanup_expired_sessions,
    active_sessions,
)


# -- Helpers ------------------------------------------------------------------

def _make_session(
    session_id: str | None = None,
    segments: list[dict] | None = None,
    total_duration: float = 10.0,
    disconnected_at: datetime | None = None,
) -> LiveSession:
    """Create a LiveSession for testing."""
    return LiveSession(
        session_id=session_id or str(uuid.uuid4()),
        started_at=datetime.utcnow(),
        segments=segments or [],
        total_duration=total_duration,
        disconnected_at=disconnected_at,
    )


@pytest.fixture(autouse=True)
def _clear_sessions():
    """Ensure active_sessions is clean before and after each test."""
    active_sessions.clear()
    yield
    active_sessions.clear()


# -- LiveSession dataclass tests ---------------------------------------------

def test_live_session_defaults():
    """Test LiveSession initialises with expected defaults."""
    session = _make_session()
    assert session.segments == []
    assert session.audio_chunks == []
    assert session.language == "en"
    assert session.chunk_count == 0
    assert session.high_detail_mode is False
    assert session.disconnected_at is None
    assert isinstance(session.speakers_found, set)


def test_live_session_high_detail():
    """Test LiveSession respects high_detail_mode flag."""
    session = LiveSession(
        session_id="hd-test",
        started_at=datetime.utcnow(),
        high_detail_mode=True,
    )
    assert session.high_detail_mode is True


# -- Session TTL cleanup tests -----------------------------------------------

def test_cleanup_removes_expired_sessions():
    """Expired disconnected sessions should be removed."""
    expired_time = datetime.utcnow() - timedelta(seconds=SESSION_TTL_SECONDS + 60)
    s = _make_session(session_id="expired-1", disconnected_at=expired_time)
    active_sessions[s.session_id] = s

    removed = _cleanup_expired_sessions()
    assert removed == 1
    assert "expired-1" not in active_sessions


def test_cleanup_keeps_recent_sessions():
    """Recently disconnected sessions should NOT be removed."""
    recent_time = datetime.utcnow() - timedelta(seconds=30)
    s = _make_session(session_id="recent-1", disconnected_at=recent_time)
    active_sessions[s.session_id] = s

    removed = _cleanup_expired_sessions()
    assert removed == 0
    assert "recent-1" in active_sessions


def test_cleanup_keeps_active_sessions():
    """Sessions without disconnected_at (still connected) should NOT be removed."""
    s = _make_session(session_id="active-1")
    active_sessions[s.session_id] = s

    removed = _cleanup_expired_sessions()
    assert removed == 0
    assert "active-1" in active_sessions


def test_cleanup_mixed_sessions():
    """Only expired sessions should be removed from a mixed set."""
    expired = _make_session(
        session_id="old",
        disconnected_at=datetime.utcnow() - timedelta(seconds=SESSION_TTL_SECONDS + 1),
    )
    active = _make_session(session_id="alive")
    recent = _make_session(
        session_id="recent",
        disconnected_at=datetime.utcnow() - timedelta(seconds=60),
    )

    active_sessions[expired.session_id] = expired
    active_sessions[active.session_id] = active
    active_sessions[recent.session_id] = recent

    removed = _cleanup_expired_sessions()
    assert removed == 1
    assert "old" not in active_sessions
    assert "alive" in active_sessions
    assert "recent" in active_sessions


def test_cleanup_empty_dict():
    """Cleanup with no sessions should return 0."""
    assert _cleanup_expired_sessions() == 0


# -- REST endpoint tests: /api/live/autosave ----------------------------------

@pytest.mark.asyncio
async def test_autosave_existing_session(client: AsyncClient):
    """Autosave should return segment count and duration for active sessions."""
    s = _make_session(
        session_id="autosave-test",
        segments=[{"text": "hello", "start": 0, "end": 1.5}],
        total_duration=1.5,
    )
    active_sessions[s.session_id] = s

    response = await client.post(
        "/api/live/autosave",
        json={"session_id": "autosave-test"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["saved_segments"] == 1
    assert data["total_duration"] == 1.5


@pytest.mark.asyncio
async def test_autosave_unknown_session(client: AsyncClient):
    """Autosave for an unknown session should return 404."""
    response = await client.post(
        "/api/live/autosave",
        json={"session_id": "nonexistent"},
    )
    assert response.status_code == 404


# -- REST endpoint tests: /api/live/session/{id} (discard) --------------------

@pytest.mark.asyncio
async def test_discard_session(client: AsyncClient):
    """Discarding an active session should remove it from memory."""
    s = _make_session(session_id="discard-test")
    active_sessions[s.session_id] = s

    response = await client.delete("/api/live/session/discard-test")
    assert response.status_code == 200
    assert "discard-test" not in active_sessions


@pytest.mark.asyncio
async def test_discard_session_not_found(client: AsyncClient):
    """Discarding a non-existent session should return 404."""
    response = await client.delete("/api/live/session/nonexistent")
    assert response.status_code == 404


# -- REST endpoint tests: /api/live/save --------------------------------------

@pytest.mark.asyncio
async def test_save_session(client: AsyncClient):
    """Saving a session should create a recording and transcript."""
    s = _make_session(
        session_id="save-test",
        segments=[
            {
                "text": "Hello world",
                "start": 0.0,
                "end": 1.5,
                "speaker": None,
                "confidence": 0.95,
                "edited": False,
            },
        ],
        total_duration=1.5,
    )
    active_sessions[s.session_id] = s

    response = await client.post(
        "/api/live/save",
        json={
            "session_id": "save-test",
            "title": "Test Live Recording",
            "save_audio": False,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "recording_id" in data
    assert "transcript_id" in data
    assert "1 segments" in data["message"]

    # Session should be removed from memory after save
    assert "save-test" not in active_sessions


@pytest.mark.asyncio
async def test_save_session_with_metadata(client: AsyncClient):
    """Saving with project, tags, and description should succeed."""
    # First create a project for association
    proj_response = await client.post(
        "/api/projects",
        json={"name": "Live Test Project"},
    )
    project_id = proj_response.json()["id"]

    s = _make_session(
        session_id="save-meta-test",
        segments=[
            {
                "text": "Segment one",
                "start": 0.0,
                "end": 1.0,
                "speaker": "SPEAKER_00",
                "confidence": 0.9,
                "edited": False,
            },
            {
                "text": "Segment two",
                "start": 1.0,
                "end": 2.5,
                "speaker": "SPEAKER_01",
                "confidence": 0.85,
                "edited": True,
            },
        ],
        total_duration=2.5,
    )
    s.speakers_found = {"SPEAKER_00", "SPEAKER_01"}
    active_sessions[s.session_id] = s

    response = await client.post(
        "/api/live/save",
        json={
            "session_id": "save-meta-test",
            "title": "Meeting Notes",
            "save_audio": False,
            "project_id": project_id,
            "tags": ["meeting", "important"],
            "description": "Weekly sync meeting notes",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "recording_id" in data
    assert "2 segments" in data["message"]


@pytest.mark.asyncio
async def test_save_session_not_found(client: AsyncClient):
    """Saving a non-existent session should return 404."""
    response = await client.post(
        "/api/live/save",
        json={
            "session_id": "nonexistent",
            "title": "Nope",
            "save_audio": False,
        },
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_save_session_empty_segments(client: AsyncClient):
    """Saving a session with no segments should still succeed."""
    s = _make_session(session_id="empty-save", segments=[], total_duration=0.0)
    active_sessions[s.session_id] = s

    response = await client.post(
        "/api/live/save",
        json={
            "session_id": "empty-save",
            "title": "Empty Recording",
            "save_audio": False,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "0 segments" in data["message"]
