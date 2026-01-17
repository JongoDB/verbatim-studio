# Verbatim Studio - Design Document

**Version:** 1.0
**Date:** January 17, 2025
**Status:** Approved for implementation

---

## Executive Summary

**Product**: Verbatim Studio - Privacy-first transcription for professionals

**Initial Release**: macOS (Apple Silicon) native application with full offline AI capabilities

**Core Value Proposition**: Legal, medical, and government professionals get enterprise-grade transcription that never sends data off their machine. Real-time and batch transcription, speaker identification, AI summarization - all running locally with GPU acceleration.

**Target Platform**: macOS ARM64 (Apple Silicon) with Metal GPU acceleration. Windows and Linux support planned for future releases.

---

## Key Decisions

| Aspect | Decision |
|--------|----------|
| Priority | Basic mode (single-user, local) first |
| Desktop Framework | Electron |
| Frontend | React + shadcn/ui + Tailwind |
| Backend | FastAPI (Python) |
| ASR (Real-time) | whisper.cpp with Metal GPU |
| ASR (Batch) | WhisperX via embedded Python |
| LLM | llama.cpp (direct integration, not Ollama) |
| Diarization | Pyannote (bundled at build time) |
| Database | SQLite |
| Python Runtime | Embedded via python-build-standalone |
| Models | Bundle whisper-tiny + pyannote; download larger models at install |
| Codebase | Clean rewrite using existing spec as reference |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Shell                            │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              React + shadcn/ui Frontend                  ││
│  └─────────────────────┬───────────────────────────────────┘│
│                        │ HTTP (localhost)                    │
│  ┌─────────────────────▼───────────────────────────────────┐│
│  │              FastAPI Backend (Python)                    ││
│  │         SQLite │ Threading Queue │ File Storage          ││
│  └─────────────────────┬───────────────────────────────────┘│
│                        │                                     │
│  ┌──────────┬──────────┴──────────┬──────────┐              │
│  │ whisper  │    WhisperX +       │ llama    │              │
│  │ .cpp     │    Pyannote         │ .cpp     │              │
│  │ (native) │    (Python)         │ (native) │              │
│  └──────────┴─────────────────────┴──────────┘              │
└─────────────────────────────────────────────────────────────┘
```

---

## Component Architecture

### Electron Main Process
- App lifecycle management
- Window creation and management
- IPC handlers for native features (file dialogs, notifications, system tray)
- Backend process spawning and health monitoring
- Model download manager
- Auto-updater

### FastAPI Backend (Python subprocess)
- Runs on `localhost:8000` (configurable)
- REST API for all frontend operations
- SQLite database (stored in `~/Library/Application Support/Verbatim Studio/`)
- File storage for recordings and exports
- Job queue via Python threading (ThreadPoolExecutor)
- Coordinates calls to ML services

### ML Services

| Service | Runtime | Purpose | GPU |
|---------|---------|---------|-----|
| whisper.cpp | Native binary | Real-time transcription | Metal |
| WhisperX | Embedded Python | Batch transcription | Metal via MLX or CPU |
| Pyannote | Embedded Python | Speaker diarization | CPU |
| llama.cpp | Native binary | Summarization, chat, embeddings | Metal |

### Data Storage

```
~/Library/Application Support/Verbatim Studio/
├── verbatim.db          # SQLite database
├── config.json          # App configuration
├── media/               # Uploaded recordings
├── exports/             # Generated documents
├── models/
│   ├── whisper/         # Whisper models (ggml format)
│   ├── llm/             # LLM models (gguf format)
│   └── pyannote/        # Diarization models
└── logs/
```

---

## Core Data Flows

### Flow 1: Batch Transcription (File Upload)

```
User drops audio file
        │
        ▼
┌─────────────────┐
│ Electron IPC    │ ─── Native file dialog (optional)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Frontend        │ ─── POST /api/recordings/upload
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ FastAPI         │ ─── Save to ~/media/, create DB record
│                 │ ─── Queue transcription job
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Thread Worker   │ ─── WhisperX transcribe (high accuracy)
│                 │ ─── Pyannote diarize (speaker labels)
│                 │ ─── Merge results, save to DB
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Frontend        │ ─── Poll or WebSocket for status
│                 │ ─── Display transcript with speakers
└─────────────────┘
```

### Flow 2: Real-Time Transcription (Microphone)

```
User clicks "Start Recording"
        │
        ▼
┌─────────────────┐
│ Frontend        │ ─── Request microphone permission
│                 │ ─── WebSocket to /ws/transcribe
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ FastAPI WS      │ ─── Audio chunks arrive (~100ms intervals)
│                 │ ─── Buffer to whisper.cpp process
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ whisper.cpp     │ ─── Streaming inference (Metal GPU)
│                 │ ─── Return partial transcripts
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Frontend        │ ─── Live text display
│                 │ ─── On stop: save full recording
│                 │ ─── Optional: re-process with WhisperX for accuracy
└─────────────────┘
```

### Flow 3: AI Summarization

```
User clicks "Summarize" on transcript
        │
        ▼
┌─────────────────┐
│ Frontend        │ ─── POST /api/ai/summarize
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ FastAPI         │ ─── Load transcript text
│                 │ ─── Call llama.cpp with prompt
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ llama.cpp       │ ─── Generate summary (Metal GPU)
│                 │ ─── Stream tokens back
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Frontend        │ ─── Display streaming summary
│                 │ ─── Save to transcript metadata
└─────────────────┘
```

---

## Native Binary Integration

### Sidecar Server Pattern

whisper.cpp and llama.cpp run as local HTTP servers:

```
Verbatim Studio.app/
└── Contents/
    └── Resources/
        └── bin/
            ├── whisper-server      # whisper.cpp HTTP server mode
            ├── llama-server        # llama.cpp HTTP server mode
            └── models/
                └── whisper-tiny.bin  # Bundled base model
```

### Why Sidecar Servers

| Approach | Pros | Cons |
|----------|------|------|
| Sidecar HTTP | Process isolation, crash recovery, same API as remote services | Extra port, slight latency |
| FFI (ctypes/cffi) | Direct calls, no network | Crashes take down Python, complex bindings |

Benefits:
1. **Crash isolation** - If whisper.cpp crashes, backend stays up
2. **Same interface as Enterprise** - Remote services use HTTP too
3. **Easier debugging** - Can test servers independently
4. **Already supported** - whisper.cpp and llama.cpp have server modes built-in

### Service Implementation

```python
# packages/backend/services/whisper_service.py

class WhisperService:
    def __init__(self):
        self.process = None
        self.port = 8081

    async def start(self, model_path: str):
        self.process = subprocess.Popen([
            get_resource_path("bin/whisper-server"),
            "--model", model_path,
            "--port", str(self.port),
            "--host", "127.0.0.1"
        ])
        await self._wait_for_ready()

    async def transcribe_stream(self, audio_stream):
        async with websockets.connect(f"ws://127.0.0.1:{self.port}/inference") as ws:
            async for chunk in audio_stream:
                await ws.send(chunk)
                result = await ws.recv()
                yield json.loads(result)
```

---

## Python Runtime Bundling

### Structure

```
Verbatim Studio.app/
└── Contents/
    └── Resources/
        └── python/
            ├── bin/
            │   └── python3.11           # Standalone Python
            ├── lib/
            │   └── python3.11/
            │       └── site-packages/   # All dependencies
            └── backend/                 # FastAPI code
                ├── api/
                ├── services/
                └── main.py
```

### Build Process

```bash
# 1. Download standalone Python
curl -LO https://github.com/indygreg/python-build-standalone/releases/download/.../cpython-3.11-aarch64-apple-darwin-install_only.tar.gz
tar -xzf cpython-3.11-*.tar.gz -C build/python

# 2. Install dependencies
build/python/bin/pip install \
    fastapi uvicorn[standard] \
    whisperx \
    pyannote.audio \
    torch torchvision torchaudio \
    sqlalchemy aiosqlite \
    python-multipart httpx

# 3. Copy backend source
cp -r backend/ build/python/backend/

# 4. Trim unnecessary files
find build/python -name "*.pyc" -delete
find build/python -name "__pycache__" -delete
rm -rf build/python/lib/python3.11/test
```

### Size Estimates

| Component | Size |
|-----------|------|
| Python standalone | ~50 MB |
| PyTorch (CPU/MPS) | ~150 MB |
| WhisperX + deps | ~30 MB |
| Pyannote + deps | ~20 MB |
| FastAPI + deps | ~10 MB |
| **Total Python bundle** | **~260 MB** |

### Startup Sequence

```typescript
// electron/src/main/backend.ts

async function startBackend(): Promise<void> {
  const pythonPath = path.join(
    process.resourcesPath,
    'python/bin/python3.11'
  );
  const backendPath = path.join(
    process.resourcesPath,
    'python/backend'
  );

  backendProcess = spawn(pythonPath, [
    '-m', 'uvicorn',
    'main:app',
    '--host', '127.0.0.1',
    '--port', '8000'
  ], {
    cwd: backendPath,
    env: {
      ...process.env,
      VERBATIM_MODE: 'basic',
      VERBATIM_DATA_DIR: app.getPath('userData'),
    }
  });

  await waitForHealthy('http://127.0.0.1:8000/health');
}
```

---

## Model Management

### Model Distribution Strategy

| Model Type | Distribution | Rationale |
|------------|--------------|-----------|
| Whisper (tiny) | Bundled | Immediate basic functionality |
| Whisper (base/large/turbo) | Optional at install | User chooses quality tier |
| Pyannote | Bundled | No HF token friction, core feature |
| LLMs | Post-install download | Not blocking core transcription |

### Model Catalog

```typescript
const MODEL_CATALOG = {
  whisper: [
    { id: 'tiny', size: '75MB', quality: 'Draft', bundled: true },
    { id: 'base', size: '142MB', quality: 'Basic', bundled: false },
    { id: 'turbo', size: '1.5GB', quality: 'Fast + Good', bundled: false },
    { id: 'large-v3', size: '3GB', quality: 'Best', bundled: false },
  ],
  llm: [
    { id: 'phi-3-mini', size: '2.2GB', quality: 'Fast', bundled: false },
    { id: 'llama-3.2-3b', size: '2GB', quality: 'Balanced', bundled: false },
    { id: 'mistral-7b', size: '4GB', quality: 'Quality', bundled: false },
  ],
  diarization: [
    { id: 'pyannote-3.1', size: '50MB', quality: 'Standard', bundled: true },
  ]
};
```

### Build-time Pyannote Bundling

```bash
# Run with your HuggingFace token at build time
export HF_TOKEN="your-token-here"

python3 -c "
from pyannote.audio import Pipeline
pipeline = Pipeline.from_pretrained(
    'pyannote/speaker-diarization-3.1',
    use_auth_token='$HF_TOKEN'
)
import torch
torch.save(pipeline, 'build/models/pyannote/diarization-3.1.pt')
"
```

---

## First-Run Experience

### Setup Flow

```
Step 1: Welcome
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                    🎙️ Verbatim Studio                       │
│                                                             │
│          Professional transcription, fully private          │
│                                                             │
│    Everything runs on your Mac. No cloud. No subscriptions. │
│                                                             │
│                      [Get Started →]                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘

Step 2: Storage Location
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Step 1 of 3 · Storage Location                             │
│                                                             │
│  Where should Verbatim store recordings and transcripts?    │
│                                                             │
│  ◉ Default location                                         │
│    ~/Documents/Verbatim Studio                              │
│                                                             │
│  ○ Custom location                                          │
│    [Choose Folder...]                                       │
│                                                             │
│                           [Back]  [Continue →]              │
│                                                             │
└─────────────────────────────────────────────────────────────┘

Step 3: Model Selection
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Step 2 of 3 · Transcription Quality                        │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ ◉ Large-v3 (Recommended)                      3.0 GB  │ │
│  │   Highest accuracy for legal, medical, professional   │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ ○ Turbo                                       1.5 GB  │ │
│  │   Great accuracy, faster processing                   │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ ○ Base                                        142 MB  │ │
│  │   Good for quick notes, casual use                    │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ ○ Minimal                                     0 MB    │ │
│  │   Use bundled model, upgrade anytime in Settings      │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│                           [Back]  [Download & Continue →]   │
│                                                             │
└─────────────────────────────────────────────────────────────┘

Step 4: Ready
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Step 3 of 3 · Ready!                                       │
│                                                             │
│                          ✓                                  │
│                                                             │
│  Verbatim Studio is ready to use.                           │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ ✓ Transcription engine           whisper-large-v3     │ │
│  │ ✓ Speaker identification         pyannote-3.1         │ │
│  │ ○ AI Summarization               Not installed        │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  💡 AI features like summarization and chat can be added    │
│     anytime from Settings → AI Models                       │
│                                                             │
│                              [Open Verbatim Studio →]       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Configuration File

```json
// ~/Library/Application Support/Verbatim Studio/config.json
{
  "version": 1,
  "setupComplete": true,
  "storagePath": "~/Documents/Verbatim Studio",
  "models": {
    "whisper": "large-v3",
    "diarization": "pyannote-3.1",
    "llm": null
  },
  "preferences": {
    "theme": "system",
    "defaultExportFormat": "docx"
  }
}
```

---

## Build & Packaging Pipeline

### Source Directory Structure

```
verbatim-studio/
├── apps/
│   └── electron/
│       ├── src/
│       │   ├── main/           # Electron main process
│       │   └── preload/        # Context bridge
│       ├── electron-builder.yml
│       └── package.json
├── packages/
│   ├── frontend/               # React app
│   │   ├── src/
│   │   └── package.json
│   └── backend/                # FastAPI (Python)
│       ├── api/
│       ├── services/
│       └── pyproject.toml
├── scripts/
│   ├── build-macos.sh          # Full build script
│   ├── bundle-python.sh        # Python runtime bundler
│   ├── bundle-binaries.sh      # whisper.cpp, llama.cpp
│   └── bundle-models.sh        # Bundled models
└── package.json                # Monorepo root (pnpm workspaces)
```

### Build Script

```bash
#!/bin/bash
# scripts/build-macos.sh

set -e

BUILD_DIR="build/macos-arm64"
RESOURCES_DIR="$BUILD_DIR/resources"

echo "=== Building Verbatim Studio for macOS ARM64 ==="

# 1. Clean
rm -rf $BUILD_DIR
mkdir -p $RESOURCES_DIR

# 2. Build frontend
echo "Building frontend..."
cd packages/frontend
pnpm build
cp -r dist $RESOURCES_DIR/renderer
cd ../..

# 3. Bundle Python runtime + backend
echo "Bundling Python..."
./scripts/bundle-python.sh $RESOURCES_DIR/python

# 4. Compile native binaries
echo "Building whisper.cpp..."
git clone --depth 1 https://github.com/ggerganov/whisper.cpp /tmp/whisper.cpp
cd /tmp/whisper.cpp
make -j clean
WHISPER_METAL=1 make -j server
cp server $RESOURCES_DIR/bin/whisper-server
cd -

echo "Building llama.cpp..."
git clone --depth 1 https://github.com/ggerganov/llama.cpp /tmp/llama.cpp
cd /tmp/llama.cpp
make -j clean
LLAMA_METAL=1 make -j server
cp server $RESOURCES_DIR/bin/llama-server
cd -

# 5. Bundle models
echo "Bundling models..."
./scripts/bundle-models.sh $RESOURCES_DIR/models

# 6. Build Electron app
echo "Packaging Electron..."
cd apps/electron
pnpm electron-builder --mac --arm64 \
  --config.directories.buildResources=../../$RESOURCES_DIR
cd ../..

echo "=== Build complete: dist/Verbatim Studio.dmg ==="
```

### electron-builder.yml

```yaml
appId: com.verbatimstudio.app
productName: Verbatim Studio

directories:
  output: ../../dist

mac:
  category: public.app-category.productivity
  target:
    - target: dmg
      arch: arm64
  icon: resources/icon.icns
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: entitlements.mac.plist
  entitlementsInherit: entitlements.mac.plist

extraResources:
  - from: "../../build/macos-arm64/resources"
    to: "."
    filter:
      - "**/*"

dmg:
  title: "Verbatim Studio"
  contents:
    - x: 130
      y: 220
    - x: 410
      y: 220
      type: link
      path: /Applications
```

### Entitlements

```xml
<!-- apps/electron/entitlements.mac.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.device.audio-input</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
</dict>
</plist>
```

### Final App Size

| Component | Size |
|-----------|------|
| Electron | ~150 MB |
| Python bundle | ~260 MB |
| whisper.cpp + llama.cpp binaries | ~5 MB |
| Bundled models (tiny + pyannote) | ~125 MB |
| Frontend | ~5 MB |
| **Total DMG** | **~550 MB** |

---

## Database Schema

```sql
-- Projects organize recordings
CREATE TABLE projects (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    description TEXT,
    template_id TEXT,
    metadata JSON DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Recordings (audio/video files)
CREATE TABLE recordings (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER,
    duration_seconds REAL,
    mime_type TEXT,
    metadata JSON DEFAULT '{}',
    status TEXT DEFAULT 'pending',  -- pending, processing, completed, failed
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transcripts linked to recordings
CREATE TABLE transcripts (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    language TEXT,
    model_used TEXT,
    confidence_avg REAL,
    word_count INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Individual segments (utterances with speaker + timing)
CREATE TABLE segments (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
    segment_index INTEGER NOT NULL,
    speaker TEXT,                    -- "Speaker 1", "Speaker 2", or custom name
    start_time REAL NOT NULL,        -- seconds
    end_time REAL NOT NULL,
    text TEXT NOT NULL,
    confidence REAL,
    edited BOOLEAN DEFAULT FALSE,    -- user has modified
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_segments_transcript ON segments(transcript_id, segment_index);

-- Speaker mappings (assign names to detected speakers)
CREATE TABLE speakers (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
    speaker_label TEXT NOT NULL,     -- "Speaker 1"
    speaker_name TEXT,               -- "John Smith"
    color TEXT,                      -- UI display color
    UNIQUE(transcript_id, speaker_label)
);

-- AI-generated summaries
CREATE TABLE summaries (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
    summary_type TEXT NOT NULL,      -- 'brief', 'detailed', 'bullets', 'action_items'
    content TEXT NOT NULL,
    model_used TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Export history
CREATE TABLE exports (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
    format TEXT NOT NULL,            -- 'docx', 'pdf', 'srt', 'vtt', 'txt'
    file_path TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Job queue (replaces Celery for Basic mode)
CREATE TABLE jobs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    job_type TEXT NOT NULL,          -- 'transcribe', 'diarize', 'summarize'
    status TEXT DEFAULT 'queued',    -- queued, running, completed, failed
    payload JSON NOT NULL,
    result JSON,
    error TEXT,
    progress REAL DEFAULT 0,         -- 0-100
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP
);
CREATE INDEX idx_jobs_status ON jobs(status, created_at);

-- App settings
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value JSON NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## API Structure

**Base URL**: `http://127.0.0.1:8000/api`

```
/api
├── /health                    GET     Health check
├── /config                    GET     App configuration
│
├── /projects
│   ├── /                      GET     List projects
│   ├── /                      POST    Create project
│   ├── /{id}                  GET     Get project
│   ├── /{id}                  PATCH   Update project
│   ├── /{id}                  DELETE  Delete project
│   └── /{id}/recordings       GET     List recordings in project
│
├── /recordings
│   ├── /                      GET     List all recordings
│   ├── /upload                POST    Upload audio/video file
│   ├── /{id}                  GET     Get recording details
│   ├── /{id}                  PATCH   Update recording
│   ├── /{id}                  DELETE  Delete recording
│   ├── /{id}/transcribe       POST    Start transcription job
│   └── /{id}/stream           GET     Stream audio file
│
├── /transcripts
│   ├── /{id}                  GET     Get full transcript
│   ├── /{id}/segments         GET     Get segments (paginated)
│   ├── /{id}/segments/{sid}   PATCH   Update segment text
│   ├── /{id}/speakers         GET     Get speaker mappings
│   ├── /{id}/speakers/{label} PATCH   Update speaker name
│   └── /{id}/export/{format}  GET     Export transcript
│
├── /ai
│   ├── /summarize             POST    Generate summary
│   ├── /chat                  POST    Chat about transcript
│   └── /search                POST    Semantic search
│
├── /jobs
│   ├── /                      GET     List jobs
│   ├── /{id}                  GET     Get job status
│   └── /{id}/cancel           POST    Cancel job
│
├── /models
│   ├── /                      GET     List installed models
│   ├── /available             GET     List downloadable models
│   ├── /download              POST    Start model download
│   └── /download/{id}         DELETE  Cancel download
│
└── /ws
    ├── /transcribe            WS      Real-time transcription
    └── /jobs/{id}             WS      Job progress updates
```

---

## Frontend Structure

```
packages/frontend/
├── src/
│   ├── app/
│   │   ├── App.tsx                 # Root component, routing
│   │   ├── Layout.tsx              # Main app shell
│   │   └── providers.tsx           # React Query, Theme
│   │
│   ├── pages/
│   │   ├── setup/
│   │   │   ├── WelcomePage.tsx
│   │   │   ├── StoragePage.tsx
│   │   │   ├── ModelsPage.tsx
│   │   │   └── ReadyPage.tsx
│   │   ├── dashboard/
│   │   │   └── DashboardPage.tsx
│   │   ├── recordings/
│   │   │   ├── RecordingsPage.tsx
│   │   │   ├── UploadPage.tsx
│   │   │   └── RecordPage.tsx
│   │   ├── transcript/
│   │   │   └── TranscriptPage.tsx
│   │   ├── projects/
│   │   │   ├── ProjectsPage.tsx
│   │   │   └── ProjectPage.tsx
│   │   └── settings/
│   │       ├── SettingsPage.tsx
│   │       ├── ModelsSettings.tsx
│   │       └── GeneralSettings.tsx
│   │
│   ├── components/
│   │   ├── ui/                     # shadcn/ui components
│   │   ├── transcript/
│   │   │   ├── TranscriptEditor.tsx
│   │   │   ├── SegmentRow.tsx
│   │   │   ├── SpeakerBadge.tsx
│   │   │   ├── Waveform.tsx
│   │   │   └── TimeCode.tsx
│   │   ├── recording/
│   │   │   ├── AudioPlayer.tsx
│   │   │   ├── RecordingCard.tsx
│   │   │   └── LiveRecorder.tsx
│   │   ├── ai/
│   │   │   ├── SummaryPanel.tsx
│   │   │   ├── ChatPanel.tsx
│   │   │   └── SearchResults.tsx
│   │   └── layout/
│   │       ├── Sidebar.tsx
│   │       ├── Header.tsx
│   │       └── JobsIndicator.tsx
│   │
│   ├── lib/
│   │   ├── api.ts
│   │   ├── electron.ts
│   │   ├── audio.ts
│   │   └── utils.ts
│   │
│   ├── hooks/
│   │   ├── useRecording.ts
│   │   ├── useTranscript.ts
│   │   ├── useJobs.ts
│   │   └── useModels.ts
│   │
│   └── types/
│       └── index.ts
│
├── index.html
├── vite.config.ts
├── tailwind.config.ts
└── package.json
```

---

## Path to Enterprise

### What Changes

| Component | Basic Mode | Enterprise Mode |
|-----------|------------|-----------------|
| Database | SQLite (local file) | PostgreSQL (server) |
| Job Queue | ThreadPoolExecutor | Celery + Redis |
| Auth | None (implicit user) | JWT + RBAC |
| Backend | Electron subprocess | Docker container(s) |
| Frontend | Electron renderer | Browser + Electron thin client |
| Models | User machine | Centralized server |
| Storage | Local filesystem | S3-compatible / NFS |

### Abstraction for Both Modes

```python
# packages/backend/core/config.py

class Settings(BaseSettings):
    MODE: Literal["basic", "enterprise"] = "basic"
    DATABASE_URL: str = "sqlite:///./verbatim.db"
    AUTH_ENABLED: bool = False
    CELERY_BROKER_URL: str | None = None

    @property
    def use_celery(self) -> bool:
        return self.MODE == "enterprise" and self.CELERY_BROKER_URL
```

```python
# packages/backend/services/jobs.py

class JobQueue:
    @classmethod
    async def enqueue(cls, job_type: str, payload: dict) -> Job:
        settings = get_settings()

        if settings.use_celery:
            from .celery_tasks import run_job
            task = run_job.delay(job_type, payload)
            return Job(id=task.id, status="queued", ...)
        else:
            job = await Job.create(job_type=job_type, payload=payload)
            executor.submit(run_job_sync, job.id)
            return job
```

---

## Implementation Phases

### Phase 1: Foundation
- Monorepo setup (pnpm workspaces)
- Electron shell with basic window
- FastAPI skeleton with health check
- SQLite database + migrations
- Python bundling script (proof of concept)

### Phase 2: Core Transcription
- File upload + storage
- whisper.cpp integration (batch mode first)
- Basic transcript viewer (read-only)
- Jobs queue (ThreadPoolExecutor)

### Phase 3: Speaker Diarization
- Pyannote integration
- Speaker assignment to segments
- Speaker renaming UI

### Phase 4: Transcript Editor
- Segment editing
- Audio player with sync
- Waveform visualization
- Keyboard navigation

### Phase 5: Real-Time Transcription
- Microphone capture
- WebSocket streaming
- whisper.cpp streaming mode
- Live transcript display

### Phase 6: AI Features
- llama.cpp integration
- Summarization
- Chat interface
- Semantic search (embeddings)

### Phase 7: Polish & Export
- Export formats (DOCX, PDF, SRT, VTT)
- Projects & organization
- Settings UI
- Model management UI

### Phase 8: Build & Distribution
- Full build pipeline
- Code signing
- DMG creation
- Auto-updater

---

## Appendix: Future Platform Support

### Windows (Future)
- CUDA support for NVIDIA GPUs
- NSIS installer instead of DMG
- Windows-specific entitlements

### Linux (Future)
- AppImage or Flatpak distribution
- CUDA for NVIDIA, ROCm for AMD
- PulseAudio/PipeWire for audio capture

### Architecture
The design supports cross-platform by:
1. Native binary compilation per platform (whisper.cpp, llama.cpp)
2. Platform-specific Python bundles (python-build-standalone)
3. Electron's cross-platform capabilities
4. Abstract file paths and OS-specific code in Electron main process
