#!/bin/bash
set -e

# Bundle CUDA runtime DLLs for Windows installer
# Copies required DLLs from the CUDA Toolkit installation to build/resources/cuda/
# for inclusion in the Electron app's extraResources.
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

# Copy CUDA runtime DLLs needed by PyTorch and llama.cpp
CUDA_BIN="$CUDA_DIR/bin"
DLL_PATTERNS=(
  "cublas64_*.dll"
  "cublasLt64_*.dll"
  "cudart64_*.dll"
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
