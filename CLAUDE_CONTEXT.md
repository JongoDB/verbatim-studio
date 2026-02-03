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
- **Production**: `<app-bundle>/Contents/Resources/backend/verbatim.db`
- **User data**: `~/Library/Application Support/@verbatim/electron/`

### ML Model Downloads
Models are downloaded to `~/Library/Application Support/@verbatim/electron/models/` on first use.

## Recent Features (as of v0.26.12)

- Global search includes conversations/chat history (both SearchPage and header SearchBox)
- PDF text extraction with PyMuPDF
- OCR with Qwen VL model
- Speaker diarization with pyannote
- Inline document notes
- Dark mode support
- Cmd+R reload fix for Electron

## Testing Checklist for Releases

- [ ] Version shows correctly in navbar and settings
- [ ] PDF preview works
- [ ] OCR/text extraction works
- [ ] Speaker diarization works
- [ ] Global search returns results
- [ ] Cmd+R reloads without white screen
- [ ] Chat history appears in search results

## Supabase Integration

Project uses Supabase MCP for documentation queries. The backend does NOT use Supabase for data storage (uses local SQLite).

## Contact / Repository

- GitHub: `JongoDB/verbatim-studio`
- Issues: `https://github.com/JongoDB/verbatim-studio/issues`
