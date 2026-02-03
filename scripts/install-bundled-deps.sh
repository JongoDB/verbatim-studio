#!/bin/bash
set -e

# Install Python dependencies for bundling (core + ML)
# Usage: ./install-bundled-deps.sh [python-dir]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Determine architecture
case "$(uname -m)" in
  x86_64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $(uname -m)"; exit 1 ;;
esac

# Determine platform
case "$(uname -s)" in
  Darwin) PLATFORM="macos" ;;
  Linux) PLATFORM="linux" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
  *) echo "Unsupported platform: $(uname -s)"; exit 1 ;;
esac

# Python directory
PYTHON_DIR="${1:-$PROJECT_ROOT/build/python-standalone/python-${PLATFORM}-${ARCH}}"

# Python binary path differs on Windows
if [ "$PLATFORM" = "windows" ]; then
  PYTHON_BIN="$PYTHON_DIR/python.exe"
else
  PYTHON_BIN="$PYTHON_DIR/bin/python3"
fi

if [ ! -f "$PYTHON_BIN" ]; then
  echo "Error: Python not found at $PYTHON_BIN"
  echo "Run ./scripts/download-python-standalone.sh first"
  exit 1
fi

# Site-packages directory (inside the Python installation)
if [ "$PLATFORM" = "windows" ]; then
  SITE_PACKAGES="$PYTHON_DIR/Lib/site-packages"
else
  SITE_PACKAGES="$PYTHON_DIR/lib/python3.12/site-packages"
fi

REQUIREMENTS_CORE="$SCRIPT_DIR/requirements-core.txt"
REQUIREMENTS_ML="$SCRIPT_DIR/requirements-ml.txt"

echo "=== Installing Bundled Dependencies ==="
echo "Python: $PYTHON_BIN"
echo "Site-packages: $SITE_PACKAGES"
echo "Platform: $PLATFORM"
echo "Architecture: $ARCH"
echo ""

# Upgrade pip first
echo "Upgrading pip..."
"$PYTHON_BIN" -m pip install --upgrade pip --quiet

# =============================================================================
# Install core dependencies
# =============================================================================
echo ""
echo "=== Installing Core Dependencies ==="
"$PYTHON_BIN" -m pip install \
  --target "$SITE_PACKAGES" \
  --upgrade \
  -r "$REQUIREMENTS_CORE"

# =============================================================================
# Install ML dependencies (platform-specific)
# =============================================================================
echo ""
echo "=== Installing ML Dependencies ==="

if [ "$PLATFORM" = "macos" ] && [ "$ARCH" = "arm64" ]; then
  # Apple Silicon: Install MLX packages + whisperx for diarization
  echo "Installing ML dependencies for Apple Silicon..."

  # Install PyTorch first (CPU version, MLX handles GPU)
  "$PYTHON_BIN" -m pip install \
    --target "$SITE_PACKAGES" \
    --upgrade \
    "torch>=2.8.0,<2.9.0" \
    "torchaudio>=2.8.0,<2.9.0" \
    "torchvision>=0.23.0,<0.24.0"

  # Install MLX Whisper (Apple Silicon optimized)
  "$PYTHON_BIN" -m pip install \
    --target "$SITE_PACKAGES" \
    --upgrade \
    "mlx-whisper>=0.4.0,<0.5.0"

  # Install WhisperX and pyannote for diarization
  # Pin huggingface_hub and transformers for compatibility
  "$PYTHON_BIN" -m pip install \
    --target "$SITE_PACKAGES" \
    --upgrade \
    "huggingface_hub>=0.34.0,<1.0.0" \
    "transformers>=4.45.0,<5.0.0"

  "$PYTHON_BIN" -m pip install \
    --target "$SITE_PACKAGES" \
    --upgrade \
    "whisperx>=3.1.0,<4.0.0" \
    "pyannote.audio>=3.1.0,<4.0.0"

else
  # Other platforms: Install WhisperX with PyTorch
  echo "Installing ML dependencies for ${PLATFORM}-${ARCH}..."

  # Install PyTorch
  "$PYTHON_BIN" -m pip install \
    --target "$SITE_PACKAGES" \
    --upgrade \
    "torch>=2.8.0,<2.9.0" \
    "torchaudio>=2.8.0,<2.9.0" \
    "torchvision>=0.23.0,<0.24.0"

  # Install HuggingFace ecosystem with version constraints
  "$PYTHON_BIN" -m pip install \
    --target "$SITE_PACKAGES" \
    --upgrade \
    "huggingface_hub>=0.34.0,<1.0.0" \
    "transformers>=4.45.0,<5.0.0"

  # Install WhisperX and pyannote
  "$PYTHON_BIN" -m pip install \
    --target "$SITE_PACKAGES" \
    --upgrade \
    "whisperx>=3.1.0,<4.0.0" \
    "pyannote.audio>=3.1.0,<4.0.0"
fi

# =============================================================================
# Install OCR and embedding dependencies (all platforms)
# =============================================================================
echo ""
echo "=== Installing OCR and Embedding Dependencies ==="
"$PYTHON_BIN" -m pip install \
  --target "$SITE_PACKAGES" \
  --upgrade \
  "qwen-vl-utils>=0.0.8" \
  "accelerate>=0.26.0" \
  "sentence-transformers>=2.2.0,<3.0.0"

# =============================================================================
# Verify critical version constraints
# =============================================================================
echo ""
echo "=== Verifying Version Constraints ==="

# Check huggingface_hub version (must be <1.0.0 for use_auth_token)
HF_VERSION=$("$PYTHON_BIN" -c "import huggingface_hub; print(huggingface_hub.__version__)" 2>/dev/null || echo "not installed")
echo "huggingface_hub: $HF_VERSION"
if [[ "$HF_VERSION" == 1.* ]]; then
  echo "WARNING: huggingface_hub 1.x detected! Downgrading..."
  "$PYTHON_BIN" -m pip install --target "$SITE_PACKAGES" --upgrade "huggingface_hub>=0.34.0,<1.0.0"
fi

# Check transformers version (must be <5.0.0)
TF_VERSION=$("$PYTHON_BIN" -c "import transformers; print(transformers.__version__)" 2>/dev/null || echo "not installed")
echo "transformers: $TF_VERSION"
if [[ "$TF_VERSION" == 5.* ]]; then
  echo "WARNING: transformers 5.x detected! Downgrading..."
  "$PYTHON_BIN" -m pip install --target "$SITE_PACKAGES" --upgrade "transformers>=4.45.0,<5.0.0"
fi

# Check torch version
TORCH_VERSION=$("$PYTHON_BIN" -c "import torch; print(torch.__version__)" 2>/dev/null || echo "not installed")
echo "torch: $TORCH_VERSION"

echo ""
echo "=== Done ==="
echo "Dependencies installed to: $SITE_PACKAGES"
echo ""

# List key installed packages
echo "Key packages installed:"
"$PYTHON_BIN" -m pip list --path "$SITE_PACKAGES" 2>/dev/null | grep -E "torch|whisper|pyannote|mlx|transformers|huggingface|sentence" || true
