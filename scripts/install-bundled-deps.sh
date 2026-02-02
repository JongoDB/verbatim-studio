#!/bin/bash
set -e

# Install core Python dependencies for bundling
# Usage: ./install-bundled-deps.sh [python-dir]

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

# Python directory
PYTHON_DIR="${1:-$PROJECT_ROOT/build/python-standalone/python-${PLATFORM}-${ARCH}}"

# Python binary path differs on Windows
if [ "$PLATFORM" = "windows" ]; then
  PYTHON_BIN="$PYTHON_DIR/python.exe"
else
  PYTHON_BIN="$PYTHON_DIR/bin/python3"
fi

if [ ! -f "$PYTHON_BIN" ]; then
  echo "Error: Python not found at $PYTHON_BIN"
  echo "Run ./scripts/download-python-standalone.sh first"
  exit 1
fi

# Site-packages directory (inside the Python installation)
SITE_PACKAGES="$PYTHON_DIR/lib/python3.12/site-packages"
REQUIREMENTS="$SCRIPT_DIR/requirements-core.txt"

echo "=== Installing Bundled Dependencies ==="
echo "Python: $PYTHON_BIN"
echo "Site-packages: $SITE_PACKAGES"
echo "Requirements: $REQUIREMENTS"
echo ""

# Upgrade pip first
"$PYTHON_BIN" -m pip install --upgrade pip --quiet

# Install dependencies
"$PYTHON_BIN" -m pip install \
  --target "$SITE_PACKAGES" \
  --upgrade \
  --no-deps \
  -r "$REQUIREMENTS"

# Also install dependencies of dependencies (with deps this time)
"$PYTHON_BIN" -m pip install \
  --target "$SITE_PACKAGES" \
  --upgrade \
  -r "$REQUIREMENTS"

echo ""
echo "=== Done ==="
echo "Dependencies installed to: $SITE_PACKAGES"
echo ""

# List installed packages
echo "Installed packages:"
"$PYTHON_BIN" -m pip list --path "$SITE_PACKAGES" | head -20
echo "..."
