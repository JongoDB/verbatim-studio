# Verbatim Studio - Claude Context File

Provide this file when starting a new Claude session for continuity.

## Project Overview

Verbatim Studio is a desktop transcription application built with:
- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: Python FastAPI with SQLAlchemy (async SQLite)
- **Desktop**: Electron (packages frontend + backend + bundled Python)
- **ML**: WhisperX, MLX-Whisper, pyannote (diarization), Qwen VL (OCR)

## Directory Structure

```
verbatim-studio/
├── apps/electron/           # Electron app shell
│   ├── src/main/           # Main process (windows.ts, backend.ts)
│   └── src/preload/        # Preload scripts
├── packages/
│   ├── frontend/           # React frontend
│   │   └── src/
│   │       ├── app/        # App.tsx main component
│   │       ├── components/ # Reusable components
│   │       ├── pages/      # Page components
│   │       └── lib/        # API client, utilities
│   └── backend/            # Python FastAPI backend
│       ├── api/            # Routes and main app
│       ├── services/       # Business logic
│       ├── persistence/    # Database models
│       └── core/           # Config, settings
├── scripts/                # Build and release scripts
├── build/
│   ├── python-standalone/  # Bundled Python installation
│   └── resources/          # Prepared resources for Electron
└── dist/                   # Built Electron apps and DMGs
```

## Version Files (ALL must be updated together)

1. `apps/electron/package.json` - `"version": "X.Y.Z"`
2. `packages/backend/pyproject.toml` - `version = "X.Y.Z"`
3. `packages/frontend/src/version.ts` - `export const APP_VERSION = 'vX.Y.Z'`

## Release Workflow

**IMPORTANT: Follow this exact order to avoid version mismatches**

```bash
# 1. Make code changes, commit and push
git add <files>
git commit -m "feat/fix: description"
git push origin main

# 2. Bump version in ALL files (replace X.Y.Z with new version)
sed -i '' 's/"version": "OLD"/"version": "X.Y.Z"/' apps/electron/package.json
sed -i '' 's/version = "OLD"/version = "X.Y.Z"/' packages/backend/pyproject.toml
cat > packages/frontend/src/version.ts << 'EOF'
// This file is updated automatically by the release process
// Run: npm run update-version or ./scripts/update-version.sh
export const APP_VERSION = 'vX.Y.Z';
EOF

# 3. Prepare electron resources (MUST be after version bump)
./scripts/prepare-electron-resources.sh

# 4. Commit version bump and push
git add apps/electron/package.json packages/backend/pyproject.toml packages/frontend/src/version.ts
git commit -m "chore: bump version to X.Y.Z"
git push origin main

# 5. Create tag and push (triggers GitHub Actions build)
git tag vX.Y.Z
git push origin vX.Y.Z

# 6. Build locally if needed
pnpm --filter @verbatim/frontend build
pnpm --filter @verbatim/electron dist
```

## Release Notes Guidelines

**Every GitHub release MUST include user-friendly release notes.** These notes are displayed to users when they check for updates (via the "What's New" dialog).

### Format
```markdown
## What's New in vX.Y.Z

### ✨ New Features
- Brief, user-friendly description of new feature
- Another feature (explain benefit to user, not technical details)

### 🐛 Bug Fixes
- Fixed issue where [user-facing problem] occurred
- Resolved [describe what users experienced]

### 🔧 Improvements
- Improved [feature] for better [benefit]
- Enhanced [area] performance

### 📝 Notes
- Any important notes users should know (e.g., "Requires re-download of models")
```

### Writing Guidelines
1. **User-focused**: Describe what changed from the user's perspective, not implementation details
2. **Plain language**: Avoid technical jargon (say "search is faster" not "optimized SQL queries")
3. **Actionable**: If users need to do something, tell them clearly
4. **Concise**: One line per item, get to the point
5. **Categorized**: Use the sections above to organize changes
6. **No AI attribution**: Do NOT include "Generated with Claude Code" or similar AI attribution in release notes

### Examples
**Good**: "Fixed issue where search results wouldn't show chat conversations"
**Bad**: "Fixed SearchBox.tsx to handle type='conversation' with proper styling"

**Good**: "Added speaker identification for transcriptions (requires HuggingFace token)"
**Bad**: "Integrated pyannote diarization pipeline with HF auth"

### Creating the Release
When pushing a tag, GitHub Actions creates a draft release. Edit the release to add notes:
```bash
# After pushing the tag
gh release edit vX.Y.Z --notes "$(cat << 'EOF'
## What's New in vX.Y.Z

### ✨ New Features
- ...

### 🐛 Bug Fixes
- ...
EOF
)"
```

## Common Development Commands

```bash
# Start development (run in separate terminals)
pnpm --filter @verbatim/frontend dev     # Frontend dev server on :5173
cd packages/backend && uvicorn api.main:app --reload --port 8001  # Backend

# Build frontend only
pnpm --filter @verbatim/frontend build

# Build Electron app (includes frontend)
pnpm --filter @verbatim/electron dist

# Prepare resources for Electron (after dependency changes)
./scripts/prepare-electron-resources.sh

# Install Python ML dependencies (if changed)
./scripts/install-bundled-deps.sh

# Clear GitHub Actions cache (if builds have stale deps)
gh cache list | grep python-ml  # List caches
gh cache delete <ID>            # Delete specific cache
```

## Key Files Reference

| Purpose | File |
|---------|------|
| Electron window setup | `apps/electron/src/main/windows.ts` |
| Backend startup | `apps/electron/src/main/backend.ts` |
| API client | `packages/frontend/src/lib/api.ts` |
| Main app component | `packages/frontend/src/app/App.tsx` |
| Header search box | `packages/frontend/src/components/search/SearchBox.tsx` |
| Search page | `packages/frontend/src/pages/search/SearchPage.tsx` |
| Settings page | `packages/frontend/src/pages/settings/SettingsPage.tsx` |
| Global search backend | `packages/backend/api/routes/search.py` |
| Document processing | `packages/backend/services/document_processor.py` |
| ML dependencies | `scripts/requirements-ml.txt` |
| Core dependencies | `scripts/requirements-core.txt` |
| GitHub workflow | `.github/workflows/build-electron.yml` |

## Debugging

### Viewing Backend Logs in Packaged App
When debugging issues in the production Electron app (from `/Applications`), backend logs aren't visible by default. To see Python backend output including error tracebacks:

```bash
# Run the app from Terminal to see all backend logs
/Applications/Verbatim\ Studio.app/Contents/MacOS/Verbatim\ Studio
```

This shows all output with `[Backend]` prefix, including Python errors and tracebacks.

### Frontend Console
Open DevTools in the Electron app: **View → Toggle Developer Tools** (or `Cmd+Option+I`)

## Known Issues & Solutions

### White screen on Cmd+R in Electron
**Fixed in v0.26.10**: `windows.ts` intercepts Cmd+R and explicitly reloads from the correct file path.

### Version shows "dev" in packaged app
**Fixed in v0.26.11**: `_get_git_version()` in `system.py` now reads from `pyproject.toml` first, falls back to git.

### PDF preview not working in packaged app
**Fixed in v0.26.11**: `PDFViewer.tsx` uses Vite URL import (`?url` suffix) for worker file.

### OCR/ML packages missing in packaged app
**Solution**: Re-run `./scripts/install-bundled-deps.sh` then `./scripts/prepare-electron-resources.sh` then rebuild.

### GitHub build has stale dependencies
**Solution**: Clear the Python cache: `gh cache delete <ID>` for python-ml caches.

### Conversations not showing in header search bar
**Fixed in v0.26.12**: `SearchBox.tsx` now handles `type="conversation"` with cyan styling, chat icon, and "Chat" badge.

## Architecture Notes

### API URL Injection (Electron)
The backend runs on a dynamic port. The API URL is injected into the frontend via:
1. Preload script exposes `window.electronAPI.getApiUrl()`
2. `api.ts` has retry logic for reload scenarios
3. `windows.ts` also injects via `executeJavaScript` as backup

### Version Sources
- **Navbar**: Uses `systemInfo.app_version` from `/api/system/info` (reads pyproject.toml)
- **Settings**: Same source as navbar
- **Root API** (`/`): Uses `APP_VERSION` from `main.py` (also reads pyproject.toml)

### Database Location
- **Development**: `packages/backend/verbatim.db`
- **Production**: `~/Library/Application Support/@verbatim/electron/verbatim.db` (persists across updates)
- **User data**: `~/Library/Application Support/@verbatim/electron/`

### ML Model Downloads
Models are downloaded to `~/Library/Application Support/@verbatim/electron/models/` on first use.

## Enterprise Edition

Verbatim Studio uses an **Open Core** architecture with two repositories:

| | Open-Source | Enterprise |
|---|---|---|
| **Repo** | `verbatim-studio` (this repo) | `verbatim-studio-enterprise` (private) |
| **Path** | `/Users/JonWFH/jondev/verbatim-studio` | `/Users/JonWFH/jondev/verbatim-studio-enterprise` |
| **Contains** | Frontend, backend, Electron, CI | Plugin: auth, teams, PostgreSQL, license, Docker |
| **Version** | v0.48.0 | v1.2.0-dev |

### When to Update This Repo (Open-Source)

**Only update open-source for:**
- Bug fixes in core backend/frontend code
- New plugin extension points needed by enterprise (e.g., `PluginRegistry` hooks)
- CI/CD workflow changes (GitHub Actions)
- Electron shell changes (updater, packaging)
- Dependency bumps in core packages

**Do NOT update open-source for:**
- Enterprise-only features (auth, teams, admin, license)
- Docker deployment (lives in enterprise repo)
- Enterprise routes, middleware, models

### Enterprise Plugin Architecture

The enterprise plugin connects via Python entry points (`verbatim.plugins`):
- `core/plugins.py` → `PluginRegistry` with routers, middleware, adapters, startup hooks
- Enterprise `plugin.py` → Registers auth routes, JWT middleware, PostgreSQL adapter, startup hook
- `api/main.py` → Loads plugins, runs startup hooks, then `init_db()`
- Frontend `LoginPage.tsx` is gated — only shows when enterprise middleware returns 401

### Enterprise Development Workflow

```bash
# Most work happens in the enterprise repo
cd /Users/JonWFH/jondev/verbatim-studio-enterprise

# Docker testing
./scripts/build-docker.sh
cd docker && docker compose up -d

# If you need a core change, switch to open-source:
cd /Users/JonWFH/jondev/verbatim-studio
# Make change, commit, bump version, tag, push
# Then rebuild enterprise Docker to pick up new core
```

### Enterprise Version Files
1. `verbatim-studio-enterprise/pyproject.toml` - `version = "X.Y.Z"`

## Auto-Update System

The updater is custom-built (not `electron-updater`):
- `apps/electron/src/main/updater.ts` — Checks GitHub releases API, downloads DMG/EXE
- `apps/electron/src/main/update-script.ts` — macOS: shell script replaces `/Applications/Verbatim Studio.app`
- `apps/electron/src/main/update-store.ts` — Persists auto-update preferences
- `packages/frontend/src/components/updates/UpdatePrompt.tsx` — Download UI with progress bar

**Flow:** `initAutoUpdater()` → checks GitHub releases every 24h → finds platform-specific asset → sends `update-available` to renderer → user clicks "Update Now" → downloads asset → macOS: mounts DMG + runs shell script / Windows: runs NSIS `/S` → quits app → new version launches.

## Testing Checklist for Releases

- [ ] Version shows correctly in navbar and settings
- [ ] PDF preview works
- [ ] OCR/text extraction works
- [ ] Speaker diarization works
- [ ] Global search returns results
- [ ] Cmd+R reloads without white screen
- [ ] Auto-update detects new version and downloads correctly

## Contact / Repository

- GitHub: `JongoDB/verbatim-studio`
- Issues: `https://github.com/JongoDB/verbatim-studio/issues`
