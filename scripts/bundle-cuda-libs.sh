#!/bin/bash
set -e

# Bundle CUDA runtime DLLs for CTranslate2 GPU inference on Windows.
#
# CTranslate2 (used by faster-whisper/WhisperX) has its own CUDA bindings
# and needs cublas, cudart, and cuDNN DLLs on PATH at runtime.
#
# Sources:
#   - cublas + cudart: CUDA Toolkit (installed by Jimver/cuda-toolkit CI action)
#   - cuDNN 9: nvidia-cudnn-cu12 pip package
#
# Output: build/resources/cuda/ (included as extraResource in Electron app)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_ROOT/build/resources/cuda"

# Python binary for pip operations
PYTHON_DIR="$PROJECT_ROOT/build/python-standalone/python-windows-x64"
PYTHON_BIN="$PYTHON_DIR/python.exe"
SITE_PACKAGES="$PYTHON_DIR/Lib/site-packages"

echo "=== Bundling CUDA Runtime Libraries for CTranslate2 ==="

mkdir -p "$OUTPUT_DIR"

# ---------------------------------------------------------------
# 1. Copy cuBLAS + cudart from CUDA Toolkit
# ---------------------------------------------------------------
if [ -n "$CUDA_PATH" ]; then
  CUDA_DIR="$CUDA_PATH"
elif [ -d "/c/Program Files/NVIDIA GPU Computing Toolkit/CUDA" ]; then
  CUDA_DIR=$(ls -d "/c/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v"* 2>/dev/null | sort -V | tail -1)
elif [ -d "C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA" ]; then
  CUDA_DIR=$(ls -d "C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v"* 2>/dev/null | sort -V | tail -1)
else
  echo "ERROR: CUDA Toolkit not found. Set CUDA_PATH or install CUDA Toolkit."
  exit 1
fi

echo "CUDA Toolkit: $CUDA_DIR"

CUDA_BIN="$CUDA_DIR/bin"
TOOLKIT_PATTERNS=(
  "cublas64_*.dll"
  "cublasLt64_*.dll"
  "cudart64_*.dll"
)

COPIED=0
for pattern in "${TOOLKIT_PATTERNS[@]}"; do
  for dll in "$CUDA_BIN"/$pattern; do
    if [ -f "$dll" ]; then
      cp "$dll" "$OUTPUT_DIR/"
      echo "  Copied (toolkit): $(basename "$dll")"
      COPIED=$((COPIED + 1))
    fi
  done
done

echo "Copied $COPIED DLLs from CUDA Toolkit"

# ---------------------------------------------------------------
# 2. Install nvidia-cudnn-cu12 and copy cuDNN DLLs
#    CTranslate2 4.5+ requires cuDNN 9 for Whisper model inference
# ---------------------------------------------------------------
echo ""
echo "=== Installing nvidia-cudnn-cu12 for cuDNN DLLs ==="

"$PYTHON_BIN" -m pip install \
  --target "$SITE_PACKAGES" \
  nvidia-cudnn-cu12 \
  --quiet

# cuDNN DLLs are in site-packages/nvidia/cudnn/bin/
CUDNN_BIN="$SITE_PACKAGES/nvidia/cudnn/bin"
if [ -d "$CUDNN_BIN" ]; then
  CUDNN_COUNT=0
  for dll in "$CUDNN_BIN"/*.dll; do
    if [ -f "$dll" ]; then
      cp "$dll" "$OUTPUT_DIR/"
      echo "  Copied (cuDNN): $(basename "$dll")"
      CUDNN_COUNT=$((CUDNN_COUNT + 1))
    fi
  done
  echo "Copied $CUDNN_COUNT cuDNN DLLs"
else
  # Try alternative path
  CUDNN_LIB="$SITE_PACKAGES/nvidia/cudnn/lib"
  if [ -d "$CUDNN_LIB" ]; then
    CUDNN_COUNT=0
    for dll in "$CUDNN_LIB"/*.dll; do
      if [ -f "$dll" ]; then
        cp "$dll" "$OUTPUT_DIR/"
        echo "  Copied (cuDNN): $(basename "$dll")"
        CUDNN_COUNT=$((CUDNN_COUNT + 1))
      fi
    done
    echo "Copied $CUDNN_COUNT cuDNN DLLs"
  else
    echo "WARNING: cuDNN DLLs not found at $CUDNN_BIN or $CUDNN_LIB"
    echo "CTranslate2 GPU inference may fail without cuDNN."
  fi
fi

# ---------------------------------------------------------------
# 3. Clean up nvidia pip packages from site-packages
#    DLLs are now in build/resources/cuda/ — no need to keep
#    the full nvidia packages in the Python environment.
# ---------------------------------------------------------------
echo ""
echo "=== Cleaning nvidia pip packages from site-packages ==="
rm -rf "$SITE_PACKAGES/nvidia"
rm -rf "$SITE_PACKAGES/nvidia_"*.dist-info
echo "Removed nvidia packages from site-packages"

echo ""
echo "=== CUDA DLL Bundle Summary ==="
du -sh "$OUTPUT_DIR" || true
ls -la "$OUTPUT_DIR"
echo ""
echo "Done. CUDA DLLs staged at: $OUTPUT_DIR"
