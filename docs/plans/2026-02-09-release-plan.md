# Verbatim Studio Release Plan

**Created:** 2026-02-09
**Current version:** v0.31.8
**Open issues:** 20 (3 basic/core, 17 enterprise)

---

## Overview

| Release | Theme | Key Issues | Tier |
|---------|-------|------------|------|
| v0.32.0 | Documents Enhancement | #102 | Basic |
| v0.33.0 | Live Transcription GA | #99 | Basic |
| v0.34.0 | Electron Desktop App | #16 | Basic |
| v0.35.0 | Enterprise Foundation | #11, #12 | Enterprise |
| v0.36.0 | Enterprise Admin & Users | #50, #51, #58, #65, #67 | Enterprise |
| v0.37.0 | Enterprise Ops & Compliance | #68, #69, #70, #71 | Enterprise |
| v0.38.0 | Enterprise AI & External Services | #10, #82, #88 | Enterprise |
| v0.39.0 | Enterprise Electron Client | #17 | Enterprise |
| Future | Research / Exploration | #85, #89 | Enterprise |

---

## v0.32.0 — Documents Enhancement

**Theme:** Bring documents feature to parity with recordings.

| # | Title | Effort | Notes |
|---|-------|--------|-------|
| 102 | Add documents to projects + enhanced Documents page UI | Medium-Large | Reuses existing recording patterns (tags, sort, filter, views) |

### Scope

- Document-project association (similar to recordings)
- Documents page UI: metadata display, sort/filter, tile/list view toggle, bulk selection
- Tagging support for documents (reuse recording tag system)
- Search by document name/content

### Why first

Only open basic-tier feature issue. Builds on existing patterns (recordings page). Immediate user value.

---

## v0.33.0 — Live Transcription GA

**Theme:** Graduate live transcription from beta status.

| # | Title | Effort | Notes |
|---|-------|--------|-------|
| 99 | Live Transcription: Graduate from Beta | Large | Multiple sub-tasks across reliability, features, UX |

### Suggested patch breakdown

| Patch | Focus | Tasks |
|-------|-------|-------|
| v0.33.0 | Core reliability | Reduce latency (<2s), robust connection handling, auto-save, better error messaging |
| v0.33.1 | UX polish | Keyboard shortcuts, inline timestamps, audio level indicator, confidence indicators |
| v0.33.2 | Integration | Project assignment, metadata entry, seamless editor transition |

### GA criteria (from issue)

1. Latency consistently under 2 seconds
2. Stable connection with graceful error recovery
3. Speaker diarization during live sessions
4. Auto-save prevents accidental data loss
5. Core keyboard shortcuts implemented

---

## v0.34.0 — Electron Desktop App (Basic)

**Theme:** Ship standalone desktop application for basic tier.

| # | Title | Effort | Priority |
|---|-------|--------|----------|
| 16 | Electron desktop app (basic) | Very Large | High (phase:3) |

### Scope

- Self-contained app bundling backend + frontend + SQLite
- Multi-platform: Windows (.exe), macOS (.dmg, Intel + Apple Silicon), Linux (.AppImage, .deb, .rpm)
- Native file dialogs, system tray, desktop notifications, auto-updates
- GitHub Actions CI/CD for multi-arch builds
- Models downloaded via Settings UI (not bundled)

### Notes

Git log shows Electron-related work already in progress (version bumping, packaging). Assess current state before full scheduling.

---

## v0.35.0 — Enterprise Foundation

**Theme:** Core enterprise infrastructure. Almost every enterprise issue depends on these.

| # | Title | Priority | Dependency Impact |
|---|-------|----------|-------------------|
| 11 | User authentication and RBAC | High | **Blocks:** #50, #51, #58, #65, #67, #68, #69, #70, #71 |
| 12 | PostgreSQL database adapter | High | Independent of #11, can be parallel |

### #11 — Auth & RBAC scope

- Email/password login with JWT sessions
- Roles: Admin, Editor, Viewer
- User registration with admin approval
- Auth middleware, ProtectedRoute, AuthContext
- Login/Register pages

### #12 — PostgreSQL scope

- PostgresAdapter implementing IDatabaseAdapter
- Alembic migrations
- Connection pooling
- SQLite -> PostgreSQL migration tool
- pgvector extension for embeddings

### Strategy

These two can be developed in parallel. Ship together as the enterprise launch gate.

---

## v0.36.0 — Enterprise Admin & User Management

**Theme:** First enterprise user experience — admin navigation, user management, profiles.
**Depends on:** v0.35.0 (#11 auth system)

| # | Title | Effort | Notes |
|---|-------|--------|-------|
| 50 | Administration sidebar section | Small | Navigation shell for admin pages |
| 67 | User Management admin page | Medium | CRUD, approval workflow, role management |
| 51 | User profile card in sidebar | Small | Avatar, name, role badge, sign out |
| 65 | Account settings tab | Medium | Profile edit, password change, preferences |
| 58 | Show 'Uploaded By' on recordings | Small | Uploader tracking, filter by uploader |

### Why grouped

These form the "enterprise mode first impression" — when a user enables enterprise features, they should see: admin nav, user management, their profile, account settings, and attribution on content.

---

## v0.37.0 — Enterprise Ops & Compliance Admin Pages

**Theme:** Operational admin tools for enterprise deployments.
**Depends on:** v0.36.0 (admin sidebar navigation)

| # | Title | Effort | Notes |
|---|-------|--------|-------|
| 68 | Template Management admin page | Medium | Project types + recording templates, import/export |
| 69 | Service Management admin page | Medium | Health dashboard, status cards, refresh |
| 70 | Database Management admin page | Medium | DB stats, storage breakdown, VACUUM/ANALYZE |
| 71 | Accounting & Audit Reports admin page | Medium | Upload tracking, user activity, CSV export |

### Why grouped

All four are independent admin pages at similar effort level. They provide the complete operational toolkit for enterprise admins. Can be developed in parallel and shipped together or incrementally as patches.

---

## v0.38.0 — Enterprise AI & External Services

**Theme:** Connect to external AI and transcription infrastructure.
**Depends on:** v0.35.0 (enterprise foundation)

| # | Title | Effort | Notes |
|---|-------|--------|-------|
| 88 | External WhisperX service UI config | Small | UI for existing env var config. Enterprise-gated. |
| 82 | Configure external LLM servers | Medium | OpenAI-compatible, Anthropic, Google AI endpoints |
| 10 | AI services integration (Ollama, Gemini, OpenAI) | Large | Full integration: chat, embeddings, semantic search |

### Suggested patch breakdown

| Patch | Focus |
|-------|-------|
| v0.38.0 | #88 — External WhisperX UI (small, already supported via env vars) |
| v0.38.1 | #82 — External LLM config UI (provider dropdown, base URL, API key, test connection) |
| v0.38.2 | #10 — Full AI services integration (chat interface, semantic search, embeddings) |

### Notes

#82 and #10 overlap significantly. #82 is the settings UI, #10 is the full integration including chat and semantic search. Tackle #82 first as the configuration layer, then #10 builds on top.

---

## v0.39.0 — Enterprise Electron Client

**Theme:** Thin client connecting to remote Verbatim server.
**Depends on:** v0.35.0 (auth), stable enterprise backend

| # | Title | Priority | Notes |
|---|-------|----------|-------|
| 17 | Electron desktop client (enterprise) | Medium | phase:5. Server connection manager, credential storage, native notifications. |

### Scope

- Thin client (no bundled backend)
- Server connection settings with URL + credentials
- Remember multiple servers
- Native notifications for job completion
- Offline indicator
- Secure credential storage (OS keychain)

---

## Future / Research (unversioned)

These need research spikes before they can be scheduled into a release.

| # | Title | Status | Recommendation |
|---|-------|--------|----------------|
| 85 | Meeting Bots for Teams/Meet/Zoom | Exploration | Needs feasibility analysis: evaluate Zoom SDK, Teams Graph API, Google Meet API, third-party services (Recall.ai). Create a research spike. |
| 89 | Secure Mobile Access to self-hosted server | Exploration | Needs tunnel solution research: Cloudflare Tunnel, Tailscale Funnel, ngrok. Also needs mobile client decision (PWA vs native). Create a research spike. |

---

## Recommended Execution Order

### Start now (parallel tracks)

1. **#102** (Documents enhancement) — Immediate value, basic tier, ships as v0.32.0
2. **#99** (Live Transcription reliability) — Start core reliability work, ships incrementally as v0.33.x

### Next priority

3. **#11 + #12** (Auth + PostgreSQL) — Enterprise foundation. Begin design/planning while v0.32.0 ships.

### Assess

4. **#16** (Electron basic) — Already partially in progress. Assess current state to determine remaining work.

### Queue behind enterprise foundation

5. Enterprise admin pages (#50, #51, #58, #65, #67) — After #11 ships
6. Enterprise ops pages (#68, #69, #70, #71) — After admin UI ships
7. Enterprise AI (#10, #82, #88) — After #11 + #12 ship

### Defer

8. Enterprise Electron client (#17) — After enterprise backend is stable
9. Research spikes (#85, #89) — When bandwidth allows
