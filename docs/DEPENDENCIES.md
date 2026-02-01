# Verbatim Studio Dependencies

This document lists all dependencies required to run Verbatim Studio, including Python packages, Node.js packages, and external system binaries.

## System Requirements

### Required System Binaries

| Binary | Version | Purpose |
|--------|---------|---------|
| Python | 3.12.8 | Backend runtime |
| Node.js | 20.18.1 | Frontend/Electron runtime |
| pnpm | 9.14.4 | Package manager |
| ffmpeg | 7.1.1 | Audio/video processing (audio extraction from video) |
| git | 2.x | Version detection, repository operations |

### Platform-Specific Notes

- **macOS**: ffmpeg can be installed via Homebrew (`brew install ffmpeg`)
- **Windows**: ffmpeg must be available in PATH or bundled with Electron app
- **Linux**: ffmpeg available via package managers (apt, dnf, etc.)

---

## Python Backend Dependencies

### Core Dependencies (Required)

From `packages/backend/pyproject.toml`:

| Package | Version Constraint | Installed Version | Purpose |
|---------|-------------------|-------------------|---------|
| fastapi | >=0.115.0 | 0.115.11 | Web framework |
| uvicorn[standard] | >=0.34.0 | 0.34.0 | ASGI server |
| pydantic | >=2.10.0 | 2.10.6 | Data validation |
| pydantic-settings | >=2.7.0 | 2.7.1 | Settings management |
| sqlalchemy | >=2.0.0 | 2.0.37 | Database ORM |
| aiosqlite | >=0.20.0 | 0.20.0 | Async SQLite driver |
| greenlet | >=3.0.0 | 3.1.1 | Coroutine support |
| httpx | >=0.28.0 | 0.28.1 | HTTP client |
| python-multipart | >=0.0.18 | 0.0.20 | Multipart form parsing |
| aiofiles | >=24.0.0 | 24.1.0 | Async file operations |
| mutagen | >=1.47.0 | 1.47.0 | Audio metadata |
| python-docx | >=1.1.0 | 1.1.2 | DOCX processing |
| openpyxl | >=3.1.0 | 3.1.5 | Excel processing |
| python-pptx | >=0.6.23 | 1.0.2 | PowerPoint processing |
| PyMuPDF | >=1.24.0 | 1.25.4 | PDF processing |
| watchdog | >=4.0.0 | 6.0.0 | File system watching |
| keyring | >=25.0.0 | 25.6.0 | Credential storage |
| cryptography | >=46.0.0 | 44.0.2 | Encryption |
| aiohttp | >=3.9.0 | 3.11.13 | Async HTTP |
| google-api-python-client | >=2.0.0 | 2.164.0 | Google Drive API |
| google-auth-oauthlib | >=1.0.0 | 1.2.1 | Google OAuth |
| google-auth | >=2.0.0 | 2.38.0 | Google authentication |

### ML Dependencies (Optional - for transcription with diarization)

**CRITICAL**: These versions must stay in sync to avoid binary compatibility issues.

| Package | Version Constraint | Installed Version | Purpose |
|---------|-------------------|-------------------|---------|
| whisperx | >=3.1.0,<4.0.0 | 3.7.4 | Speech transcription with alignment |
| torch | >=2.8.0,<2.9.0 | 2.8.0 | PyTorch (ML framework) |
| torchaudio | >=2.8.0,<2.9.0 | 2.8.0 | Audio processing for PyTorch |
| torchvision | 0.23.0 | 0.23.0 | Vision utils (required by pyannote) |
| pyannote.audio | >=3.1.0,<4.0.0 | 3.4.0 | Speaker diarization |
| numpy | >=2.0.2,<2.1.0 | 2.0.2 | Numerical computing |

**Note**: pyannote.audio 4.x has breaking API changes. Do not upgrade past 3.x without testing.

### MLX Dependencies (Optional - Apple Silicon acceleration)

| Package | Version Constraint | Installed Version | Purpose |
|---------|-------------------|-------------------|---------|
| mlx-whisper | >=0.4.0 | 0.4.3 | MLX-optimized Whisper |
| mlx | - | 0.23.1 | Apple ML framework |
| mlx-lm | - | 0.22.1 | Language models for MLX |

### AI Dependencies (Optional - local LLM inference)

| Package | Version Constraint | Installed Version | Purpose |
|---------|-------------------|-------------------|---------|
| llama-cpp-python | >=0.2.0 | 0.3.16 | Local LLM inference |
| huggingface-hub | >=0.20.0 | 0.28.1 | Model downloads |

### OCR Dependencies (Optional - document text extraction)

| Package | Installed Version | Purpose |
|---------|-------------------|---------|
| chandra-ocr | 0.1.8 | OCR processing |

### Embeddings Dependencies (Optional - semantic search)

| Package | Version Constraint | Installed Version | Purpose |
|---------|-------------------|-------------------|---------|
| sentence-transformers | >=2.2.0 | 3.4.1 | Text embeddings |
| sqlite-vec | >=0.1.0 | 0.1.6 | Vector search in SQLite |

### Export Dependencies (Optional)

| Package | Version Constraint | Purpose |
|---------|-------------------|---------|
| python-docx | >=1.0.0 | DOCX export |
| reportlab | >=4.0.0 | PDF export |

### Development Dependencies

| Package | Version Constraint | Purpose |
|---------|-------------------|---------|
| pytest | >=8.0.0 | Testing |
| pytest-asyncio | >=0.24.0 | Async test support |
| ruff | >=0.8.0 | Linting/formatting |

---

## Complete Python Package List

Full output from `pip freeze` in the backend virtual environment:

```
accelerate==1.3.0
aiohappyeyeballs==2.4.6
aiohttp==3.11.13
aiosignal==1.3.2
aiosqlite==0.20.0
annotated-types==0.7.0
antlr4-python3-runtime==4.9.3
anyio==4.8.0
asteroid-filterbanks==0.4.0
attrs==25.1.0
audioread==3.0.1
cachetools==5.5.2
certifi==2025.1.31
cffi==1.17.1
chandra-ocr==0.1.8
charset-normalizer==3.4.1
click==8.1.8
coloredlogs==15.0.1
contourpy==1.3.1
cryptography==44.0.2
ctranslate2==4.5.0
cycler==0.12.1
decorator==5.1.1
diskcache==5.6.3
docopt==0.6.2
einops==0.8.1
et_xmlfile==2.0.0
fastapi==0.115.11
faster-whisper==1.1.1
filelock==3.17.0
flatbuffers==25.2.10
fonttools==4.56.0
frozenlist==1.5.0
fsspec==2025.2.0
google-api-core==2.24.1
google-api-python-client==2.164.0
google-auth==2.38.0
google-auth-httplib2==0.2.0
google-auth-oauthlib==1.2.1
googleapis-common-protos==1.67.0
greenlet==3.1.1
h11==0.14.0
httpcore==1.0.7
httplib2==0.22.0
httpx==0.28.1
huggingface-hub==0.28.1
humanfriendly==10.0
HyperPyYAML==1.2.2
idna==3.10
jaraco.classes==3.4.0
jaraco.context==6.0.1
jaraco.functools==4.1.0
Jinja2==3.1.6
joblib==1.4.2
keyring==25.6.0
kiwisolver==1.4.8
lazy_loader==0.4
librosa==0.10.2.post1
lightning==2.5.0.post0
lightning-utilities==0.12.0
llama_cpp_python==0.3.16
llvmlite==0.44.0
lxml==5.3.1
MarkupSafe==3.0.2
matplotlib==3.10.0
mlx==0.23.1
mlx-lm==0.22.1
mlx-whisper==0.4.3
more-itertools==10.6.0
mpmath==1.3.0
msgpack==1.1.0
multidict==6.1.0
mutagen==1.47.0
networkx==3.4.2
numba==0.61.0
numpy==2.0.2
nvidia-cublas-cu12==12.6.4.1
nvidia-cuda-cupti-cu12==12.6.80
nvidia-cuda-nvrtc-cu12==12.6.77
nvidia-cuda-runtime-cu12==12.6.77
nvidia-cudnn-cu12==9.5.1.17
nvidia-cufft-cu12==11.3.0.4
nvidia-cufile-cu12==1.11.1.6
nvidia-curand-cu12==10.3.7.77
nvidia-cusolver-cu12==11.7.1.2
nvidia-cusparse-cu12==12.5.4.2
nvidia-cusparselt-cu12==0.6.3
nvidia-nccl-cu12==2.23.4
nvidia-nvjitlink-cu12==12.6.77
nvidia-nvtx-cu12==12.6.77
oauthlib==3.2.2
omegaconf==2.3.0
onnxruntime==1.20.1
openai-whisper==20240930
openpyxl==3.1.5
optuna==4.2.0
packaging==24.2
pillow==11.1.0
platformdirs==4.3.6
pooch==1.8.2
primePy==1.3
propcache==0.2.1
proto-plus==1.25.0
protobuf==5.29.3
psutil==6.1.1
pyannote.audio==3.4.0
pyannote.core==5.0.0
pyannote.database==5.1.3
pyannote.metrics==3.2.1
pyannote.pipeline==3.0.1
pyasn1==0.6.1
pyasn1_modules==0.4.1
pycparser==2.22
pydantic==2.10.6
pydantic_core==2.27.2
pydantic-settings==2.7.1
PyMuPDF==1.25.4
pyparsing==3.2.1
python-dateutil==2.9.0.post0
python-docx==1.1.2
python-multipart==0.0.20
python-pptx==1.0.2
pytorch-lightning==2.5.0.post0
pytorch-metric-learning==2.8.1
PyYAML==6.0.2
regex==2024.11.6
requests==2.32.3
requests-oauthlib==2.0.0
rich==13.9.4
rsa==4.9
ruamel.yaml==0.18.10
ruamel.yaml.clib==0.2.12
safetensors==0.5.2
scikit-learn==1.6.1
scipy==1.15.1
semver==3.0.2
sentence-transformers==3.4.1
sentencepiece==0.2.0
shellingham==1.5.4
six==1.17.0
sniffio==1.3.1
sortedcontainers==2.4.0
soundfile==0.13.1
soxr==0.5.0.post1
speechbrain==1.0.2
SQLAlchemy==2.0.37
sqlite-vec==0.1.6
starlette==0.45.3
sympy==1.13.1
tabulate==0.9.0
tensorboardX==2.6.2.2
threadpoolctl==3.5.0
tiktoken==0.8.0
tokenizers==0.21.0
torch==2.8.0
torchaudio==2.8.0
torchmetrics==1.6.1
torchvision==0.23.0
tqdm==4.67.1
transformers==4.49.0
triton==3.2.0
typer==0.15.1
typing_extensions==4.12.2
uritemplate==4.1.1
urllib3==2.3.0
uvicorn==0.34.0
uvloop==0.21.0
watchdog==6.0.0
watchfiles==1.0.4
websockets==14.2
whisperx==3.7.4
XlsxWriter==3.2.2
yarl==1.18.3
```

---

## Node.js Frontend Dependencies

### Key Production Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| react | 18.3.1 | UI framework |
| react-dom | 18.3.1 | React DOM renderer |
| react-router-dom | 7.1.1 | Client-side routing |
| @tanstack/react-query | 5.62.16 | Data fetching/caching |
| wavesurfer.js | 7.12.1 | Audio waveform visualization |
| zustand | 5.0.2 | State management |
| lucide-react | 0.469.0 | Icons |
| tailwindcss | 3.4.17 | CSS framework |

### Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| vite | 6.0.6 | Build tool |
| typescript | 5.6.3 | Type checking |
| @vitejs/plugin-react | 4.3.4 | React plugin for Vite |
| tailwindcss | 3.4.17 | CSS framework |
| postcss | 8.4.49 | CSS processing |
| autoprefixer | 10.4.20 | CSS vendor prefixes |

---

## Electron App Dependencies

### Build Configuration

The Electron app uses `electron-builder` for packaging. Key dependencies:

| Package | Version | Purpose |
|---------|---------|---------|
| electron | 33.3.1 | Desktop runtime |
| electron-builder | 25.1.8 | Build/packaging |

### External Resources for Bundling

The following external binaries/resources need to be bundled for distribution:

1. **ffmpeg** - Required for video audio extraction
   - Must be included in `build/resources/` or system PATH
   - Used for: `ffmpeg -i <video> -ar 16000 -ac 1 <output.wav>`

2. **Python backend** - Can be bundled or require system Python
   - Virtual environment with all dependencies
   - Or PyInstaller-bundled executable

3. **ML Models** (optional, for offline use)
   - Whisper models
   - Speaker diarization models (pyannote)
   - OCR models (Chandra)

---

## Build Strategy: Per-Architecture Releases

Verbatim Studio uses **per-architecture releases** rather than combined/universal releases. Each platform gets its own installer with only the dependencies needed for that platform.

### Why Per-Architecture?

1. **Size**: ML dependencies are massive (~2GB+ for torch alone per platform)
2. **Platform exclusives**: MLX only works on Apple Silicon, CUDA only on NVIDIA GPUs
3. **Binary compatibility**: Python wheels are compiled per-platform
4. **User experience**: Smaller, faster downloads

### Release Artifacts

| Platform | Artifact Name | Example |
|----------|---------------|---------|
| macOS Apple Silicon | `Verbatim-Studio-<version>-mac-arm64.dmg` | `Verbatim-Studio-0.20.2-mac-arm64.dmg` |
| macOS Intel | `Verbatim-Studio-<version>-mac-x64.dmg` | `Verbatim-Studio-0.20.2-mac-x64.dmg` |
| Windows x64 | `Verbatim-Studio-<version>-win-x64.exe` | `Verbatim-Studio-0.20.2-win-x64.exe` |
| Linux x64 | `Verbatim-Studio-<version>-linux-x64.AppImage` | `Verbatim-Studio-0.20.2-linux-x64.AppImage` |

### Platform-Specific Dependencies

#### macOS Apple Silicon (arm64)

| Component | Included | Notes |
|-----------|----------|-------|
| Core Python deps | ✓ | FastAPI, SQLAlchemy, etc. |
| torch/torchaudio | ✓ | ARM64 wheels |
| pyannote.audio | ✓ | Speaker diarization |
| **mlx/mlx-whisper** | ✓ | **Apple Silicon exclusive** - fastest transcription |
| llama-cpp-python | ✓ | Metal GPU acceleration |
| ffmpeg | ✓ | ARM64 binary |
| chandra-ocr | ✓ | OCR processing |

#### macOS Intel (x64)

| Component | Included | Notes |
|-----------|----------|-------|
| Core Python deps | ✓ | FastAPI, SQLAlchemy, etc. |
| torch/torchaudio | ✓ | x86_64 wheels |
| pyannote.audio | ✓ | Speaker diarization |
| mlx/mlx-whisper | ✗ | **Not supported on Intel** |
| llama-cpp-python | ✓ | CPU-only (no Metal) |
| ffmpeg | ✓ | x86_64 binary |
| chandra-ocr | ✓ | OCR processing |

#### Windows x64

| Component | Included | Notes |
|-----------|----------|-------|
| Core Python deps | ✓ | FastAPI, SQLAlchemy, etc. |
| torch/torchaudio | ✓ | Windows wheels (CUDA-enabled) |
| pyannote.audio | ✓ | Speaker diarization |
| mlx/mlx-whisper | ✗ | **Apple Silicon only** |
| llama-cpp-python | ✓ | CUDA GPU acceleration (if NVIDIA GPU present) |
| ffmpeg | ✓ | Windows binary |
| chandra-ocr | ✓ | OCR processing |
| CUDA runtime | Optional | For GPU acceleration (user-installed or bundled) |

#### Linux x64

| Component | Included | Notes |
|-----------|----------|-------|
| Core Python deps | ✓ | FastAPI, SQLAlchemy, etc. |
| torch/torchaudio | ✓ | Linux wheels (CUDA-enabled) |
| pyannote.audio | ✓ | Speaker diarization |
| mlx/mlx-whisper | ✗ | **Apple Silicon only** |
| llama-cpp-python | ✓ | CUDA GPU acceleration (if NVIDIA GPU present) |
| ffmpeg | ✓ | Linux binary |
| chandra-ocr | ✓ | OCR processing |
| CUDA runtime | Optional | For GPU acceleration |

### Transcription Engine by Platform

| Platform | Primary Engine | Fallback | GPU Acceleration |
|----------|---------------|----------|------------------|
| macOS ARM64 | MLX Whisper | WhisperX (torch) | Metal (via MLX) |
| macOS x64 | WhisperX (torch) | faster-whisper | CPU only |
| Windows x64 | WhisperX (torch) | faster-whisper | CUDA (NVIDIA) |
| Linux x64 | WhisperX (torch) | faster-whisper | CUDA (NVIDIA) |

### Build Matrix

For CI/CD, each release requires building on:

```yaml
build-matrix:
  - os: macos-14          # Apple Silicon runner
    arch: arm64
    python: "3.12"
    extras: "[ml,mlx,ai,embeddings,export]"

  - os: macos-13          # Intel runner
    arch: x64
    python: "3.12"
    extras: "[ml,ai,embeddings,export]"  # No mlx

  - os: windows-latest
    arch: x64
    python: "3.12"
    extras: "[ml,ai,embeddings,export]"

  - os: ubuntu-latest
    arch: x64
    python: "3.12"
    extras: "[ml,ai,embeddings,export]"
```

### Estimated Bundle Sizes

| Platform | Estimated Size | Notes |
|----------|---------------|-------|
| macOS ARM64 | ~3.5 GB | Includes MLX + torch |
| macOS x64 | ~2.8 GB | torch only (no MLX) |
| Windows x64 | ~3.0 GB | torch + CUDA stubs |
| Linux x64 | ~2.8 GB | torch + CUDA stubs |

*Sizes are approximate and depend on which ML models are bundled.*

---

## Audio/Video Format Support

### Supported Upload Formats

From `packages/backend/api/routes/recordings.py`:

**Audio Formats:**
- MP3 (`audio/mpeg`, `audio/mp3`)
- WAV (`audio/wav`, `audio/wave`, `audio/x-wav`)
- OGG (`audio/ogg`)
- FLAC (`audio/flac`, `audio/x-flac`)
- AAC (`audio/aac`)
- M4A (`audio/m4a`, `audio/x-m4a`, `audio/mp4`)
- WebM (`audio/webm`, `audio/webm;codecs=opus`)

**Video Formats:**
- MP4 (`video/mp4`)
- WebM (`video/webm`)
- OGG (`video/ogg`)
- QuickTime/MOV (`video/quicktime`)
- AVI (`video/x-msvideo`)
- MKV (`video/x-matroska`)

### Video Processing

When a video file is uploaded:
1. Full video is stored in `media/recordings/<id>/video.<ext>`
2. Audio is extracted via ffmpeg to `media/recordings/<id>/audio.wav`
3. Extraction command: `ffmpeg -i <video> -ar 16000 -ac 1 -y <audio.wav>`

---

## Version Compatibility Notes

### Critical Version Locks

1. **torch/torchaudio/torchvision**: Must all be from same release series
   - Current: torch 2.8.0, torchaudio 2.8.0, torchvision 0.23.0

2. **pyannote.audio**: Must stay on 3.x series
   - 4.x has breaking API changes (AudioMetaData, etc.)

3. **numpy**: Must be <2.1.0 for whisperx compatibility

4. **Python**: 3.11+ required (uses modern syntax/features)

### Updating Dependencies

Before updating ML dependencies:
1. Check PyTorch compatibility matrix
2. Verify pyannote.audio API compatibility
3. Test diarization with real audio
4. Run full test suite

---

## Installation Commands

### Backend Setup

```bash
cd packages/backend
python -m venv .venv
source .venv/bin/activate

# Core dependencies
pip install -e .

# With ML support (transcription + diarization)
pip install -e ".[ml]"

# With Apple Silicon acceleration
pip install -e ".[mlx]"

# With local LLM support
pip install -e ".[ai]"

# With OCR support
pip install chandra-ocr

# Full installation
pip install -e ".[ml,mlx,ai,embeddings,export,dev]"
```

### Frontend Setup

```bash
cd packages/frontend
pnpm install
```

### Electron Setup

```bash
cd apps/electron
pnpm install
```

---

*Last updated: 2026-02-01*
*Version: 0.20.2*
