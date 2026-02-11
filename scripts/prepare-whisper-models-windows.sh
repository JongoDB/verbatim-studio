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
    # Use local_dir to download files directly (no HF cache symlinks).
    # On Windows, HF's cache_dir mode creates symlinks that Git Bash can't
    # follow, causing "not found" errors in subsequent shell steps.
    # Using local_dir writes regular files to a snapshot-like structure.
    SNAPSHOT_DIR="$DEST_DIR/snapshots/main"
    mkdir -p "$SNAPSHOT_DIR"

    # Convert Git Bash path to Windows path for native Python
    if command -v cygpath &>/dev/null; then
        WIN_SNAPSHOT_DIR=$(cygpath -w "$SNAPSHOT_DIR")
    else
        WIN_SNAPSHOT_DIR="$SNAPSHOT_DIR"
    fi

    "$PYTHON_BIN" -c "
import os, sys
from huggingface_hub import snapshot_download

repo_id = '$REPO'
local_dir = r'$WIN_SNAPSHOT_DIR'

print(f'Downloading {repo_id} to {local_dir}...')
snapshot_download(
    repo_id=repo_id,
    local_dir=local_dir,
)
print(f'Downloaded to: {local_dir}')

# Verify model files exist
model_bin = os.path.join(local_dir, 'model.bin')
if os.path.exists(model_bin):
    size_mb = os.path.getsize(model_bin) / (1024 * 1024)
    print(f'Verified: model.bin exists ({size_mb:.1f} MB)')
else:
    print(f'ERROR: model.bin not found in {local_dir}')
    print(f'Contents: {os.listdir(local_dir)}')
    sys.exit(1)
"

    echo "Download complete."
fi

echo ""
echo "=== Model Preparation Complete ==="
echo "Models prepared in: $OUTPUT_DIR"
ls -la "$DEST_DIR/snapshots/" 2>/dev/null || echo "(could not list snapshots)"
