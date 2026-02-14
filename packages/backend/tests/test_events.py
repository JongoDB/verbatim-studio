"""Tests for the async event bus."""

import pytest
from core.events import on, emit, clear


@pytest.fixture(autouse=True)
def _clean_handlers():
    """Clear all event handlers before and after each test."""
    clear()
    yield
    clear()


@pytest.mark.asyncio
async def test_emit_calls_handler():
    """Subscribed handler receives event kwargs."""
    received = []

    async def handler(**kwargs):
        received.append(kwargs)

    on("test.event", handler)
    await emit("test.event", foo="bar", count=1)

    assert received == [{"foo": "bar", "count": 1}]


@pytest.mark.asyncio
async def test_emit_multiple_handlers():
    """Multiple handlers on same event all get called."""
    calls = []

    async def h1(**kwargs):
        calls.append("h1")

    async def h2(**kwargs):
        calls.append("h2")

    on("test.event", h1)
    on("test.event", h2)
    await emit("test.event")

    assert calls == ["h1", "h2"]


@pytest.mark.asyncio
async def test_emit_no_handlers():
    """Emitting event with no subscribers does not raise."""
    await emit("no.subscribers")  # should not raise


@pytest.mark.asyncio
async def test_handler_error_does_not_propagate():
    """A failing handler does not prevent other handlers or raise."""
    calls = []

    async def bad_handler(**kwargs):
        raise ValueError("boom")

    async def good_handler(**kwargs):
        calls.append("ok")

    on("test.event", bad_handler)
    on("test.event", good_handler)
    await emit("test.event")

    assert calls == ["ok"]


@pytest.mark.asyncio
async def test_clear_removes_all_handlers():
    """clear() removes all registered handlers."""
    called = False

    async def handler(**kwargs):
        nonlocal called
        called = True

    on("test.event", handler)
    clear()
    await emit("test.event")

    assert not called


@pytest.mark.asyncio
async def test_different_events_isolated():
    """Handlers on different events don't interfere."""
    a_calls = []
    b_calls = []

    async def handler_a(**kwargs):
        a_calls.append(1)

    async def handler_b(**kwargs):
        b_calls.append(1)

    on("event.a", handler_a)
    on("event.b", handler_b)
    await emit("event.a")

    assert a_calls == [1]
    assert b_calls == []
