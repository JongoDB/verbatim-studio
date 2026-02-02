#!/bin/bash
set -e

# Download python-build-standalone for the target platform
# Usage: ./download-python-standalone.sh [arch]
# arch: x64, arm64 (defaults to current architecture)

PYTHON_VERSION="3.12.8"
RELEASE_DATE="20250106"
BUILD_DIR="build/python-standalone"

# Determine architecture
ARCH="${1:-}"
if [ -z "$ARCH" ]; then
  case "$(uname -m)" in
    x86_64) ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *) echo "Unsupported architecture: $(uname -m)"; exit 1 ;;
  esac
elif [ "$ARCH" != "x64" ] && [ "$ARCH" != "arm64" ]; then
  echo "Invalid architecture: $ARCH (must be x64 or arm64)"
  exit 1
fi

# Determine platform and target triple
case "$(uname -s)" in
  Darwin)
    PLATFORM="macos"
    if [ "$ARCH" = "arm64" ]; then
      TARGET="aarch64-apple-darwin"
    else
      TARGET="x86_64-apple-darwin"
    fi
    ;;
  Linux)
    PLATFORM="linux"
    if [ "$ARCH" = "arm64" ]; then
      TARGET="aarch64-unknown-linux-gnu"
    else
      TARGET="x86_64-unknown-linux-gnu"
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    PLATFORM="windows"
    TARGET="x86_64-pc-windows-msvc"
    ;;
  *)
    echo "Unsupported platform: $(uname -s)"
    exit 1
    ;;
esac

# Construct download URL
# Format: cpython-{version}+{date}-{target}-install_only.tar.gz
FILENAME="cpython-${PYTHON_VERSION}+${RELEASE_DATE}-${TARGET}-install_only.tar.gz"
URL="https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE_DATE}/${FILENAME}"

echo "=== Python Standalone Download ==="
echo "Platform: $PLATFORM"
echo "Architecture: $ARCH"
echo "Target: $TARGET"
echo "Python: $PYTHON_VERSION"
echo "URL: $URL"
echo ""

# Create build directory
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Download if not already present
if [ -f "$FILENAME" ]; then
  echo "Already downloaded: $FILENAME"
else
  echo "Downloading $FILENAME..."
  curl -L -f -o "$FILENAME" "$URL"
fi

# Extract
OUTPUT_DIR="python-${PLATFORM}-${ARCH}"
if [ -d "$OUTPUT_DIR" ]; then
  echo "Removing existing: $OUTPUT_DIR"
  rm -rf "$OUTPUT_DIR"
fi

echo "Extracting to $OUTPUT_DIR..."
mkdir -p "$OUTPUT_DIR"
tar -xzf "$FILENAME" -C "$OUTPUT_DIR"

# The archive extracts to python/, flatten it
if [ -d "$OUTPUT_DIR/python" ]; then
  mv "$OUTPUT_DIR/python"/* "$OUTPUT_DIR/"
  rm -rf "$OUTPUT_DIR/python"
fi

echo ""
echo "=== Done ==="
echo "Python installed to: $BUILD_DIR/$OUTPUT_DIR"

# Verify - Windows uses python.exe in root, Unix uses bin/python3
if [ "$PLATFORM" = "windows" ]; then
  PYTHON_BIN="$OUTPUT_DIR/python.exe"
  echo "Binary: $BUILD_DIR/$PYTHON_BIN"
  "$PYTHON_BIN" --version
else
  PYTHON_BIN="$OUTPUT_DIR/bin/python3"
  echo "Binary: $BUILD_DIR/$PYTHON_BIN"
  "$PYTHON_BIN" --version
fi
