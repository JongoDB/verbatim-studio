"""Plugin system for Verbatim Studio.

Plugins are Python packages that declare a `verbatim.plugins` entry point.
They register routes, middleware, event handlers, models, and frontend metadata
via the PluginRegistry at startup.

See docs/architecture/plugin-system-design.md for the full design.
"""

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine, Protocol, runtime_checkable

from fastapi import APIRouter, FastAPI

logger = logging.getLogger(__name__)

# Type aliases
EventHandler = Callable[..., Coroutine[Any, Any, None]]
JobHandler = Callable[..., Coroutine[Any, Any, Any]]


@runtime_checkable
class VerbatimPlugin(Protocol):
    """Protocol that all Verbatim plugins must implement."""

    name: str
    version: str

    def register(self, registry: "PluginRegistry") -> None:
        """Called once at startup. Register all hooks, routes, models, etc."""
        ...


@dataclass
class NavItem:
    key: str
    label: str
    icon: str
    position: str = "main"  # "main" | "bottom"


@dataclass
class SettingsTab:
    id: str
    label: str
    icon: str


@dataclass
class PluginRegistry:
    """Collects plugin registrations and applies them to the app."""

    # Backend
    _routers: list[tuple[APIRouter, dict]] = field(default_factory=list)
    _middleware: list[tuple[type, dict]] = field(default_factory=list)
    _event_handlers: dict[str, list[EventHandler]] = field(default_factory=dict)
    _models: list[type] = field(default_factory=list)
    _job_handlers: dict[str, JobHandler] = field(default_factory=dict)
    _adapters: dict[str, dict] = field(default_factory=dict)

    # Frontend metadata (served via /api/plugins/manifest)
    _frontend_routes: list[str] = field(default_factory=list)
    _frontend_nav_items: list[NavItem] = field(default_factory=list)
    _frontend_settings_tabs: list[SettingsTab] = field(default_factory=list)
    _frontend_slots: dict[str, str] = field(default_factory=dict)

    # --- Registration methods (called by plugins) ---

    def add_router(self, router: APIRouter, **kwargs) -> None:
        self._routers.append((router, kwargs))

    def add_middleware(self, middleware_class: type, **kwargs) -> None:
        self._middleware.append((middleware_class, kwargs))

    def on(self, event_name: str, handler: EventHandler) -> None:
        self._event_handlers.setdefault(event_name, []).append(handler)
        # Also register with the global event bus
        from core.events import on as bus_on

        bus_on(event_name, handler)

    def add_models(self, models: list[type]) -> None:
        self._models.extend(models)

    def add_job_handler(self, job_type: str, handler: JobHandler) -> None:
        self._job_handlers[job_type] = handler

    def add_adapter(self, interface: str, name: str, adapter_class: type) -> None:
        self._adapters.setdefault(interface, {})[name] = adapter_class

    def add_frontend_routes(self, routes: list[str]) -> None:
        self._frontend_routes.extend(routes)

    def add_frontend_nav_items(self, items: list[dict]) -> None:
        self._frontend_nav_items.extend(NavItem(**item) for item in items)

    def add_frontend_settings_tab(self, tab: dict) -> None:
        self._frontend_settings_tabs.append(SettingsTab(**tab))

    def add_frontend_slots(self, slots: dict[str, str]) -> None:
        self._frontend_slots.update(slots)

    # --- Application methods (called by core at startup) ---

    def apply_to_app(self, app: FastAPI) -> None:
        """Mount all registered routers and middleware onto the FastAPI app."""
        for router, kwargs in self._routers:
            app.include_router(router, **kwargs)
            logger.info("Plugin router mounted: %s", kwargs.get("prefix", "/"))

        for middleware_class, kwargs in reversed(self._middleware):
            app.add_middleware(middleware_class, **kwargs)
            logger.info("Plugin middleware added: %s", middleware_class.__name__)

    def apply_job_handlers(self, job_queue) -> None:
        """Register plugin job handlers with the job queue."""
        for job_type, handler in self._job_handlers.items():
            job_queue.register_handler(job_type, handler)
            logger.info("Plugin job handler registered: %s", job_type)

    def get_frontend_manifest(self) -> dict:
        """Return frontend extension metadata for the /api/plugins/manifest endpoint."""
        return {
            "routes": self._frontend_routes,
            "nav_items": [
                {"key": i.key, "label": i.label, "icon": i.icon, "position": i.position}
                for i in self._frontend_nav_items
            ],
            "settings_tabs": [
                {"id": t.id, "label": t.label, "icon": t.icon}
                for t in self._frontend_settings_tabs
            ],
            "slots": self._frontend_slots,
        }
