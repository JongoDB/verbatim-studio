"""Tests for the plugin registry."""

import pytest
from fastapi import APIRouter, FastAPI
from core.plugins import PluginRegistry


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
