#!/bin/bash
# Fast Electron development workflow
# Rebuilds and runs without creating DMG

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

echo "=== Fast Electron Dev Build ==="

# Kill any running Verbatim Studio
pkill -f "Verbatim Studio" 2>/dev/null || true

# Build frontend (skip if --skip-frontend flag)
if [[ "$1" != "--skip-frontend" && "$1" != "-s" ]]; then
    echo "Building frontend..."
    pnpm --filter @verbatim/frontend build:ci
else
    echo "Skipping frontend build"
fi

# Prepare resources
echo "Preparing resources..."
"$SCRIPT_DIR/prepare-electron-resources.sh"

# Build Electron (TypeScript only, no packaging)
echo "Building Electron..."
pnpm --filter @verbatim/electron build

# Pack without creating DMG (much faster)
echo "Packing app (no DMG)..."
cd "$ROOT_DIR/apps/electron" && npx electron-builder --dir

echo ""
echo "=== Done! Running app... ==="
echo ""

# Run the unpacked app
open "$ROOT_DIR/dist/mac-arm64/Verbatim Studio.app"
