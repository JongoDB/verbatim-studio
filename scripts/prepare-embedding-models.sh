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

# Convert Git Bash paths (/d/a/...) to Windows-native (D:/a/...) for Python
if command -v cygpath &>/dev/null; then
    DEST_DIR_PY=$(cygpath -m "$DEST_DIR")
else
    DEST_DIR_PY="$DEST_DIR"
fi

echo ""
echo "--- Downloading $REPO ---"

if [ -d "$DEST_DIR" ] && [ "$(ls -A "$DEST_DIR" 2>/dev/null)" ]; then
    echo "Model already exists at $DEST_DIR, skipping..."
else
    echo "Downloading model..."

    # Do download + move entirely in Python to avoid Git Bash ↔ Windows path issues
    "$PYTHON_BIN" -c "
import tempfile, shutil, os, sys

repo_id = '$REPO'
dest_dir = '$DEST_DIR_PY'

temp_dir = tempfile.mkdtemp()
cache_dir = os.path.join(temp_dir, 'hub')

try:
    from huggingface_hub import snapshot_download
    print(f'Downloading {repo_id}...')
    snapshot_download(
        repo_id=repo_id,
        cache_dir=cache_dir,
        local_dir=None,
        # Whitelist: only grab config, tokenizer, and safetensors weights
        allow_patterns=['*.json', '*.txt', '*.safetensors'],
    )

    model_dir = os.path.join(cache_dir, 'models--nomic-ai--nomic-embed-text-v1.5')
    if os.path.isdir(model_dir):
        os.makedirs(os.path.dirname(dest_dir), exist_ok=True)
        # symlinks=True preserves HF cache symlinks (blobs → snapshots)
        # to avoid duplicating the 547MB model.safetensors
        shutil.copytree(model_dir, dest_dir, symlinks=True)
        print(f'Model copied to: {dest_dir}')
    else:
        print(f'ERROR: Model not found at {model_dir}', file=sys.stderr)
        print(f'Contents: {os.listdir(cache_dir) if os.path.isdir(cache_dir) else \"cache_dir missing\"}', file=sys.stderr)
        sys.exit(1)
finally:
    shutil.rmtree(temp_dir, ignore_errors=True)
"

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
