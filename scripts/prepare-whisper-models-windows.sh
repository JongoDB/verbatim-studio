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

# Find the Python binary - prefer bundled Python if available
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

# Download CTranslate2-format Whisper Base (public model, no auth required)
REPO="Systran/faster-whisper-base"
DEST_NAME="models--Systran--faster-whisper-base"
DEST_DIR="$OUTPUT_DIR/huggingface/hub/$DEST_NAME"

echo ""
echo "--- Downloading $REPO (CTranslate2 format) ---"

if [ -d "$DEST_DIR" ] && [ "$(ls -A "$DEST_DIR" 2>/dev/null)" ]; then
    echo "Model already exists at $DEST_DIR, skipping..."
else
    # Download directly to the output directory's HF cache structure.
    # This avoids temp dir + move which breaks on Windows due to Git Bash vs
    # native Python path separator mismatches.
    CACHE_DIR="$OUTPUT_DIR/huggingface/hub"

    "$PYTHON_BIN" -c "
import os, sys
from huggingface_hub import snapshot_download

repo_id = '$REPO'
cache_dir = r'$CACHE_DIR'

print(f'Downloading {repo_id} to {cache_dir}...')
local_dir = snapshot_download(
    repo_id=repo_id,
    cache_dir=cache_dir,
    local_dir=None,
)
print(f'Downloaded to: {local_dir}')

# Verify model files exist
model_bin = os.path.join(local_dir, 'model.bin')
if os.path.exists(model_bin):
    print(f'Verified: model.bin exists ({os.path.getsize(model_bin)} bytes)')
else:
    print(f'WARNING: model.bin not found in {local_dir}')
    print(f'Contents: {os.listdir(local_dir)}')
    sys.exit(1)
"

    echo "Download complete."
fi

echo ""
echo "=== Model Preparation Complete ==="
echo "Models prepared in: $OUTPUT_DIR"
du -sh "$OUTPUT_DIR"
