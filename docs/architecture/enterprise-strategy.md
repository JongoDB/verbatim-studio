# Enterprise Strategy: Open Core Model

> **Decision date**: 2026-02-11
> **Status**: Approved direction

## Business Model

Verbatim Studio uses an **open core** model:
- **Open source** (this repo): Core transcription app — Electron + React + FastAPI
- **Enterprise** (private repo): Server-deployed superset — all core features + team/admin/API
- **Meeting bots** (separate service): Cloud-hosted bot orchestration for Teams/Zoom/Meet

## Two Deployment Models

```
┌─────────────────────────────────────────────────────────┐
│                    Open Source (this repo)               │
│                                                         │
│  Shared codebase:                                       │
│  ├── React frontend (packages/frontend)                 │
│  ├── FastAPI backend (packages/backend)                  │
│  ├── Plugin system, event bus, extension interfaces      │
│  └── Core: transcription, OCR, search, export, AI chat  │
│                                                         │
│  ┌───────────────────┐  ┌─────────────────────────────┐ │
│  │   Desktop (OSS)   │  │     Enterprise (Server)     │ │
│  │                   │  │                             │ │
│  │  Electron shell   │  │  No Electron — served via   │ │
│  │  Bundled models   │  │  reverse proxy / container  │ │
│  │  SQLite           │  │                             │ │
│  │  Local storage    │  │  pip install verb-enterprise│ │
│  │  Single user      │  │  PostgreSQL (multi-user)    │ │
│  │  No auth needed   │  │  All storage + network      │ │
│  │                   │  │  RBAC, teams, workspaces    │ │
│  │                   │  │  LLM server agnostic        │ │
│  │                   │  │  API gateway, webhooks      │ │
│  │                   │  │  Admin dashboard, audit     │ │
│  │                   │  │  License management         │ │
│  └───────────────────┘  └──────────────┬──────────────┘ │
└─────────────────────────────────────────┼───────────────┘
                                          │ connects via API
                            ┌─────────────▼──────────────┐
                            │  Meeting Bot Service       │
                            │  (separate repo/service)   │
                            │                            │
                            │  Bot orchestration         │
                            │  Platform SDKs             │
                            │  (Teams, Zoom, Meet)       │
                            │  Audio → transcription     │
                            └────────────────────────────┘
```

## Enterprise Is Additive

Enterprise maintains **all** core functionality and adds to it:

| Capability | Desktop (OSS) | Enterprise (Server) |
|-----------|--------------|-------------------|
| Transcription, OCR, search, export | Yes | Yes |
| Local model execution | Yes (bundled) | Yes (installed on server) |
| External LLM endpoints | Yes | Yes + managed API keys |
| Local file storage | Yes | Yes |
| Network / S3 storage | — | Yes (additional option) |
| Database | SQLite | PostgreSQL (multi-user concurrency) |
| Auth & RBAC | — | Yes |
| Team workspaces | — | Yes |
| API gateway & webhooks | — | Yes |
| Admin dashboard & audit | — | Yes |
| Deployment | Electron desktop | Server / Docker / K8s |

Enterprise never removes a feature — it upgrades infrastructure where multi-user/server
demands it (SQLite → PostgreSQL for concurrency, auth layer for multi-user) and adds
enterprise-specific capabilities on top.

## Why This Split

### Two deployment models, one codebase
The React frontend and FastAPI backend are the shared foundation. Desktop wraps them in
Electron with bundled models for single-user local use. Enterprise deploys the same
backend + frontend as a server with `pip install verbatim-enterprise` adding team features,
RBAC, and infrastructure upgrades via the plugin system.

### Meeting bots = separate service
Meeting bots need persistent server-side processes — joining calls, maintaining WebSocket
connections, processing audio streams 24/7. This is a separate cloud service that connects
to Verbatim through the API integration layer that the enterprise package provides.

### Plugin system = open source foundation
The plugin system lives in the open source repo. This is the strategic move:
- Makes the open source product more valuable (community can build plugins)
- Provides the exact infrastructure to cleanly attach enterprise features
- One extension system serves both community and commercial audiences

### Enterprise package = plugin-based overlay
Team features, API gateway, admin dashboard — these are deeply integrated with the core
app. They modify routes, extend the DB schema, add UI, and swap infrastructure adapters.
A single `pip install verbatim-enterprise` registers everything via the plugin system.
No Electron shell, no bundled models — just the backend + frontend deployed as a service.

## Dependency Direction (Critical)

```
verbatim-enterprise  →  depends on  →  verbatim-studio (open core)
meeting-bot-service  →  depends on  →  verbatim API (via enterprise API layer)
```

**Never the reverse.** The open source core never imports from or references the enterprise
package. It provides hooks; the enterprise package attaches to them.

## Feature Mapping

| Feature | Where it lives | Why |
|---------|---------------|-----|
| Plugin system | **Open source** | Foundation for everything; community value |
| Core features (transcription, OCR, etc.) | **Open source** | Available in both desktop and enterprise |
| PostgreSQL adapter | Enterprise package | Swaps SQLite for multi-user concurrency |
| Network/S3 storage adapter | Enterprise package | Adds server-friendly storage alongside local |
| Auth, RBAC, team workspaces | Enterprise package | Multi-user requires auth and permissions |
| API gateway (keys, webhooks) | Enterprise package | New routes + API key management |
| LLM API passthrough | Enterprise package | Server-agnostic LLM endpoint management |
| Admin observability | Enterprise package | Dashboard UI + audit middleware |
| License management | Enterprise package | Validates enterprise license at runtime |
| Meeting bots | Separate cloud service | Needs persistent server, platform SDKs |

## Precedent

This follows the same model as:
- **GitLab** CE vs EE — EE is a superset that includes CE + enterprise modules
- **Grafana** — Open source core + enterprise plugins
- **Sentry** — Open source core, enterprise features in separate packages

## Enterprise Features (Priority Order)

1. **Plugin system** (open source) — Foundation that enables everything else
2. **Infrastructure adapters** (enterprise) — PostgreSQL, network storage, LLM API passthrough
3. **API integrations** — API keys, rate limiting, webhooks, REST API
4. **Team features** — User accounts, workspaces, RBAC, sharing
5. **Admin observability** — Usage analytics, audit logs, system health
6. **Meeting bots** — Platform SDKs, scheduling, auto-join, live transcription relay

## Infrastructure Upgrade Pattern

Enterprise upgrades infrastructure via adapters registered through the plugin system.
The core codebase already uses abstractions (SQLAlchemy, storage factory) that make this
possible:

```python
# Enterprise plugin register():
def register(self, registry):
    # Swap database engine to PostgreSQL
    registry.add_adapter("database", "postgresql", PostgresqlAdapter)

    # Add network storage alongside local
    registry.add_adapter("storage", "s3", S3StorageAdapter)
    registry.add_adapter("storage", "azure_blob", AzureBlobAdapter)

    # Add external LLM endpoint management
    registry.add_adapter("llm", "openai_api", OpenAIPassthroughAdapter)
    registry.add_adapter("llm", "anthropic_api", AnthropicPassthroughAdapter)
```

These adapters don't replace local capabilities — they extend the available options.
A server deployment can run local Whisper models AND accept external LLM API calls.
It can use local file storage AND S3. PostgreSQL replaces SQLite because multi-user
concurrency requires it, but this is an upgrade, not a limitation.

## Approaches Considered and Rejected

### License-gated features (single repo)
All code in one repo with license key checks. Rejected because enterprise code would be
visible in the open source repo, inviting community pressure to open everything.

### Separate enterprise backend service
Enterprise as a completely separate API service. Rejected because team features and admin
UI need tight integration with the core app — API boundaries make this clunky.

### Dual build (compile-time feature flags)
Enterprise features compiled in during build, stripped from open source builds. Rejected
due to build complexity and risk of accidentally shipping enterprise code in open builds.
