#!/bin/bash
set -e

# Prepare resources for Electron build
# This copies Python and backend code to the build/resources directory

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Determine architecture
case "$(uname -m)" in
  x86_64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $(uname -m)"; exit 1 ;;
esac

# Determine platform
case "$(uname -s)" in
  Darwin) PLATFORM="macos" ;;
  Linux) PLATFORM="linux" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
  *) echo "Unsupported platform: $(uname -s)"; exit 1 ;;
esac

PYTHON_DIR="$PROJECT_ROOT/build/python-standalone/python-${PLATFORM}-${ARCH}"
RESOURCES_DIR="$PROJECT_ROOT/build/resources"
BACKEND_SRC="$PROJECT_ROOT/packages/backend"

echo "=== Preparing Electron Resources ==="
echo "Platform: $PLATFORM"
echo "Architecture: $ARCH"
echo "Python: $PYTHON_DIR"
echo "Resources: $RESOURCES_DIR"
echo ""

# Verify Python exists
if [ ! -d "$PYTHON_DIR" ]; then
  echo "Error: Python not found at $PYTHON_DIR"
  echo "Run ./scripts/download-python-standalone.sh first"
  exit 1
fi

# Clean and create resources directory
rm -rf "$RESOURCES_DIR"
mkdir -p "$RESOURCES_DIR"

# Copy Python
echo "Copying Python..."
cp -R "$PYTHON_DIR" "$RESOURCES_DIR/python"

# Copy backend source code (excluding venv, cache, etc.)
echo "Copying backend..."
mkdir -p "$RESOURCES_DIR/backend"
cp -R "$BACKEND_SRC/api" "$RESOURCES_DIR/backend/"
cp -R "$BACKEND_SRC/core" "$RESOURCES_DIR/backend/" 2>/dev/null || true
cp -R "$BACKEND_SRC/services" "$RESOURCES_DIR/backend/" 2>/dev/null || true
cp -R "$BACKEND_SRC/persistence" "$RESOURCES_DIR/backend/" 2>/dev/null || true

# Copy pyproject.toml for package metadata
cp "$BACKEND_SRC/pyproject.toml" "$RESOURCES_DIR/backend/"

# Copy ML requirements for on-demand installation
if [ -f "$SCRIPT_DIR/requirements-ml.txt" ]; then
  cp "$SCRIPT_DIR/requirements-ml.txt" "$RESOURCES_DIR/"
fi

echo ""
echo "=== Done ==="
echo "Resources prepared at: $RESOURCES_DIR"
echo ""
ls -la "$RESOURCES_DIR"
