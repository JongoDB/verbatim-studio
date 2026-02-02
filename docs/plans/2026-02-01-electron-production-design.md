# Electron Production Build Design

**Date:** 2026-02-01
**Issue:** #16
**Status:** Approved

## Overview

Plan for transitioning Verbatim Studio from the current development environment (browser + Python venv) to a production Electron app with self-contained dependencies. The app supports both basic (local) and enterprise (server-connected) tiers through a unified architecture.

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| App architecture | Unified app with connection modes | Single codebase, graceful upgrade path, offline-first |
| Python runtime | Embedded (python-build-standalone) | Maintainable, debuggable, cross-platform binaries available |
| Backend communication | HTTP over localhost or remote | Zero frontend changes, existing API code works as-is |
| ML dependencies | Download on first use | Keeps app small (~150MB), users only download what they need |
| Data location | User-configurable, platform defaults | Matches existing Storage Locations feature |
| Build pipeline | GitHub Actions (full CI) | No manual steps, automated for all platforms |
| Dev/prod detection | Runtime environment variables | Single codebase, no code duplication |

## Unified App Architecture

Rather than separate apps for basic and enterprise tiers, we build a single Electron app that supports multiple connection modes:

### Connection Modes

| Mode | Description | Backend | Use Case |
|------|-------------|---------|----------|
| Local | Everything on-device | Embedded Python | Basic tier, offline work |
| Connected | Thin client to remote server | Remote enterprise server | Enterprise tier |
| Hybrid | Local + sync to server | Both | Enterprise users needing offline access |

### Mode Selection UI

```
┌─────────────────────────────────────────────────────────────┐
│  Settings → Connection                                      │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  ○ Local Mode (default)                                     │
│    Everything runs on your device. No internet required.    │
│                                                             │
│  ○ Connect to Server                         [Enterprise]   │
│    ┌─────────────────────────────────────────────────────┐  │
│    │ https://company.verbatim.studio                     │  │
│    └─────────────────────────────────────────────────────┘  │
│    [ Test Connection ]                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Benefits of Unified Approach

1. **Single app, single codebase** — Less maintenance, consistent UX
2. **Graceful upgrade path** — Basic users can connect to server later without reinstalling
3. **Offline-first for enterprise** — Work locally, sync when back online
4. **Flexible deployment** — Same app works for individuals and organizations

### Phased Implementation

**Phase A: Local + Connected (no sync)**
- User picks one mode or the other
- Switching modes shows different data (not merged)
- Enterprise users connect to their server
- Basic users stay local

**Phase B: Hybrid Sync (later)**
- Per-project sync settings
- Offline queue for pending uploads
- Conflict resolution (last-write-wins or manual)
- Background sync when connected

```
┌─────────────────────────────────────────────────────────────┐
│  Project: Q4 Interviews                      [Local Only ▼] │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Storage:                                                   │
│    ○ Local Only — stays on this device                      │
│    ○ Synced — available on server + this device             │
│    ○ Server Only — stream from server, don't store locally  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Electron Startup Logic

```typescript
// apps/electron/src/main.ts

async function start() {
  const settings = await loadSettings();

  if (settings.connectionMode === 'local') {
    // Spawn embedded Python backend
    await spawnPythonBackend();
    apiBaseUrl = `http://127.0.0.1:${port}`;
  } else {
    // Connect to remote server
    apiBaseUrl = settings.serverUrl;
    // Optionally spawn local Python for hybrid mode
    if (settings.connectionMode === 'hybrid') {
      await spawnPythonBackend();
      localApiUrl = `http://127.0.0.1:${port}`;
    }
  }

  createMainWindow(apiBaseUrl);
}
```

### Backend Adapters (Enterprise)

The backend uses adapters to support both tiers:

```
packages/backend/
  adapters/
    database/
      sqlite.py      # Basic tier (local)
      postgres.py    # Enterprise tier (server)
    storage/
      local.py       # Local filesystem
      s3.py          # Enterprise cloud storage
    auth/
      none.py        # Basic tier (no auth)
      rbac.py        # Enterprise tier (roles, SSO)
```

Same API surface, different implementations. The frontend doesn't know or care which adapter is in use.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Verbatim Studio.app                         │
├─────────────────────────────────────────────────────────────────┤
│  Electron Main Process                                          │
│  ├── Spawns embedded Python backend on startup                  │
│  ├── Manages app lifecycle (tray, updates, quit)                │
│  └── Exposes native APIs via preload (file dialogs, etc.)       │
├─────────────────────────────────────────────────────────────────┤
│  Renderer Process (React app)                                   │
│  ├── Same frontend code as browser version                      │
│  ├── Detects Electron via window.electronAPI                    │
│  └── API calls to http://127.0.0.1:{dynamic_port}               │
├─────────────────────────────────────────────────────────────────┤
│  Resources (bundled)                                            │
│  ├── python-standalone/          # Embedded Python 3.12         │
│  ├── backend/                    # FastAPI source code          │
│  ├── site-packages/              # Core deps (FastAPI, etc.)    │
│  └── requirements-ml.txt         # Pinned ML versions           │
├─────────────────────────────────────────────────────────────────┤
│  User Data (platform-standard, configurable)                    │
│  ├── db/verbatim.db              # SQLite database              │
│  ├── models/                     # Downloaded LLM/VLM/Whisper   │
│  ├── ml-deps/                    # Installed ML packages        │
│  └── recordings/                 # User's audio/documents       │
└─────────────────────────────────────────────────────────────────┘
```

## Bundled vs Downloaded Dependencies

### Pre-bundled with app (~150MB)

- Python 3.12 standalone runtime
- Core deps: FastAPI, uvicorn, SQLAlchemy, aiosqlite, pydantic
- Document processing: python-docx, PyMuPDF, openpyxl, python-pptx
- Export: reportlab
- All non-ML dependencies from `pyproject.toml`
- SQLite (part of Python standard library)

### Downloaded on first ML use (~2GB)

Triggered when user first tries to transcribe or use AI features:

- PyTorch, torchaudio
- WhisperX, pyannote.audio
- transformers (for VLM/OCR)
- llama-cpp-python (for LLM)
- numpy, accelerate, etc.

Version-pinned via bundled `requirements-ml.txt`:

```
torch==2.8.0
torchaudio==2.8.0
whisperx==3.1.6
pyannote.audio==3.1.1
numpy==2.0.2
```

### Downloaded via Settings UI (existing flow)

- Whisper models
- LLM models (Qwen)
- VLM/OCR models

## Startup Flow

```
1. Electron main process starts
   - Load user settings (connection mode, server URL)
   - Set environment variables:
     VERBATIM_ELECTRON=1
     VERBATIM_DATA_DIR=~/Library/Application Support/...

2. Determine backend based on connection mode:

   LOCAL MODE:
   - Find free port (e.g., 52847)
   - Set VERBATIM_PORT=52847
   - Spawn Python backend:
     {resources}/python-standalone/bin/python -m uvicorn
       api.main:app --host 127.0.0.1 --port 52847
   - Wait for backend ready (poll /health every 100ms)
   - apiBaseUrl = http://127.0.0.1:52847

   CONNECTED MODE:
   - apiBaseUrl = settings.serverUrl (e.g., https://company.verbatim.studio)
   - Test connection to remote server
   - No local Python spawned

   HYBRID MODE:
   - Spawn local Python (same as Local Mode)
   - Also configure remote server URL
   - localApiUrl = http://127.0.0.1:52847
   - remoteApiUrl = settings.serverUrl

3. Load renderer
   - Create BrowserWindow
   - Load bundled frontend
   - Frontend reads API URL from window.electronAPI.getApiUrl()

4. App ready
   - Hide splash, show main window
   - Backend + Frontend communicating
```

On quit (Local/Hybrid modes), Electron sends SIGTERM to Python process and waits for graceful shutdown.

## ML Dependencies Installation Flow

When user first tries to transcribe or use AI features:

1. Backend checks: Is ML environment ready?
   - Look for `{data_dir}/ml-deps/torch/__init__.py`
   - If missing, return `{ "ml_ready": false }`

2. Frontend shows ML Setup modal:
   - "AI features require additional components (~2GB)"
   - Lists: PyTorch, WhisperX, speaker diarization
   - [Download Now] / [Cancel] buttons

3. Backend runs pip install:
   ```bash
   {python} -m pip install \
     --target {data_dir}/ml-deps \
     --no-deps \
     -r requirements-ml.txt
   ```
   - Stream progress via SSE to frontend

4. Backend adds ml-deps to sys.path
   - ML features now available
   - User can proceed to download models via existing UI

## Directory Structure

### App Bundle (macOS example)

```
Verbatim Studio.app/Contents/
├── MacOS/
│   └── Verbatim Studio          # Electron binary
├── Resources/
│   ├── app.asar                 # Electron app (main + renderer)
│   ├── python/                  # python-build-standalone
│   │   ├── bin/python3.12
│   │   └── lib/python3.12/
│   ├── backend/                 # FastAPI source code
│   │   ├── api/
│   │   ├── core/
│   │   ├── services/
│   │   └── persistence/
│   ├── site-packages/           # Pre-bundled core deps
│   ├── requirements-ml.txt      # Pinned ML versions
│   └── frontend/                # Built React app
└── Info.plist
```

### User Data

```
~/Library/Application Support/Verbatim Studio/   # macOS
%APPDATA%\Verbatim Studio\                       # Windows
~/.local/share/verbatim-studio/                  # Linux

├── db/
│   └── verbatim.db
├── models/
│   ├── whisper/
│   ├── llm/
│   └── vlm/
├── ml-deps/                     # Downloaded ML packages
│   ├── torch/
│   ├── whisperx/
│   └── ...
└── storage/                     # Default local storage location
    └── recordings/
```

## Environment Detection

### Backend (Python)

```python
# api/core/config.py

import os
from pathlib import Path

def is_electron() -> bool:
    return os.environ.get("VERBATIM_ELECTRON") == "1"

def get_data_dir() -> Path:
    if is_electron():
        return Path(os.environ["VERBATIM_DATA_DIR"])
    else:
        return Path(__file__).parent.parent.parent / "data"

def get_ml_deps_path() -> Path | None:
    if is_electron():
        ml_path = get_data_dir() / "ml-deps"
        if ml_path.exists():
            return ml_path
    return None

# On startup, add ml-deps to path if available
ml_deps = get_ml_deps_path()
if ml_deps:
    import sys
    sys.path.insert(0, str(ml_deps))
```

### Frontend (React)

```typescript
// src/lib/api.ts

type ConnectionMode = 'local' | 'connected' | 'hybrid';

interface ElectronAPI {
  getConnectionMode: () => ConnectionMode;
  getApiUrl: () => string;
  getLocalApiUrl?: () => string;  // For hybrid mode
  getRemoteApiUrl?: () => string; // For hybrid mode
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

function getApiBaseUrl(): string {
  // Electron app
  if (window.electronAPI?.getApiUrl) {
    return window.electronAPI.getApiUrl();
  }
  // Browser dev mode
  return import.meta.env.VITE_API_URL || 'http://localhost:8000';
}

export const API_BASE = getApiBaseUrl();

// For hybrid mode: check if we should use local or remote for specific operations
export function getApiUrlForOperation(operation: 'sync' | 'default'): string {
  if (window.electronAPI?.getConnectionMode?.() === 'hybrid') {
    if (operation === 'sync') {
      return window.electronAPI.getRemoteApiUrl?.() || API_BASE;
    }
    return window.electronAPI.getLocalApiUrl?.() || API_BASE;
  }
  return API_BASE;
}
```

### Electron Preload Script

```typescript
// apps/electron/src/preload.ts

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getConnectionMode: () => ipcRenderer.sendSync('get-connection-mode'),
  getApiUrl: () => ipcRenderer.sendSync('get-api-url'),
  getLocalApiUrl: () => ipcRenderer.sendSync('get-local-api-url'),
  getRemoteApiUrl: () => ipcRenderer.sendSync('get-remote-api-url'),

  // Native features
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
});
```

## GitHub Actions Build Pipeline

```yaml
name: Build Electron App

on:
  push:
    tags: ['v*']
  pull_request:
    branches: [main]

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-latest
            arch: arm64
            artifact: Verbatim-Studio-mac-arm64.dmg
          - os: macos-13
            arch: x64
            artifact: Verbatim-Studio-mac-x64.dmg
          - os: windows-latest
            arch: x64
            artifact: Verbatim-Studio-win-x64.exe
          - os: ubuntu-latest
            arch: x64
            artifact: Verbatim-Studio-linux-x64.AppImage

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4
      - name: Download Python standalone
        run: ./scripts/download-python-standalone.sh ${{ matrix.arch }}
      - name: Install Python dependencies
        run: ./scripts/install-bundled-deps.sh
      - name: Build frontend
        run: pnpm install && pnpm build:frontend
      - name: Build Electron
        run: pnpm build:electron
        env:
          CSC_LINK: ${{ secrets.MAC_CERT }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CERT_PW }}
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact }}
          path: dist/${{ matrix.artifact }}

  release:
    needs: build
    if: startsWith(github.ref, 'refs/tags/')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - uses: softprops/action-gh-release@v1
        with:
          files: '**/*.dmg,**/*.exe,**/*.AppImage'
```

## Implementation Phases

### Phase 1: Foundation

- [ ] Set up `scripts/download-python-standalone.sh` for each platform
- [ ] Set up `scripts/install-bundled-deps.sh` to create site-packages
- [ ] Add environment detection to backend (`is_electron()`, `get_data_dir()`)
- [ ] Add `window.electronAPI` detection to frontend

### Phase 2: Electron Shell (Local Mode)

- [ ] Update `apps/electron/src/main.ts` to spawn Python backend
- [ ] Implement port finding, health polling, graceful shutdown
- [ ] Create preload script exposing `getApiUrl()`, native file dialogs
- [ ] Bundle built frontend into Electron
- [ ] Implement settings persistence for connection mode

### Phase 3: ML Dependencies Flow

- [ ] Add `/api/ml/status` endpoint (check if ML deps installed)
- [ ] Add `/api/ml/install` endpoint (stream pip install progress)
- [ ] Create ML Setup modal in frontend
- [ ] Wire up to existing model download UI

### Phase 4: GitHub Actions

- [ ] Create `.github/workflows/build-electron.yml`
- [ ] Set up code signing secrets (Apple Developer cert, Windows cert)
- [ ] Test PR builds (no signing)
- [ ] Test release builds (with signing)

### Phase 5: Connected Mode (Enterprise)

- [ ] Add Connection settings UI (server URL, test connection)
- [ ] Implement connected mode startup (skip Python spawn)
- [ ] Add authentication flow for enterprise servers (SSO, API keys)
- [ ] Test against enterprise backend (PostgreSQL, Redis, etc.)

### Phase 6: Hybrid Mode + Sync

- [ ] Add per-project sync settings UI
- [ ] Implement sync status indicators
- [ ] Add offline queue for pending operations
- [ ] Implement background sync service
- [ ] Add conflict resolution UI (last-write-wins or manual merge)
- [ ] Handle large file uploads/downloads with progress

### Phase 7: Polish

- [ ] Auto-updates (electron-updater + GitHub Releases)
- [ ] System tray integration
- [ ] First-run onboarding flow
- [ ] Error handling and recovery

## Success Criteria

- Single download, runs immediately
- Works offline after initial setup (once models downloaded)
- Auto-updates when connected
- Native look and feel on each platform
- App size <200MB without models
- Dev workflow unchanged (browser + venv still works)
- GitHub Actions builds all platform/arch combinations automatically
- Seamless switching between local and connected modes
- Enterprise users can work offline and sync when reconnected
