# Windows Build Design

**Date:** 2026-02-10
**Status:** Approved

## Overview

Ship a Windows x64 build of Verbatim Studio with NVIDIA CUDA GPU acceleration and CPU fallback, packaged as an NSIS installer (~1.2GB), built via GitHub Actions CI/CD.

## Scope

### What changes, what doesn't

- **Frontend (React/Vite):** No changes. Already platform-agnostic.
- **Electron main process:** Minor changes — Windows-specific paths already partially exist, need completion and testing.
- **Python backend (FastAPI):** Moderate changes — swap MLX Whisper for WhisperX+CUDA as the default GPU engine on Windows. WhisperX, pyannote, and llama.cpp already support CUDA.
- **Build system:** Major changes — new build scripts for Windows Python runtime, Windows FFmpeg, CUDA library bundling, NSIS packaging config, and GitHub Actions workflow.
- **Model catalog:** Minor changes — replace MLX model references with CTranslate2/WhisperX model variants for Windows.

### Platform targets

- **Architecture:** x86_64 only
- **GPU:** NVIDIA CUDA + CPU fallback
- **Installer:** NSIS (.exe)
- **CI/CD:** GitHub Actions with Windows runners

## GPU & ML Engine Strategy

### Transcription engine mapping

| macOS (current) | Windows (new) | Notes |
|---|---|---|
| MLX Whisper (Metal GPU) | WhisperX (CUDA GPU) | Both use Whisper models, different backends |
| WhisperX (CPU fallback) | WhisperX (CPU fallback) | Identical — already cross-platform |

WhisperX is already in the codebase and supports CUDA natively. On Windows, it becomes the primary engine instead of the fallback.

### Device detection logic

```
Windows + CUDA available → WhisperX with device="cuda", compute_type="float16"
Windows + no GPU         → WhisperX with device="cpu", compute_type="int8"
macOS + Apple Silicon    → MLX Whisper (unchanged)
macOS + no MLX           → WhisperX CPU (unchanged)
```

### Other ML components

- **Speaker diarization (pyannote):** Already supports CUDA. Existing `detect_diarization_device()` checks `torch.cuda.is_available()` first — works as-is on Windows.
- **LLM inference (llama.cpp):** `llama-cpp-python` already supports CUDA via `n_gpu_layers`. Existing auto-detection works. Only change: ensure pip installs the CUDA-enabled wheel (`CMAKE_ARGS="-DGGML_CUDA=on"`).
- **Model catalog:** Windows uses standard HuggingFace Whisper models (CTranslate2 format, e.g., `openai/whisper-base`) instead of MLX-optimized variants.

## Build Scripts & Resource Bundling

### Modified scripts

**`download-python-standalone.sh`** — Already handles Windows x64:
- Target: `cpython-3.12.8+20250106-x86_64-pc-windows-msvc-shared`
- Output: `build/python-standalone/python-windows-x64/`

**`install-bundled-deps.sh`** — Windows+CUDA branch:
- Skip `mlx-whisper` entirely (already implemented for non-Apple platforms)
- Install PyTorch with CUDA: `torch==2.8.0+cu121` from `https://download.pytorch.org/whl/cu121`
- Install `llama-cpp-python` with CUDA build flags
- Use Windows pip path conventions (`.exe`, `Lib/site-packages`)

**`download-ffmpeg.sh`** — Already handles Windows x64:
- Source: ffbinaries GitHub releases
- Downloads `ffmpeg.exe` and `ffprobe.exe`

### New scripts

**`scripts/bundle-cuda-libs.sh`** (runs on Windows CI):
- Copies required CUDA runtime DLLs from the installed CUDA Toolkit
- Required libraries: `cublas64_*.dll`, `cublasLt64_*.dll`, `cudnn*.dll`, `cudart64_*.dll`
- Stages into `build/resources/cuda/`

**`scripts/requirements-ml-windows.txt`**:
- Fork of `requirements-ml.txt` without `mlx-whisper`
- PyTorch sourced from CUDA 12.1 index
- Same strict version pins for everything else

**`scripts/prepare-whisper-models-windows.sh`**:
- Downloads CTranslate2-format whisper-base model instead of MLX format
- Same directory structure, different model files

### electron-builder config additions

```json
"win": {
  "icon": "assets/icon.png",
  "target": [{ "target": "nsis", "arch": ["x64"] }]
},
"extraResources": [
  // existing entries...
  {
    "from": "../../build/resources/cuda",
    "to": "cuda",
    "filter": ["**/*"]
  }
]
```

## Electron Main Process Changes

### `backend.ts` — Python process spawning

- **CUDA PATH injection:** Prepend CUDA libs directory to `PATH` in spawned Python process environment so PyTorch/llama.cpp can find CUDA DLLs:
  ```typescript
  if (process.platform === 'win32') {
    env.PATH = path.join(resourcesPath, 'cuda') + ';' + env.PATH;
  }
  ```
- **Process termination:** Windows doesn't support Unix signals cleanly. Use `taskkill` or `process.kill()` for the Python child process tree.
- **Firewall:** The backend binds to `127.0.0.1:45677`. Windows Defender may prompt on first launch. Consider adding a firewall exception in the NSIS installer or documenting it.

### `bootstrap-models.ts` — Model paths

- macOS: `~/Library/Application Support/Verbatim Studio`
- Windows: `%APPDATA%/Verbatim Studio`
- HuggingFace cache: `%USERPROFILE%/.cache/huggingface/hub/` (HF default on Windows)

### `index.ts` — App lifecycle

- Auto-updater: Configure `electron-updater` for NSIS update flow (`.exe` update files instead of `.zip`)

## Python Backend Changes

### `config.py` — Platform paths

- Add Windows data directory: `%APPDATA%/Verbatim Studio`
- Use `sys.platform == "win32"` check

### `factory.py` — Engine selection

- Platform guard on MLX Whisper import: wrap `from adapters.transcription.mlx_whisper import ...` in a `sys.platform == "darwin"` check
- Windows: never attempt MLX Whisper instantiation

### `whisper_catalog.py` — Model definitions

- Add CTranslate2 model entries alongside MLX models
- Same size tiers (tiny, base, small, medium, large-v3)
- CTranslate2 model IDs for WhisperX
- Engine field to distinguish which adapter uses which models

### Files that already work on Windows (no changes needed)

- `main.py` — Windows FFmpeg path handling exists
- `transcription_settings.py` — CUDA detection logic exists
- `whisperx.py` — CUDA support built in
- `llama_cpp.py` — CUDA via `n_gpu_layers` works
- `diarization.py` — CUDA device detection works
- `system.py` — CUDA memory clearing exists

## GitHub Actions CI/CD

### Workflow: `.github/workflows/build-windows.yml`

**Trigger:** Same as existing macOS build — tags (`v*`), PRs to main, workflow_dispatch.

**Runner:** `windows-latest` (Windows Server 2022)

**Steps:**

1. Checkout
2. Setup Node.js 20
3. Setup pnpm 9
4. Cache pnpm store
5. Cache Python environment (keyed on requirements + install script hash)
6. Install CUDA Toolkit via `Jimver/cuda-toolkit` action (pinned version, e.g., 12.1)
7. Install Node dependencies (`pnpm install`)
8. Download Python standalone (Windows x64)
9. Install bundled Python deps (Windows+CUDA branch)
10. Verify Python dependencies (skip mlx-whisper check)
11. Bundle CUDA runtime DLLs from installed toolkit
12. Cache + prepare Whisper models (CTranslate2 format)
13. Cache + download FFmpeg (Windows x64)
14. Prepare Electron resources
15. Update version from git tag
16. Build frontend (`pnpm --filter @verbatim/frontend build:ci`)
17. Build Electron (`pnpm --filter @verbatim/electron build`)
18. Package with electron-builder (`electron-builder --win --x64`)
19. Upload `.exe` artifact

**Code signing:** Optional. Without signing, users get SmartScreen warnings. Can add later via `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` secrets (already referenced in existing workflow env vars).

**Alternative:** Merge into existing `build-electron.yml` as a new matrix entry alongside `macos-14/arm64/darwin`.

## Size Budget

| Component | Compressed (est.) |
|---|---|
| Python 3.12 standalone (x64) | ~15MB |
| PyTorch CUDA 12.1 | ~800MB |
| Other ML deps (whisperx, pyannote, transformers, etc.) | ~120MB |
| FFmpeg (ffmpeg.exe + ffprobe.exe) | ~30MB |
| Whisper base model (CTranslate2) | ~140MB |
| Electron + frontend | ~50MB |
| **Total NSIS installer** | **~1.15GB** |

## What gets removed on Windows

- MLX Whisper (Apple Silicon only)
- `fsevents.node` (macOS only, electron-builder handles this automatically)
- `iconv-corefoundation` (macOS only)
- macOS entitlements/code signing (replaced with Windows code signing)

## What gets added on Windows

- CUDA runtime libraries (bundled with PyTorch + extra DLLs)
- Windows Python 3.12 standalone (x64)
- Windows FFmpeg static binaries
- NSIS installer configuration
- GitHub Actions Windows build workflow
- CTranslate2-format Whisper models

## Files to Create

- `.github/workflows/build-windows.yml` (or merge into existing `build-electron.yml`)
- `scripts/bundle-cuda-libs.sh`
- `scripts/requirements-ml-windows.txt`
- `scripts/prepare-whisper-models-windows.sh`

## Files to Modify

- `apps/electron/package.json` — CUDA extraResources, NSIS options
- `apps/electron/src/main/backend.ts` — CUDA PATH injection, Windows process termination
- `apps/electron/src/main/bootstrap-models.ts` — Windows model cache paths
- `scripts/install-bundled-deps.sh` — Windows+CUDA pip install branch
- `packages/backend/core/factory.py` — Platform guard on MLX import
- `packages/backend/core/whisper_catalog.py` — CTranslate2 model entries
- `packages/backend/core/config.py` — Windows data directory
