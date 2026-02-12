#!/bin/bash
#
# Prepare the embedding model for bundling with the Electron app.
#
# Downloads nomic-ai/nomic-embed-text-v1.5 from HuggingFace and places it in
# the build/resources directory structure expected by the electron build.
#
# The embedding model is platform-agnostic (CPU-based sentence-transformers)
# so this same script works for both macOS and Windows.
#
# Usage: ./scripts/prepare-embedding-models.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_ROOT/build/resources/embedding-models"

echo "=== Preparing Embedding Models for Bundling ==="
echo "Output directory: $OUTPUT_DIR"

# Find the Python binary - prefer bundled Python if available
if [ -f "$PROJECT_ROOT/build/python-standalone/python-macos-arm64/bin/python3" ]; then
    PYTHON_BIN="$PROJECT_ROOT/build/python-standalone/python-macos-arm64/bin/python3"
    SITE_PACKAGES="$PROJECT_ROOT/build/python-standalone/python-macos-arm64/lib/python3.12/site-packages"
    export PYTHONPATH="$SITE_PACKAGES:$PYTHONPATH"
    echo "Using bundled Python: $PYTHON_BIN"
elif [ -f "$PROJECT_ROOT/build/python-standalone/python-windows-x64/python.exe" ]; then
    PYTHON_BIN="$PROJECT_ROOT/build/python-standalone/python-windows-x64/python.exe"
    SITE_PACKAGES="$PROJECT_ROOT/build/python-standalone/python-windows-x64/Lib/site-packages"
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

REPO="nomic-ai/nomic-embed-text-v1.5"
DEST_NAME="models--nomic-ai--nomic-embed-text-v1.5"
DEST_DIR="$OUTPUT_DIR/huggingface/hub/$DEST_NAME"

echo ""
echo "--- Downloading $REPO ---"

if [ -d "$DEST_DIR" ] && [ "$(ls -A "$DEST_DIR" 2>/dev/null)" ]; then
    echo "Model already exists at $DEST_DIR, skipping..."
else
    echo "Downloading to temporary cache..."

    # Create a temporary cache directory
    temp_cache=$(mktemp -d)

    # Download using huggingface_hub
    HF_HOME="$temp_cache" "$PYTHON_BIN" -c "
from huggingface_hub import snapshot_download
import os

repo_id = '$REPO'
cache_dir = '$temp_cache/hub'

print(f'Downloading {repo_id}...')
local_dir = snapshot_download(
    repo_id=repo_id,
    cache_dir=cache_dir,
    local_dir=None,
)
print(f'Downloaded to: {local_dir}')
"

    # Move from temp cache to output directory
    repo_dashed=$(echo "$REPO" | sed 's/\//--/g')
    temp_model_dir="$temp_cache/hub/models--$repo_dashed"
    echo "Looking for model at: $temp_model_dir"

    if [ -d "$temp_model_dir" ]; then
        mkdir -p "$(dirname "$DEST_DIR")"
        mv "$temp_model_dir" "$DEST_DIR"
        echo "Moved to: $DEST_DIR"
    else
        echo "ERROR: Could not find downloaded model at expected path"
        echo "Expected: $temp_model_dir"
        echo "Temp cache contents:"
        find "$temp_cache" -type d
        rm -rf "$temp_cache"
        exit 1
    fi

    # Cleanup temp cache
    rm -rf "$temp_cache"

    echo "Done: $REPO"
fi

echo ""
echo "=== Embedding Model Preparation Complete ==="
echo ""
echo "Models prepared in: $OUTPUT_DIR"
echo ""
echo "Directory structure:"
find "$OUTPUT_DIR" -type d | head -20
echo ""
echo "Total size:"
du -sh "$OUTPUT_DIR"
