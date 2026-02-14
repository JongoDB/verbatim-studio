# Plugin System Design

> **Status**: Design phase
> **Depends on**: [Enterprise Strategy](./enterprise-strategy.md)
> **Goal**: Define extension points that let both community plugins and the closed-source
> enterprise package hook into Verbatim Studio without modifying core code.

## Design Principles

1. **Build on existing patterns** — The codebase already has `JobQueue.register_handler()`,
   `storage.factory.register_adapter()`, and clean ABC interfaces. Extend these, don't replace.
2. **Zero enterprise references in core** — The open source repo never imports, references, or
   conditionally checks for enterprise code. It just provides hooks.
3. **Convention over configuration** — Plugins are Python packages with a known entry point.
   Discovery is automatic via `importlib.metadata`.
4. **Minimal core changes** — Convert hardcoded registrations to dynamic ones. Don't rewrite
   the entire app.

---

## Plugin Manifest

A plugin is a Python package that declares a `verbatim.plugins` entry point in its
`pyproject.toml`:

```toml
# verbatim-enterprise/pyproject.toml
[project]
name = "verbatim-enterprise"
version = "1.0.0"
dependencies = ["verbatim-backend>=0.43.0"]

[project.entry-points."verbatim.plugins"]
enterprise = "verbatim_enterprise.plugin:EnterprisePlugin"
```

The plugin class implements the `VerbatimPlugin` protocol:

```python
# packages/backend/core/plugins.py (NEW — in open source core)

from typing import Protocol, runtime_checkable

@runtime_checkable
class VerbatimPlugin(Protocol):
    """Protocol that all Verbatim plugins must implement."""

    name: str
    version: str

    def register(self, registry: "PluginRegistry") -> None:
        """Called once at startup. Register all hooks, routes, models, etc."""
        ...
```

Example plugin implementation:

```python
# verbatim_enterprise/plugin.py (in private enterprise repo)

from verbatim.core.plugins import VerbatimPlugin, PluginRegistry

class EnterprisePlugin:
    name = "verbatim-enterprise"
    version = "1.0.0"

    def register(self, registry: PluginRegistry) -> None:
        # Routes
        from .routes import admin_router, teams_router, api_keys_router
        registry.add_router(admin_router, prefix="/api/admin", tags=["admin"])
        registry.add_router(teams_router, prefix="/api/teams", tags=["teams"])
        registry.add_router(api_keys_router, prefix="/api/v1", tags=["api"])

        # Middleware
        from .middleware import AuditLogMiddleware, LicenseCheckMiddleware
        registry.add_middleware(AuditLogMiddleware)
        registry.add_middleware(LicenseCheckMiddleware)

        # Event handlers
        registry.on("transcription.complete", self._on_transcription_complete)
        registry.on("document.uploaded", self._on_document_uploaded)

        # Database models (auto-created via Base.metadata.create_all)
        from .models import Team, TeamMember, ApiKey, AuditLog, License
        registry.add_models([Team, TeamMember, ApiKey, AuditLog, License])

        # Job handlers
        from .jobs import handle_webhook_dispatch
        registry.add_job_handler("webhook_dispatch", handle_webhook_dispatch)

        # Frontend extensions
        registry.add_frontend_routes(["/admin", "/teams", "/api-keys"])
        registry.add_frontend_nav_items([
            {"key": "admin", "label": "Admin", "icon": "shield", "position": "bottom"},
            {"key": "teams", "label": "Teams", "icon": "users", "position": "main"},
        ])
        registry.add_frontend_settings_tab({
            "id": "enterprise",
            "label": "Enterprise",
            "icon": "building",
        })
        registry.add_frontend_slots({
            "sidebar.bottom": "AdminNavItems",
            "transcript.toolbar": "EnterpriseTranscriptActions",
            "settings.enterprise": "EnterpriseSettingsPanel",
        })

    async def _on_transcription_complete(self, event):
        """Dispatch webhooks when transcription finishes."""
        ...

    async def _on_document_uploaded(self, event):
        """Log document upload for audit trail."""
        ...
```

---

## Plugin Registry

The `PluginRegistry` is the single object plugins interact with. It collects registrations
during startup and applies them to the FastAPI app.

```python
# packages/backend/core/plugins.py

import logging
from dataclasses import dataclass, field
from importlib.metadata import entry_points
from typing import Any, Callable, Coroutine

from fastapi import APIRouter, FastAPI

logger = logging.getLogger(__name__)

# Type aliases
EventHandler = Callable[..., Coroutine[Any, Any, None]]
JobHandler = Callable[..., Coroutine[Any, Any, Any]]


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
    _middleware: list[type] = field(default_factory=list)
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

        # Middleware is applied in reverse order (last added = outermost)
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
                {"key": item.key, "label": item.label, "icon": item.icon, "position": item.position}
                for item in self._frontend_nav_items
            ],
            "settings_tabs": [
                {"id": tab.id, "label": tab.label, "icon": tab.icon}
                for tab in self._frontend_settings_tabs
            ],
            "slots": self._frontend_slots,
        }


# --- Plugin discovery and loading ---

def discover_plugins() -> list:
    """Discover installed plugins via entry points."""
    plugins = []
    eps = entry_points()

    # Python 3.12+: entry_points() returns a SelectableGroups
    plugin_eps = eps.select(group="verbatim.plugins") if hasattr(eps, "select") else eps.get("verbatim.plugins", [])

    for ep in plugin_eps:
        try:
            plugin_class = ep.load()
            plugin = plugin_class()
            if isinstance(plugin, VerbatimPlugin):
                plugins.append(plugin)
                logger.info("Discovered plugin: %s v%s", plugin.name, plugin.version)
            else:
                logger.warning("Plugin %s does not implement VerbatimPlugin protocol", ep.name)
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
    """Get the global plugin registry (must call load_plugins first)."""
    if _registry is None:
        raise RuntimeError("Plugins not loaded. Call load_plugins() first.")
    return _registry
```

---

## Event Bus

A lightweight async event bus for backend-to-backend communication.
Plugins subscribe in `register()`, core code emits events at key moments.

```python
# packages/backend/core/events.py (NEW)

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
    handlers = _handlers.get(event_name, [])
    for handler in handlers:
        try:
            await handler(**kwargs)
        except Exception:
            logger.exception("Event handler failed for %s", event_name)


def clear() -> None:
    """Clear all handlers (for testing)."""
    _handlers.clear()
```

### Core events emitted (added to existing code):

| Event | Emitted from | Payload |
|-------|-------------|---------|
| `transcription.started` | `services/jobs.py` | `recording_id`, `job_id` |
| `transcription.complete` | `services/jobs.py` | `recording_id`, `transcript_id`, `job_id` |
| `transcription.failed` | `services/jobs.py` | `recording_id`, `job_id`, `error` |
| `document.uploaded` | `api/routes/documents.py` | `document_id`, `filename`, `project_id` |
| `document.ocr_complete` | `services/jobs.py` | `document_id`, `text_length` |
| `recording.created` | `api/routes/recordings.py` | `recording_id`, `project_id` |
| `recording.deleted` | `api/routes/recordings.py` | `recording_id` |
| `project.created` | `api/routes/projects.py` | `project_id`, `name` |
| `export.complete` | `api/routes/transcripts.py` | `transcript_id`, `format` |
| `ai.chat.message` | `api/routes/conversations.py` | `conversation_id`, `message` |

Plugins subscribe in their `register()` method:

```python
def register(self, registry):
    registry.on("transcription.complete", self.dispatch_webhooks)
    registry.on("recording.created", self.log_audit_event)
```

The registry wires these into the event bus:

```python
# In PluginRegistry
def on(self, event_name: str, handler: EventHandler) -> None:
    self._event_handlers.setdefault(event_name, []).append(handler)
    # Also register with the global event bus
    from core.events import on as bus_on
    bus_on(event_name, handler)
```

---

## Changes Required to Core Codebase

### Backend changes

**1. `api/main.py` — Load plugins at startup**

Current startup:
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # ... start services
    yield
    # ... cleanup
```

New startup (add 3 lines):
```python
from core.plugins import load_plugins

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load plugins before DB init (so plugin models get created)
    registry = load_plugins()

    await init_db()

    # Apply plugin registrations
    registry.apply_to_app(app)
    registry.apply_job_handlers(job_queue)

    # ... rest of existing startup
    yield
    # ... cleanup
```

**2. `api/main.py` — Add plugin manifest endpoint**

```python
@app.get("/api/plugins/manifest")
async def get_plugin_manifest():
    from core.plugins import get_registry
    return get_registry().get_frontend_manifest()
```

**3. `services/jobs.py` — Emit events at key points**

After transcription completes (around line 489):
```python
from core.events import emit
await emit("transcription.complete",
    recording_id=recording_id,
    transcript_id=transcript_id,
    job_id=job_id)
```

Similar `emit()` calls added to other key moments listed in the events table above.

**4. `persistence/database.py` — No changes needed**

Plugin models that inherit from the same `Base` class will be auto-created by
`Base.metadata.create_all()` — this already runs at startup in `init_db()`.
The only requirement is that the plugin's models module is imported before
`init_db()` runs, which is guaranteed because `load_plugins()` → `register()`
imports the models.

### Frontend changes

**5. `app/App.tsx` — Fetch plugin manifest, extend navigation**

```typescript
// Fetch plugin manifest on startup
const [pluginManifest, setPluginManifest] = useState<PluginManifest | null>(null);

useEffect(() => {
  api.plugins.manifest().then(setPluginManifest).catch(() => {});
}, []);
```

The manifest tells the frontend what nav items, routes, and settings tabs exist.
Plugin pages are loaded via dynamic `<iframe>` or a plugin-specific React micro-frontend
pattern (details in Frontend Plugin UI section below).

**6. `components/layout/Sidebar.tsx` — Dynamic nav items**

Convert `NAV_ITEMS` from a hardcoded array to a base array + plugin items:

```typescript
const BASE_NAV_ITEMS = [ /* existing items */ ];

// Merge plugin nav items from manifest
const navItems = useMemo(() => {
  if (!pluginManifest?.nav_items?.length) return BASE_NAV_ITEMS;
  const pluginItems = pluginManifest.nav_items.map(item => ({
    key: item.key,
    label: item.label,
    icon: ICON_MAP[item.icon] || DefaultIcon,
  }));
  return [...BASE_NAV_ITEMS, ...pluginItems];
}, [pluginManifest]);
```

**7. `pages/settings/SettingsPage.tsx` — Dynamic settings tabs**

Same pattern — base tabs + plugin tabs from manifest.

---

## Frontend Plugin UI

Two approaches for rendering plugin UI in the frontend:

### Option A: Backend-served HTML (Recommended for v1)

Plugin pages are served by the plugin's own FastAPI routes as HTML/JS bundles.
The core frontend renders them in an iframe or web component:

```tsx
// For plugin routes like /admin, /teams
{navigation.type === 'plugin' && (
  <iframe
    src={`${apiUrl}/plugins/${navigation.pluginRoute}`}
    className="w-full h-full border-0"
  />
)}
```

**Pros**: Complete isolation, plugin can use any framework, no build system coupling.
**Cons**: iframe feels slightly disconnected, theme sync requires messaging.

### Option B: React micro-frontends (Better UX, more complex)

Plugin ships a pre-built React bundle. The core frontend dynamically loads it:

```tsx
// Plugin manifest includes a JS bundle URL
const PluginComponent = React.lazy(() =>
  import(/* webpackIgnore: true */ `/api/plugins/${pluginId}/bundle.js`)
);

{navigation.type === 'plugin' && (
  <Suspense fallback={<Loading />}>
    <PluginComponent api={api} theme={theme} />
  </Suspense>
)}
```

**Pros**: Seamless UX, shared theme, shared API client.
**Cons**: Plugin must use React, shared dependencies can conflict.

### Recommendation

Start with **Option A (iframe)** for the initial implementation. It's simpler,
gives plugins full freedom, and can be upgraded to Option B later for specific
high-integration plugins (like the enterprise admin dashboard).

The enterprise package would likely graduate to Option B since it needs deep
integration (shared theme, shared auth state, inline components in transcript view).

---

## Plugin Slots (Component Injection Points)

Named locations in the UI where plugins can inject content:

```tsx
// packages/frontend/src/components/plugins/PluginSlot.tsx (NEW)

interface PluginSlotProps {
  name: string;   // e.g., "sidebar.bottom", "transcript.toolbar"
  context?: any;   // Data passed to the plugin component
}

export function PluginSlot({ name, context }: PluginSlotProps) {
  const manifest = usePluginManifest();
  const slotComponent = manifest?.slots?.[name];

  if (!slotComponent) return null;

  // Render via iframe or dynamic import based on approach chosen
  return <PluginFrame component={slotComponent} context={context} />;
}
```

Used in core components:

```tsx
// In Sidebar.tsx
<nav>
  {navItems.map(item => <NavButton ... />)}
  <PluginSlot name="sidebar.bottom" />
</nav>

// In TranscriptPage.tsx toolbar
<div className="toolbar">
  <ExportButton />
  <PluginSlot name="transcript.toolbar" context={{ transcriptId }} />
</div>

// In SettingsPage.tsx
{activeTab === pluginTabId && (
  <PluginSlot name={`settings.${pluginTabId}`} />
)}
```

### Initial slot locations

| Slot name | Location | Use case |
|-----------|----------|----------|
| `sidebar.bottom` | Bottom of sidebar nav | Admin links, team switcher |
| `sidebar.top` | Above nav items | Team/workspace selector |
| `transcript.toolbar` | Transcript page toolbar | Export to API, share, webhook trigger |
| `transcript.segment.actions` | Per-segment action buttons | Custom annotations, flags |
| `recording.actions` | Recording detail actions | Assign to team, set permissions |
| `settings.{tab_id}` | Custom settings tab content | Enterprise config, API keys, team mgmt |
| `dashboard.widgets` | Dashboard page | Usage stats, team activity, audit feed |
| `header.right` | Right side of header bar | User avatar, team menu, notifications |

---

## Infrastructure Adapters

Enterprise upgrades core infrastructure without removing existing capabilities.
The plugin registry supports adapter registration for swappable services:

```python
def register(self, registry):
    # Database: PostgreSQL for multi-user concurrency (replaces SQLite)
    registry.add_adapter("database", "postgresql", PostgresqlAdapter)

    # Storage: add network options alongside existing local storage
    registry.add_adapter("storage", "s3", S3StorageAdapter)
    registry.add_adapter("storage", "azure_blob", AzureBlobAdapter)

    # LLM: add managed API endpoints alongside local model execution
    registry.add_adapter("llm", "openai_api", OpenAIPassthroughAdapter)
    registry.add_adapter("llm", "anthropic_api", AnthropicPassthroughAdapter)
```

The core codebase already uses abstractions that make this possible:
- **SQLAlchemy** — change the connection string from `sqlite:///` to `postgresql://`
- **Storage factory** — `register_adapter()` already exists in the codebase
- **LLM interfaces** — adapter pattern for different model backends

Enterprise adapters are additive. A server deployment can run local Whisper models
AND accept external LLM API calls. It can use local file storage AND S3. PostgreSQL
replaces SQLite only because multi-user concurrency demands it.

---

## Database Schema Extension

Plugins define SQLAlchemy models that inherit from the same `Base`. Because the core
uses SQLAlchemy (not raw SQL), plugin models work with both SQLite (desktop) and
PostgreSQL (enterprise server):

```python
# verbatim_enterprise/models.py
from persistence.models import Base, generate_uuid
from sqlalchemy import String, ForeignKey, Boolean, JSON, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

class Team(Base):
    __tablename__ = "teams"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=func.now())

class TeamMember(Base):
    __tablename__ = "team_members"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"))
    user_email: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), default="member")

class ApiKey(Base):
    __tablename__ = "api_keys"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"))
    scopes: Mapped[dict] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())

class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"))
    user_email: Mapped[str] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(50))
    resource_id: Mapped[str] = mapped_column(String(36))
    metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
```

These tables are auto-created by `Base.metadata.create_all()` at startup.
Plugin models are imported during `plugin.register()`, which runs before `init_db()`.

For migrations (schema changes in plugin updates), plugins register their own
migration functions:

```python
def register(self, registry):
    from .migrations import migrate_v1_1
    registry.add_migration("enterprise-v1.1", migrate_v1_1)
```

---

## Implementation Order

### Phase 1: Backend Plugin Infrastructure (open source)
1. Create `core/plugins.py` — PluginRegistry, discovery, loading
2. Create `core/events.py` — Lightweight async event bus
3. Modify `api/main.py` — Load plugins at startup, apply to app
4. Add `GET /api/plugins/manifest` endpoint
5. Add `emit()` calls to key code paths (transcription, documents, recordings)

### Phase 2: Frontend Plugin Infrastructure (open source)
6. Create `PluginSlot` component
7. Create `usePluginManifest()` hook (fetches `/api/plugins/manifest`)
8. Convert `NAV_ITEMS` in Sidebar.tsx to dynamic (base + plugin items)
9. Convert `TABS` in SettingsPage.tsx to dynamic
10. Add `NavigationState` type: `| { type: 'plugin'; pluginRoute: string }`
11. Add plugin page rendering (iframe or dynamic import)

### Phase 3: Enterprise Package (private repo)
12. Create `verbatim-enterprise` package with pyproject.toml entry point
13. Infrastructure adapters: PostgreSQL, network storage, LLM API passthrough
14. Implement auth + RBAC middleware
15. Implement team models + routes + workspaces
16. Implement API key management + routes
17. Implement audit logging middleware + dashboard
18. Implement license validation
19. Server deployment config (Docker, reverse proxy, no Electron)

### Phase 4: Meeting Bot Service (separate repo)
20. Bot orchestration service
21. Platform SDK integrations (Teams, Zoom, Meet)
22. API integration with Verbatim (via enterprise API layer)

---

## Deployment Models

### Desktop (Open Source)
Electron wraps the frontend + backend. Models are bundled, SQLite is the database,
storage is local. No auth needed (single user). This is unchanged by the plugin system.

### Enterprise (Server)
No Electron. The FastAPI backend runs as a server process (Docker, systemd, K8s).
The React frontend is served via reverse proxy (nginx, Caddy) or built into a static
bundle. `pip install verbatim-enterprise` registers infrastructure upgrades and team
features via the plugin system.

All core features work identically — enterprise adds multi-user capabilities and
infrastructure options, it never removes functionality.

---

## What Does NOT Change

- Core transcription, OCR, search, export — unchanged
- Existing frontend pages and components — unchanged (just add PluginSlots)
- Database schema for core models — unchanged
- Electron packaging — unchanged (desktop product is not affected)
- Existing adapter interfaces — unchanged (plugins can register new adapters via registry)
- Local model execution — unchanged (enterprise can also run models locally on server)
- All existing storage types — unchanged (enterprise adds more options)

The plugin system is purely additive. No existing functionality is removed or modified
in behavior. The only structural changes are converting hardcoded arrays to dynamic
(NAV_ITEMS, TABS) and adding the plugin loading call in main.py startup.
