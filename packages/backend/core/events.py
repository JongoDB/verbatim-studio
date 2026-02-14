"""Lightweight async event bus for plugin integration.

Core code emits events at key moments (transcription complete, document uploaded, etc.).
Plugins subscribe to events in their register() method.

Usage:
    from core.events import on, emit, clear

    async def my_handler(**kwargs):
        print(kwargs)

    on("transcription.complete", my_handler)
    await emit("transcription.complete", transcript_id="abc", recording_id="xyz")
"""

import logging
from typing import Any, Callable, Coroutine

logger = logging.getLogger(__name__)

EventHandler = Callable[..., Coroutine[Any, Any, None]]

_handlers: dict[str, list[EventHandler]] = {}


def on(event_name: str, handler: EventHandler) -> None:
    """Subscribe to an event."""
    _handlers.setdefault(event_name, []).append(handler)


async def emit(event_name: str, **kwargs) -> None:
    """Emit an event to all subscribers. Failures are logged, not raised."""
    for handler in _handlers.get(event_name, []):
        try:
            await handler(**kwargs)
        except Exception:
            logger.exception("Event handler failed for '%s'", event_name)


def clear() -> None:
    """Clear all handlers. Used in tests."""
    _handlers.clear()
