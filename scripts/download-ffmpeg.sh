#!/bin/bash
set -e

# Download static FFmpeg binaries for bundling
# Supports macOS (arm64/x64), Linux (x64), Windows (x64)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_ROOT/build/resources/ffmpeg"

# Determine architecture and platform
case "$(uname -m)" in
  x86_64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $(uname -m)"; exit 1 ;;
esac

case "$(uname -s)" in
  Darwin) PLATFORM="macos" ;;
  Linux) PLATFORM="linux" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
  *) echo "Unsupported platform: $(uname -s)"; exit 1 ;;
esac

echo "=== Downloading FFmpeg for $PLATFORM-$ARCH ==="

mkdir -p "$BUILD_DIR"

# Download URLs for static FFmpeg builds
# Using Martin Riedl's builds for macOS (signed/notarized)
# Using ffbinaries for Linux/Windows
case "$PLATFORM-$ARCH" in
  macos-arm64)
    FFMPEG_URL="https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip"
    FFPROBE_URL="https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffprobe.zip"
    ;;
  macos-x64)
    FFMPEG_URL="https://ffmpeg.martin-riedl.de/redirect/latest/macos/amd64/release/ffmpeg.zip"
    FFPROBE_URL="https://ffmpeg.martin-riedl.de/redirect/latest/macos/amd64/release/ffprobe.zip"
    ;;
  linux-x64)
    FFMPEG_URL="https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-linux-64.zip"
    FFPROBE_URL="https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffprobe-6.1-linux-64.zip"
    ;;
  windows-x64)
    FFMPEG_URL="https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-win-64.zip"
    FFPROBE_URL="https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffprobe-6.1-win-64.zip"
    ;;
  *)
    echo "No FFmpeg binary available for $PLATFORM-$ARCH"
    exit 1
    ;;
esac

# Download and extract FFmpeg
echo "Downloading ffmpeg..."
curl -L -o "$BUILD_DIR/ffmpeg.zip" "$FFMPEG_URL"
unzip -o "$BUILD_DIR/ffmpeg.zip" -d "$BUILD_DIR"
rm "$BUILD_DIR/ffmpeg.zip"

# Download and extract FFprobe
echo "Downloading ffprobe..."
curl -L -o "$BUILD_DIR/ffprobe.zip" "$FFPROBE_URL"
unzip -o "$BUILD_DIR/ffprobe.zip" -d "$BUILD_DIR"
rm "$BUILD_DIR/ffprobe.zip"

# Make executable on Unix
if [ "$PLATFORM" != "windows" ]; then
  chmod +x "$BUILD_DIR/ffmpeg" "$BUILD_DIR/ffprobe" 2>/dev/null || true
fi

# Remove quarantine on macOS
if [ "$PLATFORM" = "macos" ]; then
  xattr -cr "$BUILD_DIR/ffmpeg" "$BUILD_DIR/ffprobe" 2>/dev/null || true
fi

echo ""
echo "=== FFmpeg downloaded to $BUILD_DIR ==="
ls -la "$BUILD_DIR"
