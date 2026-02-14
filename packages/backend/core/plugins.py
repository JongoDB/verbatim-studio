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
    _adapters: dict[str, dict[str, type]] = field(default_factory=dict)
    _startup_hooks: list[Callable] = field(default_factory=list)

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

    def add_startup_hook(self, hook: Callable) -> None:
        """Register an async hook to run after plugin loading but before DB init."""
        self._startup_hooks.append(hook)

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

    async def run_startup_hooks(self) -> None:
        """Run all registered startup hooks (called before init_db)."""
        for hook in self._startup_hooks:
            try:
                await hook()
            except Exception:
                logger.exception("Startup hook failed: %s", hook)
                raise

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


# --- Plugin discovery and loading ---

from importlib.metadata import entry_points


def discover_plugins() -> list:
    """Discover installed plugins via entry points."""
    plugins = []
    eps = entry_points()

    # Python 3.12+: entry_points() returns a SelectableGroups
    plugin_eps = (
        eps.select(group="verbatim.plugins")
        if hasattr(eps, "select")
        else eps.get("verbatim.plugins", [])
    )

    for ep in plugin_eps:
        try:
            plugin_class = ep.load()
            plugin = plugin_class()
            if isinstance(plugin, VerbatimPlugin):
                plugins.append(plugin)
                logger.info("Discovered plugin: %s v%s", plugin.name, plugin.version)
            else:
                logger.warning(
                    "Plugin %s does not implement VerbatimPlugin protocol", ep.name
                )
        except Exception:
            logger.exception("Failed to load plugin: %s", ep.name)

    return plugins


_registry: PluginRegistry | None = None


def load_plugins() -> PluginRegistry:
    """Discover and register all installed plugins. Returns the registry."""
    global _registry
    _registry = PluginRegistry()

    plugins = discover_plugins()
    for plugin in plugins:
        try:
            plugin.register(_registry)
            logger.info("Plugin registered: %s", plugin.name)
        except Exception:
            logger.exception("Failed to register plugin: %s", plugin.name)

    return _registry


def get_registry() -> PluginRegistry:
    """Get the global plugin registry. Must call load_plugins() first."""
    if _registry is None:
        raise RuntimeError("Plugins not loaded. Call load_plugins() first.")
    return _registry
