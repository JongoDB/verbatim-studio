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
    TEMP_CACHE=$(mktemp -d)

    HF_HOME="$TEMP_CACHE" "$PYTHON_BIN" -c "
from huggingface_hub import snapshot_download

repo_id = '$REPO'
cache_dir = '$TEMP_CACHE/hub'

print(f'Downloading {repo_id}...')
local_dir = snapshot_download(
    repo_id=repo_id,
    cache_dir=cache_dir,
    local_dir=None,
)
print(f'Downloaded to: {local_dir}')
"

    REPO_DASHED=$(echo "$REPO" | sed 's/\//--/g')
    TEMP_MODEL_DIR="$TEMP_CACHE/hub/models--$REPO_DASHED"

    if [ -d "$TEMP_MODEL_DIR" ]; then
        mkdir -p "$(dirname "$DEST_DIR")"
        mv "$TEMP_MODEL_DIR" "$DEST_DIR"
        echo "Moved to: $DEST_DIR"
    else
        echo "ERROR: Could not find downloaded model"
        rm -rf "$TEMP_CACHE"
        exit 1
    fi

    rm -rf "$TEMP_CACHE"
fi

echo ""
echo "=== Model Preparation Complete ==="
echo "Models prepared in: $OUTPUT_DIR"
du -sh "$OUTPUT_DIR"
