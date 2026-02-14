"""Tests for the plugin registry."""

import pytest
from fastapi import APIRouter, FastAPI
from core.events import clear as clear_events
from core.plugins import PluginRegistry


@pytest.fixture(autouse=True)
def _clean_event_bus():
    """Clean global event bus between tests (PluginRegistry.on() writes to it)."""
    clear_events()
    yield
    clear_events()


@pytest.fixture
def registry():
    return PluginRegistry()


def test_add_router(registry):
    """Routers are collected and can be applied to a FastAPI app."""
    router = APIRouter()

    @router.get("/test")
    async def test_route():
        return {"ok": True}

    registry.add_router(router, prefix="/api/test", tags=["test"])
    assert len(registry._routers) == 1


def test_apply_routers_to_app(registry):
    """apply_to_app() mounts registered routers on the FastAPI app."""
    router = APIRouter()

    @router.get("/hello")
    async def hello():
        return {"hello": "world"}

    registry.add_router(router, prefix="/api/test")

    app = FastAPI()
    registry.apply_to_app(app)

    # Verify route was mounted
    routes = [r.path for r in app.routes if hasattr(r, "path")]
    assert "/api/test/hello" in routes


def test_add_event_handler(registry):
    """Event handlers are registered with the event bus."""
    async def handler(**kwargs):
        pass

    registry.on("test.event", handler)
    assert "test.event" in registry._event_handlers
    assert handler in registry._event_handlers["test.event"]


def test_add_job_handler(registry):
    """Job handlers are collected."""
    async def handler(job):
        pass

    registry.add_job_handler("webhook_dispatch", handler)
    assert registry._job_handlers["webhook_dispatch"] is handler


def test_add_adapter(registry):
    """Adapters are collected by interface and name."""

    class FakeAdapter:
        pass

    registry.add_adapter("storage", "s3", FakeAdapter)
    assert registry._adapters["storage"]["s3"] is FakeAdapter


def test_add_models(registry):
    """Models are collected."""

    class FakeModel:
        pass

    registry.add_models([FakeModel])
    assert FakeModel in registry._models


def test_frontend_manifest_empty(registry):
    """Empty registry returns empty manifest."""
    manifest = registry.get_frontend_manifest()
    assert manifest == {
        "routes": [],
        "nav_items": [],
        "settings_tabs": [],
        "slots": {},
    }


def test_frontend_manifest_populated(registry):
    """Frontend metadata is correctly serialized."""
    registry.add_frontend_routes(["/admin", "/teams"])
    registry.add_frontend_nav_items([
        {"key": "admin", "label": "Admin", "icon": "shield", "position": "bottom"},
    ])
    registry.add_frontend_settings_tab({"id": "enterprise", "label": "Enterprise", "icon": "building"})
    registry.add_frontend_slots({"sidebar.bottom": "AdminNav"})

    manifest = registry.get_frontend_manifest()
    assert manifest["routes"] == ["/admin", "/teams"]
    assert len(manifest["nav_items"]) == 1
    assert manifest["nav_items"][0]["key"] == "admin"
    assert manifest["settings_tabs"][0]["id"] == "enterprise"
    assert manifest["slots"]["sidebar.bottom"] == "AdminNav"


def test_add_middleware(registry):
    """Middleware classes are collected."""

    class FakeMiddleware:
        pass

    registry.add_middleware(FakeMiddleware, some_arg="value")
    assert len(registry._middleware) == 1


from unittest.mock import MagicMock, patch
from core.plugins import discover_plugins, load_plugins, get_registry


class FakePlugin:
    """A test plugin that implements the VerbatimPlugin protocol."""
    name = "test-plugin"
    version = "0.1.0"

    def register(self, registry):
        registry.add_frontend_routes(["/fake"])


def test_discover_plugins_with_entry_points():
    """discover_plugins() loads plugins from entry points."""
    mock_ep = MagicMock()
    mock_ep.name = "test"
    mock_ep.load.return_value = FakePlugin

    with patch("core.plugins.entry_points") as mock_eps:
        mock_result = MagicMock()
        mock_result.select.return_value = [mock_ep]
        mock_eps.return_value = mock_result

        plugins = discover_plugins()

    assert len(plugins) == 1
    assert plugins[0].name == "test-plugin"


def test_discover_plugins_skips_invalid():
    """discover_plugins() skips plugins that fail to load."""
    mock_ep = MagicMock()
    mock_ep.name = "broken"
    mock_ep.load.side_effect = ImportError("missing dep")

    with patch("core.plugins.entry_points") as mock_eps:
        mock_result = MagicMock()
        mock_result.select.return_value = [mock_ep]
        mock_eps.return_value = mock_result

        plugins = discover_plugins()

    assert len(plugins) == 0


def test_load_plugins_returns_registry():
    """load_plugins() returns a PluginRegistry with all plugins registered."""
    with patch("core.plugins.discover_plugins", return_value=[FakePlugin()]):
        registry = load_plugins()

    assert registry.get_frontend_manifest()["routes"] == ["/fake"]


def test_get_registry_before_load_raises():
    """get_registry() raises if load_plugins() hasn't been called."""
    import core.plugins as mod
    mod._registry = None  # reset

    with pytest.raises(RuntimeError, match="Plugins not loaded"):
        get_registry()


def test_get_registry_after_load():
    """get_registry() returns the registry after load_plugins()."""
    with patch("core.plugins.discover_plugins", return_value=[]):
        load_plugins()

    registry = get_registry()
    assert registry is not None


import pytest_asyncio
from httpx import ASGITransport, AsyncClient


@pytest_asyncio.fixture
async def api_client():
    """Create a test client for the FastAPI app."""
    from api.main import app
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client


@pytest.mark.asyncio
async def test_manifest_endpoint(api_client):
    """GET /api/plugins/manifest returns plugin metadata."""
    resp = await api_client.get("/api/plugins/manifest")
    assert resp.status_code == 200
    data = resp.json()
    assert "routes" in data
    assert "nav_items" in data
    assert "settings_tabs" in data
    assert "slots" in data
