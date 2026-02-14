# Enterprise Package Design

> **Date**: 2026-02-11
> **Status**: Approved
> **Repo**: `verbatim-studio-enterprise` (private)
> **Depends on**: Plugin system (Phase 1 + 2, shipped in v0.44.0–v0.45.0)

## Goal

Ship `verbatim-enterprise` — a pip-installable Python package that registers enterprise features via the Verbatim plugin system. One `pip install`, one plugin class, full enterprise functionality: PostgreSQL, auth/RBAC, teams, API keys, webhooks, admin dashboard, audit logging, LLM passthrough, and license management.

## Architecture

Single plugin class (`EnterprisePlugin`) with one `register()` method that wires all enterprise features into the core app. No sub-plugins, no feature flags. Install it and everything activates.

The core Verbatim app (open source) provides hooks via the plugin system. The enterprise package attaches to those hooks. Dependency direction is always: `enterprise → depends on → core`. Never the reverse.

## Package Structure

```
verbatim-studio-enterprise/
├── pyproject.toml                  # Entry point: verbatim.plugins
├── verbatim_enterprise/
│   ├── __init__.py
│   ├── plugin.py                   # EnterprisePlugin.register()
│   ├── config.py                   # Enterprise settings (VERBATIM_* env vars)
│   │
│   ├── adapters/
│   │   ├── database.py             # PostgreSQL async adapter
│   │   ├── storage/
│   │   │   ├── s3.py               # S3-compatible storage
│   │   │   └── azure_blob.py       # Azure Blob storage
│   │   └── llm/
│   │       ├── openai.py           # OpenAI API passthrough
│   │       ├── anthropic.py        # Anthropic API passthrough
│   │       └── generic_openai.py   # OpenAI-compatible (Ollama, vLLM, etc.)
│   │
│   ├── auth/
│   │   ├── provider.py             # IAuthProvider implementation
│   │   ├── middleware.py           # JWT validation middleware
│   │   ├── rbac.py                 # Permission checks
│   │   └── passwords.py           # Argon2 hashing
│   │
│   ├── models/
│   │   ├── users.py                # User, Team, TeamMember, Workspace
│   │   ├── api_keys.py            # ApiKey (scoped, hashed)
│   │   └── audit.py               # AuditLog
│   │
│   ├── routes/
│   │   ├── auth.py                 # /api/auth/* (login, register, refresh)
│   │   ├── teams.py               # /api/teams/* (CRUD, members, invites)
│   │   ├── users.py               # /api/users/* (admin user management)
│   │   ├── api_keys.py            # /api/keys/* (create, revoke, list)
│   │   ├── admin.py               # /api/admin/* (dashboard data)
│   │   ├── webhooks.py            # /api/webhooks/* (register, manage)
│   │   └── license.py             # /api/license/* (validate, status)
│   │
│   ├── middleware/
│   │   ├── audit.py               # Logs mutating API calls
│   │   └── license.py             # Validates license on requests
│   │
│   ├── services/
│   │   ├── license.py             # Offline JWT license validation
│   │   ├── webhook.py             # Event → HTTP POST dispatch
│   │   └── invite.py              # Team invitation flow
│   │
│   └── frontend/                   # React micro-frontend (Vite build)
│       ├── package.json
│       ├── vite.config.ts
│       ├── src/
│       │   ├── AdminDashboard.tsx  # User mgmt, audit log, system health
│       │   ├── TeamManagement.tsx  # Team CRUD, member management
│       │   ├── ApiKeyManager.tsx   # API key creation, revocation
│       │   ├── WebhookConfig.tsx   # Webhook registration
│       │   ├── LicenseSettings.tsx # License status, key entry
│       │   └── EnterpriseSettings.tsx # Enterprise settings tab
│       └── dist/                   # Pre-built bundle (served by FastAPI)
│
├── tests/
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml          # Backend + PG + nginx
│   └── nginx.conf
└── scripts/
    └── generate-license.py         # CLI tool for creating license keys
```

## pyproject.toml

```toml
[project]
name = "verbatim-enterprise"
version = "1.0.0"
description = "Enterprise features for Verbatim Studio"
requires-python = ">=3.11"
dependencies = [
    "verbatim-backend>=0.45.0",
    "asyncpg>=0.30.0",
    "python-jose[cryptography]>=3.3.0",
    "argon2-cffi>=23.0.0",
    "boto3>=1.35.0",
    "azure-storage-blob>=12.0.0",
    "openai>=1.0.0",
    "anthropic>=0.40.0",
    "httpx>=0.28.0",
]

[project.entry-points."verbatim.plugins"]
enterprise = "verbatim_enterprise.plugin:EnterprisePlugin"
```

---

## Design Decisions

### 1. Authentication & RBAC

**JWT-based auth.** Login returns:
- Access token (15min TTL, signed with `VERBATIM_SECRET_KEY`)
- Refresh token (7 day TTL, stored hashed in DB)

**Middleware wraps all routes.** Enterprise auth middleware intercepts all `/api/*` requests:
- Validates JWT from `Authorization: Bearer <token>` header
- Injects `User` into `request.state.user`
- Allowlist for unauthenticated endpoints: `/api/health`, `/api/auth/login`, `/api/auth/register`, `/api/plugins/manifest`
- Core routes gain auth enforcement without any code changes

**RBAC via existing framework.** The core already defines `Role` (admin/user/viewer) and `Permission` enums with granular permissions (recording:create, project:delete, admin:manage, etc.). Enterprise uses `User.has_permission()` checks in the middleware layer.

**Team scoping.** Users belong to teams. API requests are scoped to the user's active team — they only see recordings, projects, and documents belonging to their team. Team switching is a header (`X-Team-Id`) or stored in the JWT claims.

### 2. Infrastructure Adapters

**PostgreSQL:**
- Set via `VERBATIM_DATABASE_URL=postgresql+asyncpg://user:pass@host/db`
- Core already uses async SQLAlchemy — just a different connection string
- Enterprise adapter skips SQLite-specific PRAGMAs
- All SQLAlchemy models (core + enterprise) work unchanged

**Storage (S3, Azure Blob):**
- Core has `StorageAdapter` ABC and `register_adapter()` function
- Enterprise registers: `register_adapter("cloud", "s3", S3StorageAdapter)`
- Additive — local storage still available, users get additional options
- Credentials stored encrypted via the existing credential system

**LLM passthrough (OpenAI, Anthropic, generic OpenAI-compatible):**
- Core has `IAIService` interface for chat/summarize/analyze
- Enterprise adds API-based implementations
- Admin-managed: admin configures available endpoints and API keys in enterprise settings, users select from available models
- Local model execution still works alongside API models

### 3. API Gateway

**API key authentication:**
- Admin creates API keys with scoped permissions (e.g., `transcription:read`, `recording:create`)
- Keys are SHA-256 hashed in DB — plaintext shown only once at creation
- Auth via `Authorization: Bearer vst_...` header (detected by prefix, separate from JWT)
- Rate limiting per key (configurable)

**No separate API namespace.** API keys authenticate against the same `/api/` routes the frontend uses. No route duplication. Versioning via accept headers if needed later.

**Webhooks:**
- Admin registers webhook URLs for specific events
- Enterprise subscribes to event bus, dispatches HTTP POST to registered URLs
- Payload: event type, timestamp, resource data
- Retry: exponential backoff, 3 attempts
- Delivery log in audit trail

### 4. Admin Dashboard

**React micro-frontend.** Enterprise ships a pre-built React bundle (Vite, same Tailwind config and design tokens as the main app). Loaded via dynamic `import()` — same look and feel as native Verbatim pages.

The plugin manifest specifies `renderMode: 'module'` for enterprise routes. The core app loads the enterprise frontend bundle via `React.lazy()` instead of iframe.

**Admin pages:**
- User management (create, edit roles, deactivate)
- Team management (create teams, manage members, invites)
- API key management (create, revoke, view usage)
- Webhook configuration (register URLs, view delivery log)
- Audit log viewer (filterable by user, action, resource, time)
- System health (active users, storage usage per team, job stats, LLM costs)
- License status (current license, expiry, seat count)

**Enterprise settings tab** in the main Settings page (via plugin manifest).

### 5. License Management

**Offline JWT-based licensing.** No phone-home requirement.

- License is a signed JWT: `org_name`, `seat_count`, `expires_at`, `features`
- Validated against a public key bundled in the enterprise package
- Stored in DB or as env var (`VERBATIM_LICENSE_KEY`)

**Enforcement:**
- License middleware checks validity on every request (result cached, not crypto every time)
- Expired → 14-day grace period → read-only mode (can view data, cannot create/modify)
- Exceeded seats → no new user creation, existing users unaffected
- No license → enterprise features disabled, falls back to core-only behavior

**License generation:** Offline CLI tool (`scripts/generate-license.py`) using a private key we hold. Customer pastes license key into enterprise settings.

### 6. Deployment

**Docker Compose (primary):**
- `verbatim-backend`: FastAPI + enterprise plugin, serves API + static frontend
- `postgres`: PostgreSQL database
- `nginx`: Reverse proxy, SSL termination, serves static frontend assets
- Optional: `redis` for session store / caching (future)

**No Electron, no bundled models.** Server admins install ML models separately or configure external LLM endpoints.

**Configuration via environment variables:**
```
VERBATIM_MODE=enterprise
VERBATIM_DATABASE_URL=postgresql+asyncpg://user:pass@localhost/verbatim
VERBATIM_SECRET_KEY=<random-64-char-string>
VERBATIM_LICENSE_KEY=<jwt-license-string>
VERBATIM_LLM_OPENAI_KEY=sk-...
VERBATIM_LLM_OPENAI_MODEL=gpt-4o
VERBATIM_STORAGE_S3_BUCKET=verbatim-files
VERBATIM_STORAGE_S3_REGION=us-east-1
```

**Frontend:** Same React app, built as static files, served by nginx. Browser access instead of Electron.

---

## Plugin Registration (plugin.py)

```python
class EnterprisePlugin:
    name = "verbatim-enterprise"
    version = "1.0.0"

    def register(self, registry: PluginRegistry) -> None:
        from .config import enterprise_settings

        # Infrastructure adapters
        from .adapters.database import PostgresqlAdapter
        from .adapters.storage.s3 import S3StorageAdapter
        from .adapters.storage.azure_blob import AzureBlobStorageAdapter
        from .adapters.llm.openai import OpenAIAdapter
        from .adapters.llm.anthropic import AnthropicAdapter
        from .adapters.llm.generic_openai import GenericOpenAIAdapter

        registry.add_adapter("database", "postgresql", PostgresqlAdapter)
        registry.add_adapter("storage", "s3", S3StorageAdapter)
        registry.add_adapter("storage", "azure_blob", AzureBlobStorageAdapter)
        registry.add_adapter("llm", "openai", OpenAIAdapter)
        registry.add_adapter("llm", "anthropic", AnthropicAdapter)
        registry.add_adapter("llm", "generic_openai", GenericOpenAIAdapter)

        # Auth & middleware
        from .auth.middleware import JWTAuthMiddleware
        from .middleware.audit import AuditLogMiddleware
        from .middleware.license import LicenseMiddleware

        registry.add_middleware(LicenseMiddleware)
        registry.add_middleware(JWTAuthMiddleware)
        registry.add_middleware(AuditLogMiddleware)

        # Routes
        from .routes.auth import auth_router
        from .routes.teams import teams_router
        from .routes.users import users_router
        from .routes.api_keys import api_keys_router
        from .routes.admin import admin_router
        from .routes.webhooks import webhooks_router
        from .routes.license import license_router

        registry.add_router(auth_router, prefix="/api/auth", tags=["auth"])
        registry.add_router(teams_router, prefix="/api/teams", tags=["teams"])
        registry.add_router(users_router, prefix="/api/users", tags=["users"])
        registry.add_router(api_keys_router, prefix="/api/keys", tags=["api-keys"])
        registry.add_router(admin_router, prefix="/api/admin", tags=["admin"])
        registry.add_router(webhooks_router, prefix="/api/webhooks", tags=["webhooks"])
        registry.add_router(license_router, prefix="/api/license", tags=["license"])

        # Database models
        from .models.users import User, Team, TeamMember, Workspace
        from .models.api_keys import ApiKey
        from .models.audit import AuditLog

        registry.add_models([User, Team, TeamMember, Workspace, ApiKey, AuditLog])

        # Event handlers (webhooks, audit)
        from .services.webhook import dispatch_webhooks
        from .services.audit import log_event

        registry.on("transcription.complete", dispatch_webhooks)
        registry.on("transcription.complete", log_event)
        registry.on("transcription.failed", log_event)
        registry.on("document.processed", dispatch_webhooks)
        registry.on("document.processed", log_event)

        # Job handlers
        from .services.webhook import handle_webhook_dispatch
        registry.add_job_handler("webhook_dispatch", handle_webhook_dispatch)

        # Frontend extensions
        registry.add_frontend_routes(["/admin", "/teams", "/api-keys", "/webhooks"])
        registry.add_frontend_nav_items([
            {"key": "admin", "label": "Admin", "icon": "shield", "position": "bottom"},
            {"key": "teams", "label": "Teams", "icon": "users", "position": "main"},
        ])
        registry.add_frontend_settings_tab({
            "id": "enterprise",
            "label": "Enterprise",
            "icon": "building",
        })
```

---

## Open Source Changes Required

The enterprise package may expose gaps in the core plugin system. Expected changes to the open source repo during Phase 3:

1. **Module-based plugin rendering** — Upgrade App.tsx plugin page rendering to support `renderMode: 'module'` (dynamic `React.lazy()` import) alongside existing iframe mode
2. **Adapter consumption** — Core factory (`core/factory.py`) needs to check the plugin registry for registered adapters and use them when `MODE=enterprise`
3. **Auth dependency injection** — Core routes may need a `get_current_user` dependency that returns the `NoAuthProvider` user by default, overridden by enterprise middleware
4. **Additional event emissions** — More `emit()` calls at key points (recording.created, document.uploaded, project.created, etc.) as the webhook system needs them

These are small, backward-compatible additions to the open source core.

---

## Implementation Priority

Within Phase 3, build in this order:

1. **Package skeleton** — Repo, pyproject.toml, plugin class, config, CI
2. **PostgreSQL adapter** — First real adapter, proves the wiring works
3. **Auth + RBAC** — JWT provider, middleware, user model, login/register routes
4. **Team model + routes** — Teams, members, workspaces, data scoping
5. **API keys + webhooks** — External API access, event-driven integrations
6. **LLM + storage adapters** — OpenAI/Anthropic passthrough, S3/Azure storage
7. **Admin dashboard** — React micro-frontend, user/team/key management UI
8. **Audit logging** — Middleware + log viewer
9. **License management** — JWT validation, enforcement, generation tool
10. **Docker deployment** — Compose file, nginx config, documentation
