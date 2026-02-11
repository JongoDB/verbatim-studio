# Windows x64 + CUDA Build Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a Windows x64 build of Verbatim Studio with NVIDIA CUDA GPU acceleration and CPU fallback, packaged as an NSIS installer (~1.2GB), built via GitHub Actions CI/CD.

**Architecture:** Add Windows as a second platform target alongside macOS arm64. WhisperX replaces MLX Whisper as the primary GPU engine on Windows (CUDA). All existing cross-platform detection logic (torch.cuda, pyannote, llama.cpp) works as-is. New build scripts handle CUDA library bundling and CTranslate2 model preparation.

**Tech Stack:** Electron + electron-builder (NSIS), Python 3.12 standalone (x64), PyTorch 2.8.0+cu121, WhisperX, CUDA 12.1, GitHub Actions (windows-latest)

**Ref:** Design doc at `docs/plans/2026-02-10-windows-build-design.md`, GitHub issue #117.

---

### Task 1: Add Windows data directory to Python config

**Files:**
- Modify: `packages/backend/core/config.py:24`

**Context:** Currently `DATA_DIR` is hardcoded to `~/Library/Application Support/Verbatim Studio` (macOS). Windows needs `%APPDATA%/Verbatim Studio`. The Electron shell sets `VERBATIM_DATA_DIR` env var for the packaged app, so this default is only used in standalone development.

**Step 1: Modify the DATA_DIR default to be platform-aware**

In `packages/backend/core/config.py`, change the `DATA_DIR` field from a hardcoded macOS path to a platform-conditional default:

```python
import sys

# ... inside Settings class, replace:
#   DATA_DIR: Path = Path.home() / "Library" / "Application Support" / "Verbatim Studio"
# with:

def _default_data_dir() -> Path:
    """Platform-specific data directory."""
    if sys.platform == "win32":
        # %APPDATA%/Verbatim Studio (e.g., C:\Users\X\AppData\Roaming\Verbatim Studio)
        appdata = os.environ.get("APPDATA")
        if appdata:
            return Path(appdata) / "Verbatim Studio"
        return Path.home() / "AppData" / "Roaming" / "Verbatim Studio"
    return Path.home() / "Library" / "Application Support" / "Verbatim Studio"
```

Then use `DATA_DIR: Path = _default_data_dir()` as the field default.

Note: Add `import os` at the top of the file.

**Step 2: Verify no other hardcoded macOS paths exist**

Search `packages/backend/` for `Library/Application Support` — config.py should be the only occurrence.

**Step 3: Commit**

```bash
git add packages/backend/core/config.py
git commit -m "feat(windows): add platform-aware data directory in config.py

Windows uses %APPDATA%/Verbatim Studio, macOS keeps ~/Library/Application Support.
The Electron shell overrides this via VERBATIM_DATA_DIR in production.

Refs #117"
```

---

### Task 2: Add platform guard on MLX Whisper import in factory.py

**Files:**
- Modify: `packages/backend/core/factory.py:149-159` and `packages/backend/core/factory.py:326-336`

**Context:** `factory.py` has two places that import `MlxWhisperTranscriptionEngine`. On Windows, this import will fail since `mlx-whisper` is not installed. The engine auto-detection in `transcription_settings.py` already returns `"whisperx"` on non-Apple systems, but if someone explicitly sets engine to `"mlx-whisper"` on Windows, the import would crash.

**Step 1: Add platform guard before MLX Whisper imports**

In both `create_transcription_engine()` (line ~149) and `create_transcription_engine_from_settings()` (line ~326), wrap the MLX Whisper branch:

```python
if engine == "mlx-whisper":
    if sys.platform != "darwin":
        raise RuntimeError(
            "MLX Whisper is only available on macOS. "
            "Use engine='whisperx' or engine='auto' on Windows/Linux."
        )
    from adapters.transcription.mlx_whisper import MlxWhisperTranscriptionEngine
    # ... rest of MLX creation
```

Add `import sys` at the top (it's not currently imported).

**Step 2: Commit**

```bash
git add packages/backend/core/factory.py
git commit -m "feat(windows): add platform guard on MLX Whisper import

Prevents crash if engine is explicitly set to mlx-whisper on non-macOS.
Auto-detection already avoids this path, but explicit config should fail clearly.

Refs #117"
```

---

### Task 3: Add CTranslate2 model entries to whisper_catalog.py

**Files:**
- Modify: `packages/backend/core/whisper_catalog.py`

**Context:** The catalog currently only lists MLX-format models (used on macOS). Windows uses CTranslate2-format models via WhisperX. We need to add entries for these and make `is_model_downloaded()` work for both formats.

**Step 1: Add CTranslate2 model list and platform-aware functions**

Add a parallel `WHISPER_MODELS_CT2` list alongside the existing `WHISPER_MODELS` (rename existing to `WHISPER_MODELS_MLX` for clarity internally, but keep backward compat). Add a function to get the right list based on platform:

```python
import sys

# CTranslate2 models for WhisperX on Windows/Linux
WHISPER_MODELS_CT2: list[WhisperModel] = [
    {
        "id": "whisper-tiny",
        "label": "Whisper Tiny",
        "description": "Fastest, lowest accuracy. Good for quick drafts.",
        "repo": "Systran/faster-whisper-tiny",
        "size_bytes": 74_000_000,
        "is_default": False,
        "bundled": False,
    },
    {
        "id": "whisper-base",
        "label": "Whisper Base",
        "description": "Good balance of speed and accuracy. Bundled with app.",
        "repo": "Systran/faster-whisper-base",
        "size_bytes": 145_000_000,
        "is_default": True,
        "bundled": True,
    },
    {
        "id": "whisper-small",
        "label": "Whisper Small",
        "description": "Better accuracy, slower processing.",
        "repo": "Systran/faster-whisper-small",
        "size_bytes": 484_000_000,
        "is_default": False,
        "bundled": False,
    },
    {
        "id": "whisper-medium",
        "label": "Whisper Medium",
        "description": "High accuracy for difficult audio.",
        "repo": "Systran/faster-whisper-medium",
        "size_bytes": 1_530_000_000,
        "is_default": False,
        "bundled": False,
    },
    {
        "id": "whisper-large-v3",
        "label": "Whisper Large v3",
        "description": "Best accuracy. Requires 8GB+ RAM.",
        "repo": "Systran/faster-whisper-large-v3",
        "size_bytes": 3_100_000_000,
        "is_default": False,
        "bundled": False,
    },
]


def get_platform_models() -> list[WhisperModel]:
    """Get the model list appropriate for this platform."""
    if sys.platform == "darwin":
        return WHISPER_MODELS
    return WHISPER_MODELS_CT2
```

**Step 2: Update helper functions to be platform-aware**

Update `get_whisper_model()`, `get_default_whisper_model()`, and `is_model_downloaded()` to use `get_platform_models()`:

```python
def get_whisper_model(model_id: str) -> WhisperModel | None:
    """Get a whisper model by ID."""
    for model in get_platform_models():
        if model["id"] == model_id:
            return model
    return None
```

For `is_model_downloaded()`, CTranslate2 models use a `model.bin` file instead of `weights.npz`:

```python
def is_model_downloaded(model_id: str) -> bool:
    model = get_whisper_model(model_id)
    if not model:
        return False
    cache_path = get_model_cache_path(model["repo"])
    if not cache_path.exists():
        return False
    snapshots_dir = cache_path / "snapshots"
    if not snapshots_dir.exists():
        return False
    for snapshot in snapshots_dir.iterdir():
        if snapshot.is_dir():
            # MLX models use weights.npz, CTranslate2 models use model.bin
            if (snapshot / "weights.npz").exists() or (snapshot / "model.bin").exists():
                return True
    return False
```

**Step 3: Commit**

```bash
git add packages/backend/core/whisper_catalog.py
git commit -m "feat(windows): add CTranslate2 whisper model catalog for WhisperX

Adds Systran/faster-whisper-* model entries used by WhisperX on Windows.
Platform-aware helpers select MLX models on macOS, CTranslate2 on Windows.

Refs #117"
```

---

### Task 4: Add CUDA PATH injection and Windows process handling in backend.ts

**Files:**
- Modify: `apps/electron/src/main/backend.ts:56-81` (env/PATH setup)
- Modify: `apps/electron/src/main/backend.ts:128-158` (stop method)

**Context:** The backend spawner needs two Windows changes: (1) prepend bundled CUDA DLLs to PATH so PyTorch can find them, and (2) use Windows-compatible process termination (taskkill) since SIGTERM/SIGKILL aren't reliable on Windows.

**Step 1: Add CUDA PATH injection in the `start()` method**

After the existing `extendedPath` construction (line ~67), add a Windows branch:

```typescript
// Build PATH based on platform
let resolvedPath: string;
if (process.platform === 'win32') {
  // Windows: add CUDA libs to PATH for PyTorch/llama.cpp
  const cudaPath = path.join(process.resourcesPath, 'cuda');
  resolvedPath = [cudaPath, process.env.PATH || ''].join(';');
} else {
  // macOS/Linux: add common binary paths
  const additionalPaths = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/opt/local/bin',
    '/opt/local/sbin',
  ];
  const currentPath = process.env.PATH || '/usr/bin:/bin';
  resolvedPath = [...additionalPaths, currentPath].join(':');
}
```

Then use `resolvedPath` instead of `extendedPath` in the env object.

**Step 2: Add Windows process termination in `stop()` and `forceKill()`**

Replace the SIGTERM/SIGKILL with platform-aware termination:

```typescript
async stop(): Promise<void> {
  if (this.healthCheckInterval) {
    clearInterval(this.healthCheckInterval);
    this.healthCheckInterval = null;
  }
  if (!this.process || this.isStopping) return;
  this.isStopping = true;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (this.process) {
        console.log('[Backend] Force killing');
        this.killProcess(true);
      }
      this.isStopping = false;
      this._port = null;
      resolve();
    }, 5000);

    this.process!.on('exit', () => {
      clearTimeout(timeout);
      this.isStopping = false;
      this._port = null;
      resolve();
    });

    console.log('[Backend] Stopping process');
    this.killProcess(false);
  });
}

private killProcess(force: boolean): void {
  if (!this.process?.pid) return;

  if (process.platform === 'win32') {
    // Windows: use taskkill to kill the process tree
    const flag = force ? '/F' : '';
    try {
      spawn('taskkill', [flag, '/T', '/PID', String(this.process.pid)].filter(Boolean), {
        stdio: 'ignore',
      });
    } catch (err) {
      console.error('[Backend] taskkill failed:', err);
      this.process.kill(); // Fallback
    }
  } else {
    this.process.kill(force ? 'SIGKILL' : 'SIGTERM');
  }
}

forceKill(): void {
  this.killProcess(true);
}
```

**Step 3: Commit**

```bash
git add apps/electron/src/main/backend.ts
git commit -m "feat(windows): add CUDA PATH injection and Windows process termination

- Prepend bundled CUDA DLLs directory to PATH on Windows
- Use taskkill /T for process tree termination on Windows
- Keep SIGTERM/SIGKILL for macOS/Linux

Refs #117"
```

---

### Task 5: Add Windows model cache paths in bootstrap-models.ts

**Files:**
- Modify: `apps/electron/src/main/bootstrap-models.ts`

**Context:** The bootstrap module copies bundled whisper models to the HuggingFace cache on first launch. On macOS it uses `~/.cache/huggingface/hub/`. On Windows, HuggingFace defaults to `%USERPROFILE%/.cache/huggingface/hub/`. Additionally, we need a CTranslate2 model entry for Windows alongside the MLX entry.

**Step 1: Add platform-aware model definitions and cache directory**

```typescript
const BUNDLED_MODELS = process.platform === 'win32'
  ? [
      {
        name: 'whisper-base-ct2',
        source: 'whisper-models/huggingface/hub/models--Systran--faster-whisper-base',
        destination: 'huggingface/hub/models--Systran--faster-whisper-base',
      },
    ]
  : [
      {
        name: 'whisper-base-mlx',
        source: 'whisper-models/huggingface/hub/models--mlx-community--whisper-base-mlx',
        destination: 'huggingface/hub/models--mlx-community--whisper-base-mlx',
      },
    ];

function getCacheDir(): string {
  // HuggingFace uses ~/.cache on all platforms (including Windows)
  return path.join(app.getPath('home'), '.cache');
}
```

The `getCacheDir()` function stays the same — HuggingFace uses `~/.cache` on Windows too (not `%APPDATA%`).

**Step 2: Commit**

```bash
git add apps/electron/src/main/bootstrap-models.ts
git commit -m "feat(windows): add CTranslate2 model bootstrap for Windows

Windows bundles Systran/faster-whisper-base (CTranslate2 format) instead
of mlx-community/whisper-base-mlx. Bootstrap copies to HF cache on first launch.

Refs #117"
```

---

### Task 6: Create Windows ML requirements file

**Files:**
- Create: `scripts/requirements-ml-windows.txt`

**Context:** Windows needs PyTorch from the CUDA 12.1 index and cannot include `mlx-whisper`. Everything else stays the same as the macOS requirements.

**Step 1: Create the requirements file**

```txt
# ML dependencies for Windows x64 + CUDA
# Mirrors requirements-ml.txt but:
# - Removes mlx-whisper (Apple Silicon only)
# - Sources PyTorch from CUDA 12.1 index

# =============================================================================
# PyTorch ecosystem - CUDA 12.1
# Install with: --extra-index-url https://download.pytorch.org/whl/cu121
# =============================================================================
torch==2.8.0+cu121
torchaudio==2.8.0+cu121
torchvision==0.23.0+cu121

# =============================================================================
# HuggingFace ecosystem - version-critical for whisperx compatibility
# =============================================================================
huggingface_hub==0.36.1
transformers==4.48.0

# =============================================================================
# Transcription engines
# =============================================================================
# WhisperX for CUDA GPU transcription and alignment (no mlx-whisper on Windows)
whisperx==3.3.4

# =============================================================================
# Speaker diarization
# =============================================================================
pyannote.audio==3.3.2
pyannote-core==5.0.0
pyannote-database==5.1.3
pyannote-pipeline==3.0.1
pyannote-metrics==3.2.1

# =============================================================================
# Vision/OCR models
# =============================================================================
qwen-vl-utils==0.0.8
accelerate==1.3.0

# =============================================================================
# Semantic search embeddings
# =============================================================================
sentence-transformers==3.4.1

# =============================================================================
# Other ML dependencies with strict pins
# =============================================================================
numpy==2.0.2
```

**Step 2: Commit**

```bash
git add scripts/requirements-ml-windows.txt
git commit -m "feat(windows): add Windows ML requirements with CUDA PyTorch

Fork of requirements-ml.txt for Windows:
- PyTorch from CUDA 12.1 index (torch+cu121)
- No mlx-whisper (Apple Silicon only)
- All other versions identical

Refs #117"
```

---

### Task 7: Add Windows+CUDA branch to install-bundled-deps.sh

**Files:**
- Modify: `scripts/install-bundled-deps.sh:87-124`

**Context:** The install script already detects Windows platform and excludes mlx-whisper, but it doesn't install from the CUDA PyTorch index. We need a dedicated Windows+CUDA branch that uses the Windows requirements file and the CUDA index URL.

**Step 1: Add Windows+CUDA installation branch**

Replace the existing `else` branch (non-Apple) with a three-way branch:

```bash
if [ "$PLATFORM" = "macos" ] && [ "$ARCH" = "arm64" ]; then
  echo "Installing for Apple Silicon (includes mlx-whisper)..."
  # ... existing macOS code unchanged ...

elif [ "$PLATFORM" = "windows" ]; then
  echo "Installing for Windows x64 (CUDA PyTorch)..."

  REQUIREMENTS_ML_WIN="$SCRIPT_DIR/requirements-ml-windows.txt"
  CUDA_INDEX="https://download.pytorch.org/whl/cu121"

  # Step 1: Install the pinned packages without their dependencies
  "$PYTHON_BIN" -m pip install \
    --target "$SITE_PACKAGES" \
    --no-deps \
    --extra-index-url "$CUDA_INDEX" \
    -r "$REQUIREMENTS_ML_WIN"

  # Step 2: Install missing sub-dependencies with constraints
  "$PYTHON_BIN" -m pip install \
    --target "$SITE_PACKAGES" \
    --constraint "$REQUIREMENTS_ML_WIN" \
    --extra-index-url "$CUDA_INDEX" \
    -r "$REQUIREMENTS_ML_WIN"

else
  echo "Installing for ${PLATFORM}-${ARCH} (excludes mlx-whisper)..."
  # ... existing Linux/generic code unchanged ...
fi
```

**Step 2: Update verification section to skip mlx-whisper on Windows**

Change the `mlx-whisper` version check guard from `macos && arm64` to also handle Windows:

```bash
# Apple Silicon specific
if [ "$PLATFORM" = "macos" ] && [ "$ARCH" = "arm64" ]; then
  verify_version "mlx-whisper" "0.4.3" || FAILED=1
fi

# Windows CUDA specific
if [ "$PLATFORM" = "windows" ]; then
  echo "Verifying CUDA PyTorch variant..."
  # torch+cu121 reports as torch 2.8.0 in pip list
  verify_version "torch" "2.8.0" || FAILED=1
fi
```

**Step 3: Commit**

```bash
git add scripts/install-bundled-deps.sh
git commit -m "feat(windows): add Windows+CUDA branch to install-bundled-deps.sh

Uses requirements-ml-windows.txt with --extra-index-url for CUDA PyTorch.
Skips mlx-whisper verification on Windows.

Refs #117"
```

---

### Task 8: Create CUDA runtime DLL bundling script

**Files:**
- Create: `scripts/bundle-cuda-libs.sh`

**Context:** PyTorch ships its own CUDA libs, but we need to ensure the CUDA runtime DLLs are findable by all ML components. This script stages them from the CUDA Toolkit (installed via CI action) into `build/resources/cuda/`.

**Step 1: Create the script**

```bash
#!/bin/bash
set -e

# Bundle CUDA runtime DLLs for Windows installer
# This copies required DLLs from the CUDA Toolkit installation
# so they can be included in the Electron app's extraResources.
#
# Usage: ./scripts/bundle-cuda-libs.sh
# Expects CUDA Toolkit to be installed (e.g., via Jimver/cuda-toolkit CI action)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_ROOT/build/resources/cuda"

echo "=== Bundling CUDA Runtime Libraries ==="

# Find CUDA installation
if [ -n "$CUDA_PATH" ]; then
  CUDA_DIR="$CUDA_PATH"
elif [ -d "/c/Program Files/NVIDIA GPU Computing Toolkit/CUDA" ]; then
  # Find the latest CUDA version
  CUDA_DIR=$(ls -d "/c/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v"* 2>/dev/null | sort -V | tail -1)
elif [ -d "C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA" ]; then
  CUDA_DIR=$(ls -d "C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v"* 2>/dev/null | sort -V | tail -1)
else
  echo "Warning: CUDA Toolkit not found. PyTorch bundles its own CUDA libs."
  echo "Creating empty cuda directory for extraResources..."
  mkdir -p "$OUTPUT_DIR"
  exit 0
fi

echo "CUDA Toolkit: $CUDA_DIR"
echo "Output: $OUTPUT_DIR"

mkdir -p "$OUTPUT_DIR"

# Copy CUDA runtime DLLs
# These are the minimum DLLs needed by PyTorch and llama.cpp
CUDA_BIN="$CUDA_DIR/bin"
DLL_PATTERNS=(
  "cublas64_*.dll"
  "cublasLt64_*.dll"
  "cudart64_*.dll"
  "cudnn*.dll"
  "cufft64_*.dll"
  "curand64_*.dll"
  "cusparse64_*.dll"
  "nvrtc64_*.dll"
)

COPIED=0
for pattern in "${DLL_PATTERNS[@]}"; do
  for dll in "$CUDA_BIN"/$pattern; do
    if [ -f "$dll" ]; then
      cp "$dll" "$OUTPUT_DIR/"
      echo "  Copied: $(basename "$dll")"
      COPIED=$((COPIED + 1))
    fi
  done
done

echo ""
echo "=== Done: $COPIED DLLs copied ==="
if [ $COPIED -gt 0 ]; then
  du -sh "$OUTPUT_DIR"
else
  echo "Note: No CUDA DLLs found. PyTorch includes its own — this may be fine."
fi
```

**Step 2: Make executable**

```bash
chmod +x scripts/bundle-cuda-libs.sh
```

**Step 3: Commit**

```bash
git add scripts/bundle-cuda-libs.sh
git commit -m "feat(windows): add CUDA runtime DLL bundling script

Copies CUDA DLLs from toolkit installation to build/resources/cuda/
for inclusion in the Windows installer via extraResources.

Refs #117"
```

---

### Task 9: Create Windows whisper model preparation script

**Files:**
- Create: `scripts/prepare-whisper-models-windows.sh`

**Context:** The macOS script downloads MLX-format whisper-base. Windows needs CTranslate2-format whisper-base (`Systran/faster-whisper-base`).

**Step 1: Create the script**

```bash
#!/bin/bash
set -e

# Prepare CTranslate2-format Whisper models for bundling with Windows Electron app.
# Downloads Systran/faster-whisper-base from HuggingFace.
#
# Usage: ./scripts/prepare-whisper-models-windows.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_ROOT/build/resources/whisper-models"

echo "=== Preparing Whisper Models for Windows Bundling ==="
echo "Output directory: $OUTPUT_DIR"

# Find the Python binary
PYTHON_DIR="$PROJECT_ROOT/build/python-standalone/python-windows-x64"
if [ -f "$PYTHON_DIR/python.exe" ]; then
    PYTHON_BIN="$PYTHON_DIR/python.exe"
    SITE_PACKAGES="$PYTHON_DIR/Lib/site-packages"
    export PYTHONPATH="$SITE_PACKAGES:$PYTHONPATH"
    echo "Using bundled Python: $PYTHON_BIN"
else
    PYTHON_BIN="python3"
    echo "Using system Python: $PYTHON_BIN"
    "$PYTHON_BIN" -c "import huggingface_hub" 2>/dev/null || {
        echo "Installing huggingface_hub..."
        "$PYTHON_BIN" -m pip install --quiet huggingface_hub
    }
fi

# Create output directories
mkdir -p "$OUTPUT_DIR/huggingface/hub"

# Download CTranslate2-format Whisper Base
REPO="Systran/faster-whisper-base"
DEST_NAME="models--Systran--faster-whisper-base"
DEST_DIR="$OUTPUT_DIR/huggingface/hub/$DEST_NAME"

echo ""
echo "--- Downloading $REPO (CTranslate2 format) ---"

if [ -d "$DEST_DIR" ] && [ "$(ls -A "$DEST_DIR" 2>/dev/null)" ]; then
    echo "Model already exists at $DEST_DIR, skipping..."
else
    TEMP_CACHE=$(mktemp -d)

    HF_HOME="$TEMP_CACHE" "$PYTHON_BIN" -c "
from huggingface_hub import snapshot_download

repo_id = '$REPO'
cache_dir = '$TEMP_CACHE/hub'

print(f'Downloading {repo_id}...')
local_dir = snapshot_download(
    repo_id=repo_id,
    cache_dir=cache_dir,
    local_dir=None,
)
print(f'Downloaded to: {local_dir}')
"

    REPO_DASHED=$(echo "$REPO" | sed 's/\//--/g')
    TEMP_MODEL_DIR="$TEMP_CACHE/hub/models--$REPO_DASHED"

    if [ -d "$TEMP_MODEL_DIR" ]; then
        mkdir -p "$(dirname "$DEST_DIR")"
        mv "$TEMP_MODEL_DIR" "$DEST_DIR"
        echo "Moved to: $DEST_DIR"
    else
        echo "ERROR: Could not find downloaded model"
        rm -rf "$TEMP_CACHE"
        exit 1
    fi

    rm -rf "$TEMP_CACHE"
fi

echo ""
echo "=== Model Preparation Complete ==="
echo "Models prepared in: $OUTPUT_DIR"
du -sh "$OUTPUT_DIR"
```

**Step 2: Make executable**

```bash
chmod +x scripts/prepare-whisper-models-windows.sh
```

**Step 3: Commit**

```bash
git add scripts/prepare-whisper-models-windows.sh
git commit -m "feat(windows): add CTranslate2 whisper model preparation script

Downloads Systran/faster-whisper-base for Windows WhisperX bundling.
Mirrors prepare-whisper-models.sh but uses CTranslate2 format.

Refs #117"
```

---

### Task 10: Update electron-builder config for Windows

**Files:**
- Modify: `apps/electron/package.json`

**Context:** The `package.json` already has a `win` section in the build config with NSIS target. We need to add the CUDA `extraResources` entry and NSIS-specific installer options.

**Step 1: Add CUDA extraResources and NSIS config**

In the `build` section of `apps/electron/package.json`, add a platform-conditional CUDA resource entry and NSIS options:

```json
"extraResources": [
  // ... existing entries ...
  {
    "from": "../../build/resources/cuda",
    "to": "cuda",
    "filter": ["**/*"]
  }
],
"nsis": {
  "oneClick": false,
  "perMachine": false,
  "allowToChangeInstallationDirectory": true,
  "deleteAppDataOnUninstall": false
},
```

Note: The CUDA `extraResources` entry is harmless on macOS (empty/missing dir is skipped). The `nsis` config only applies to Windows builds.

Also add `requirements-ml-windows.txt` to extraResources:

```json
{
  "from": "../../scripts/requirements-ml-windows.txt",
  "to": "requirements-ml-windows.txt"
}
```

**Step 2: Commit**

```bash
git add apps/electron/package.json
git commit -m "feat(windows): add CUDA extraResources and NSIS config

- Bundle build/resources/cuda/ directory for CUDA DLLs
- Add NSIS installer options (allow custom install dir, keep app data)
- Bundle Windows ML requirements file

Refs #117"
```

---

### Task 11: Add Windows matrix entry to CI workflow

**Files:**
- Modify: `.github/workflows/build-electron.yml`

**Context:** The existing workflow has a matrix with only macOS arm64 active. We need to add a Windows x64 entry with CUDA toolkit installation, Windows-specific build steps, and artifact upload.

**Step 1: Add Windows to the matrix**

```yaml
matrix:
  include:
    - os: macos-14
      arch: arm64
      platform: darwin
    - os: windows-latest
      arch: x64
      platform: win32
```

**Step 2: Add conditional steps for CUDA toolkit and Windows-specific builds**

After "Setup pnpm cache", add:

```yaml
# Windows: Install CUDA Toolkit
- name: Install CUDA Toolkit
  if: matrix.platform == 'win32'
  uses: Jimver/cuda-toolkit@v0.2.19
  id: cuda-toolkit
  with:
    cuda: '12.1.0'
    method: 'network'
    sub-packages: '["cudart", "cublas", "cufft", "curand", "cusparse", "nvrtc", "cudnn"]'
```

**Step 3: Update Python cache key to include platform**

```yaml
key: ${{ runner.os }}-${{ matrix.arch }}-python-ml-${{ hashFiles('scripts/requirements-core.txt', 'scripts/requirements-ml.txt', 'scripts/requirements-ml-windows.txt', 'scripts/install-bundled-deps.sh') }}
```

**Step 4: Update verification step to be platform-aware**

Make the "Verify Python dependencies" step work on both platforms:

```yaml
- name: Verify Python dependencies (strict version check)
  shell: bash
  run: |
    if [ "${{ matrix.platform }}" = "win32" ]; then
      PYTHON_BIN="build/python-standalone/python-windows-x64/python.exe"
      SITE_PACKAGES="build/python-standalone/python-windows-x64/Lib/site-packages"
    else
      PYTHON_BIN="build/python-standalone/python-macos-arm64/bin/python3"
      SITE_PACKAGES="build/python-standalone/python-macos-arm64/lib/python3.12/site-packages"
    fi
    # ... rest of verification with platform checks ...
```

Skip `mlx-whisper` check on Windows, skip CUDA-specific checks on macOS.

**Step 5: Add Windows-specific build steps**

```yaml
# Windows: Bundle CUDA libs
- name: Bundle CUDA runtime libraries
  if: matrix.platform == 'win32'
  shell: bash
  run: ./scripts/bundle-cuda-libs.sh

# Windows: Prepare CTranslate2 whisper models
- name: Prepare Whisper models (Windows)
  if: matrix.platform == 'win32' && steps.whisper-cache.outputs.cache-hit != 'true'
  shell: bash
  run: ./scripts/prepare-whisper-models-windows.sh
  env:
    HF_HUB_DISABLE_PROGRESS_BARS: 1

# macOS: Prepare MLX whisper models (existing step, add condition)
- name: Prepare Whisper models for bundling
  if: matrix.platform == 'darwin' && steps.whisper-cache.outputs.cache-hit != 'true'
  shell: bash
  run: ./scripts/prepare-whisper-models.sh
```

**Step 6: Update whisper verification to be platform-aware**

```yaml
- name: Verify Whisper models are present
  shell: bash
  run: |
    if [ "${{ matrix.platform }}" = "win32" ]; then
      WHISPER_DIR="build/resources/whisper-models/huggingface/hub/models--Systran--faster-whisper-base"
      CHECK_FILE="model.bin"
    else
      WHISPER_DIR="build/resources/whisper-models/huggingface/hub/models--mlx-community--whisper-base-mlx"
      CHECK_FILE="weights.npz"
    fi
    # ... verification logic using $WHISPER_DIR ...
```

**Step 7: Update artifact upload to include Windows .exe**

```yaml
- name: Upload artifacts
  uses: actions/upload-artifact@v4
  with:
    name: verbatim-studio-${{ matrix.platform }}-${{ matrix.arch }}
    path: |
      dist/*.dmg
      dist/*.exe
    if-no-files-found: error
```

**Step 8: Update release job to handle both artifacts**

The release job should already work since it downloads all artifacts via `artifacts/**/*`.

**Step 9: Commit**

```bash
git add .github/workflows/build-electron.yml
git commit -m "feat(windows): add Windows x64+CUDA to CI build matrix

- Add windows-latest matrix entry with CUDA 12.1 toolkit
- Platform-aware Python verification (skip mlx-whisper on Windows)
- Windows-specific: CUDA DLL bundling, CTranslate2 model prep
- Upload .exe alongside .dmg artifacts

Refs #117"
```

---

### Task 12: Update error dialog text for Windows

**Files:**
- Modify: `apps/electron/src/main/index.ts:53`

**Context:** The error dialog says "Check Console.app for more details" which is macOS-specific.

**Step 1: Make the error hint platform-aware**

```typescript
const logHint = process.platform === 'darwin'
  ? 'Check Console.app for more details.'
  : 'Check the application logs for more details.';

dialog.showErrorBox(
  'Verbatim Studio - Startup Failed',
  `Failed to start backend:\n\n${error instanceof Error ? error.message : String(error)}\n\n${logHint}`
);
```

**Step 2: Commit**

```bash
git add apps/electron/src/main/index.ts
git commit -m "fix(windows): make error dialog text platform-aware

Replace macOS-specific 'Check Console.app' with generic hint on Windows.

Refs #117"
```

---

### Task 13: Final verification and integration commit

**Step 1: Verify all new and modified files**

Run through the checklist from issue #117:
- [ ] New files: `build-windows.yml` (or matrix entry), `bundle-cuda-libs.sh`, `requirements-ml-windows.txt`, `prepare-whisper-models-windows.sh`
- [ ] Modified files: `electron/package.json`, `backend.ts`, `bootstrap-models.ts`, `install-bundled-deps.sh`, `factory.py`, `whisper_catalog.py`, `config.py`
- [ ] CI workflow triggers on correct events
- [ ] Artifact upload includes `.exe`

**Step 2: Test locally what we can**

```bash
# Verify Python backend imports don't break on macOS
cd packages/backend
python3 -c "from core.config import settings; print(settings.DATA_DIR)"
python3 -c "from core.whisper_catalog import get_platform_models; print([m['id'] for m in get_platform_models()])"
python3 -c "from core.factory import AdapterFactory; print('factory imports ok')"
```

**Step 3: Push branch and open PR**

```bash
git push -u origin feat/windows-cuda-build
gh pr create --title "feat: Windows x64 build with NVIDIA CUDA support" \
  --body "Closes #117 ..."
```
