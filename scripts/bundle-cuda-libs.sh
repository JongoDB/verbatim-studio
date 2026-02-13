#!/bin/bash
set -e

# Bundle CUDA runtime DLLs for CTranslate2 GPU inference on Windows.
#
# CTranslate2 (used by faster-whisper/WhisperX) needs cuBLAS + cudart
# DLLs on PATH at runtime. cuDNN is NOT required — CTranslate2 uses
# its own internal kernels for Whisper inference.
#
# Source: CUDA Toolkit (installed by Jimver/cuda-toolkit CI action)
#
# Output: build/resources/cuda/ (included as extraResource in Electron app)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_ROOT/build/resources/cuda"

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

echo ""
echo "=== CUDA DLL Bundle Summary ==="
du -sh "$OUTPUT_DIR" || true
ls -la "$OUTPUT_DIR"
echo ""
echo "Done. CUDA DLLs staged at: $OUTPUT_DIR"
