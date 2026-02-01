# Electron Production Build Design

**Date:** 2026-02-01
**Issue:** #16
**Status:** Approved

## Overview

Plan for transitioning Verbatim Studio from the current development environment (browser + Python venv) to a production Electron app with self-contained dependencies.

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Python runtime | Embedded (python-build-standalone) | Maintainable, debuggable, cross-platform binaries available |
| Backend communication | HTTP over localhost | Zero frontend changes, existing API code works as-is |
| ML dependencies | Download on first use | Keeps app small (~150MB), users only download what they need |
| Data location | User-configurable, platform defaults | Matches existing Storage Locations feature |
| Build pipeline | GitHub Actions (full CI) | No manual steps, automated for all platforms |
| Dev/prod detection | Runtime environment variables | Single codebase, no code duplication |

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
   - Find free port (e.g., 52847)
   - Set environment variables:
     VERBATIM_ELECTRON=1
     VERBATIM_PORT=52847
     VERBATIM_DATA_DIR=~/Library/Application Support/...

2. Spawn Python backend
   {resources}/python-standalone/bin/python -m uvicorn
     api.main:app --host 127.0.0.1 --port 52847

3. Wait for backend ready
   - Poll http://127.0.0.1:52847/health every 100ms
   - Timeout after 30s (show error if fails)
   - Show splash screen during wait

4. Load renderer
   - Create BrowserWindow
   - Load bundled frontend
   - Frontend reads port from window.electronAPI.getPort()

5. App ready
   - Hide splash, show main window
   - Backend + Frontend communicating over localhost
```

On quit, Electron sends SIGTERM to Python process and waits for graceful shutdown.

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

function getApiBaseUrl(): string {
  if (window.electronAPI?.getPort) {
    const port = window.electronAPI.getPort();
    return `http://127.0.0.1:${port}`;
  }
  return import.meta.env.VITE_API_URL || 'http://localhost:8000';
}

export const API_BASE = getApiBaseUrl();
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

### Phase 2: Electron Shell

- [ ] Update `apps/electron/src/main.ts` to spawn Python backend
- [ ] Implement port finding, health polling, graceful shutdown
- [ ] Create preload script exposing `getPort()`, native file dialogs
- [ ] Bundle built frontend into Electron

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

### Phase 5: Polish

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
