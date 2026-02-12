#!/bin/bash
set -e

# Prepare sentence-transformer embedding model for bundling with Windows Electron app.
# Downloads nomic-ai/nomic-embed-text-v1.5 from HuggingFace.
#
# Usage: ./scripts/prepare-embedding-model-windows.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_ROOT/build/resources/embedding-models"

echo "=== Preparing Embedding Model for Windows Bundling ==="
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

# Download nomic-embed-text-v1.5 (public model, no auth required)
REPO="nomic-ai/nomic-embed-text-v1.5"
DEST_NAME="models--nomic-ai--nomic-embed-text-v1.5"
DEST_DIR="$OUTPUT_DIR/huggingface/hub/$DEST_NAME"

echo ""
echo "--- Downloading $REPO ---"

if [ -d "$DEST_DIR" ] && [ "$(ls -A "$DEST_DIR" 2>/dev/null)" ]; then
    echo "Model already exists at $DEST_DIR, skipping..."
else
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

# Verify key model files exist
for expected in ['config.json', 'tokenizer.json']:
    fpath = os.path.join(local_dir, expected)
    if os.path.exists(fpath):
        size_kb = os.path.getsize(fpath) / 1024
        print(f'Verified: {expected} ({size_kb:.1f} KB)')
    else:
        print(f'WARNING: {expected} not found in {local_dir}')

# Report total size
total = sum(
    os.path.getsize(os.path.join(dp, f))
    for dp, _, fnames in os.walk(local_dir)
    for f in fnames
)
print(f'Total model size: {total / (1024*1024):.1f} MB')
"

    echo "Download complete."
fi

echo ""
echo "=== Embedding Model Preparation Complete ==="
echo "Model prepared in: $OUTPUT_DIR"
ls -la "$DEST_DIR/snapshots/" 2>/dev/null || echo "(could not list snapshots)"
