#!/bin/bash
#
# Prepare Whisper and Pyannote models for bundling with the Electron app.
#
# This script downloads the models from HuggingFace and places them in the
# build/resources directory structure expected by the electron build.
#
# Usage: ./scripts/prepare-whisper-models.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_ROOT/build/resources/whisper-models"

echo "=== Preparing Whisper Models for Bundling ==="
echo "Output directory: $OUTPUT_DIR"

# Find the Python binary - prefer bundled Python if available
if [ -f "$PROJECT_ROOT/build/python-standalone/python-macos-arm64/bin/python3" ]; then
    PYTHON_BIN="$PROJECT_ROOT/build/python-standalone/python-macos-arm64/bin/python3"
    SITE_PACKAGES="$PROJECT_ROOT/build/python-standalone/python-macos-arm64/lib/python3.12/site-packages"
    export PYTHONPATH="$SITE_PACKAGES:$PYTHONPATH"
    echo "Using bundled Python: $PYTHON_BIN"
else
    PYTHON_BIN="python3"
    echo "Using system Python: $PYTHON_BIN"
    # Ensure huggingface_hub is installed
    "$PYTHON_BIN" -c "import huggingface_hub" 2>/dev/null || {
        echo "Installing huggingface_hub..."
        "$PYTHON_BIN" -m pip install --quiet huggingface_hub
    }
fi

# Create output directories
mkdir -p "$OUTPUT_DIR/huggingface/hub"
mkdir -p "$OUTPUT_DIR/torch/pyannote"

# Function to download a HuggingFace model
download_hf_model() {
    local repo="$1"
    local dest_name="$2"
    local cache_type="$3"  # "huggingface" or "torch"

    echo ""
    echo "--- Downloading $repo ---"

    if [ "$cache_type" = "huggingface" ]; then
        local dest_dir="$OUTPUT_DIR/huggingface/hub/$dest_name"
    else
        local dest_dir="$OUTPUT_DIR/torch/pyannote/$dest_name"
    fi

    if [ -d "$dest_dir" ] && [ "$(ls -A "$dest_dir" 2>/dev/null)" ]; then
        echo "Model already exists at $dest_dir, skipping..."
        return 0
    fi

    # Use huggingface-cli to download the model
    echo "Downloading to temporary cache..."

    # Create a temporary cache directory
    local temp_cache=$(mktemp -d)

    # Download using huggingface_hub
    HF_HOME="$temp_cache" "$PYTHON_BIN" -c "
from huggingface_hub import snapshot_download
import os

repo_id = '$repo'
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
    local temp_model_dir="$temp_cache/hub/models--${repo//\//-}"
    if [ -d "$temp_model_dir" ]; then
        mkdir -p "$(dirname "$dest_dir")"
        mv "$temp_model_dir" "$dest_dir"
        echo "Moved to: $dest_dir"
    else
        # Try alternate path format
        local temp_model_dir2="$temp_cache/hub/models--$(echo $repo | tr '/' '--')"
        if [ -d "$temp_model_dir2" ]; then
            mkdir -p "$(dirname "$dest_dir")"
            mv "$temp_model_dir2" "$dest_dir"
            echo "Moved to: $dest_dir"
        else
            echo "ERROR: Could not find downloaded model in temp cache"
            echo "Temp cache contents:"
            find "$temp_cache" -type d
            rm -rf "$temp_cache"
            return 1
        fi
    fi

    # Cleanup temp cache
    rm -rf "$temp_cache"

    echo "Done: $repo"
}

# Download Whisper Base (MLX format)
download_hf_model "mlx-community/whisper-base-mlx" "models--mlx-community--whisper-base-mlx" "huggingface"

# Download Pyannote segmentation model
download_hf_model "pyannote/segmentation-3.0" "models--pyannote--segmentation-3.0" "torch"

# Download Pyannote speaker embedding model
download_hf_model "pyannote/wespeaker-voxceleb-resnet34-LM" "models--pyannote--wespeaker-voxceleb-resnet34-LM" "torch"

echo ""
echo "=== Model Preparation Complete ==="
echo ""
echo "Models prepared in: $OUTPUT_DIR"
echo ""
echo "Directory structure:"
find "$OUTPUT_DIR" -type d | head -20
echo ""
echo "Total size:"
du -sh "$OUTPUT_DIR"
