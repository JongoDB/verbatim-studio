# Electron Phase 1b: Python Bundling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create scripts to download python-build-standalone and bundle Python with core dependencies for the Electron app.

**Architecture:** Shell scripts download platform-specific Python builds from python-build-standalone releases. A second script installs core (non-ML) dependencies into a site-packages directory. electron-builder configuration bundles everything into the final app.

**Tech Stack:** Bash scripts, python-build-standalone, pip, electron-builder

---

## Task 1: Create Python Download Script

**Files:**
- Create: `scripts/download-python-standalone.sh`

**Step 1: Create the download script**

Create `scripts/download-python-standalone.sh`:

```bash
#!/bin/bash
set -e

# Download python-build-standalone for the target platform
# Usage: ./download-python-standalone.sh [arch]
# arch: x64, arm64 (defaults to current architecture)

PYTHON_VERSION="3.12"
RELEASE_DATE="20250127"
BUILD_DIR="build/python-standalone"

# Determine architecture
ARCH="${1:-}"
if [ -z "$ARCH" ]; then
  case "$(uname -m)" in
    x86_64) ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *) echo "Unsupported architecture: $(uname -m)"; exit 1 ;;
  esac
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
  curl -L -o "$FILENAME" "$URL"
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

# The archive extracts to python/install/, flatten it
if [ -d "$OUTPUT_DIR/python/install" ]; then
  mv "$OUTPUT_DIR/python/install"/* "$OUTPUT_DIR/"
  rm -rf "$OUTPUT_DIR/python"
fi

echo ""
echo "=== Done ==="
echo "Python installed to: $BUILD_DIR/$OUTPUT_DIR"
echo "Binary: $BUILD_DIR/$OUTPUT_DIR/bin/python3"

# Verify
"$OUTPUT_DIR/bin/python3" --version
```

**Step 2: Make executable and test**

```bash
chmod +x scripts/download-python-standalone.sh
./scripts/download-python-standalone.sh
```

**Step 3: Commit**

```bash
git add scripts/download-python-standalone.sh
git commit -m "feat: add python-build-standalone download script"
```

---

## Task 2: Create Dependencies Install Script

**Files:**
- Create: `scripts/install-bundled-deps.sh`
- Create: `scripts/requirements-core.txt`

**Step 1: Create core requirements file**

Create `scripts/requirements-core.txt`:

```
# Core dependencies bundled with the Electron app
# ML dependencies are downloaded on first use (not bundled)

# Web framework
fastapi==0.115.0
uvicorn[standard]==0.34.0
pydantic==2.10.0
pydantic-settings==2.7.0

# Database
sqlalchemy==2.0.0
aiosqlite==0.20.0
greenlet==3.0.0

# HTTP client
httpx==0.28.0

# File handling
python-multipart==0.0.18
aiofiles==24.0.0
mutagen==1.47.0

# Document processing
python-docx==1.1.0
openpyxl==3.1.0
python-pptx==0.6.23
PyMuPDF==1.24.0

# File system watching
watchdog==4.0.0

# Credential encryption
keyring==25.0.0
cryptography==46.0.0

# OAuth providers
aiohttp==3.9.0
google-api-python-client==2.0.0
google-auth-oauthlib==1.0.0
google-auth==2.0.0

# Export
reportlab==4.0.0
```

**Step 2: Create install script**

Create `scripts/install-bundled-deps.sh`:

```bash
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
PYTHON_BIN="$PYTHON_DIR/bin/python3"

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
```

**Step 3: Make executable and test**

```bash
chmod +x scripts/install-bundled-deps.sh
./scripts/install-bundled-deps.sh
```

**Step 4: Commit**

```bash
git add scripts/requirements-core.txt scripts/install-bundled-deps.sh
git commit -m "feat: add script to install bundled Python dependencies"
```

---

## Task 3: Create Build Resources Script

**Files:**
- Create: `scripts/prepare-electron-resources.sh`

**Step 1: Create the preparation script**

Create `scripts/prepare-electron-resources.sh`:

```bash
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
cp "$SCRIPT_DIR/requirements-ml.txt" "$RESOURCES_DIR/" 2>/dev/null || true

echo ""
echo "=== Done ==="
echo "Resources prepared at: $RESOURCES_DIR"
echo ""
ls -la "$RESOURCES_DIR"
```

**Step 2: Make executable**

```bash
chmod +x scripts/prepare-electron-resources.sh
```

**Step 3: Commit**

```bash
git add scripts/prepare-electron-resources.sh
git commit -m "feat: add script to prepare Electron build resources"
```

---

## Task 4: Create ML Requirements File

**Files:**
- Create: `scripts/requirements-ml.txt`

**Step 1: Create ML requirements file**

Create `scripts/requirements-ml.txt`:

```
# ML dependencies - downloaded on first use, not bundled
# These are version-pinned for reproducibility

# PyTorch (CPU version for smaller size, users can override)
torch==2.8.0
torchaudio==2.8.0

# Whisper transcription
whisperx==3.1.6
pyannote.audio==3.1.1

# LLM inference
llama-cpp-python==0.2.90

# Vision/OCR models
transformers==4.45.0
qwen-vl-utils==0.0.8
accelerate==0.26.0

# Embeddings for semantic search
sentence-transformers==2.2.0

# Numpy (specific version for compatibility)
numpy==2.0.2
```

**Step 2: Commit**

```bash
git add scripts/requirements-ml.txt
git commit -m "feat: add ML requirements file for on-demand installation"
```

---

## Task 5: Update electron-builder Configuration

**Files:**
- Modify: `apps/electron/package.json`

**Step 1: Update electron-builder config**

Update the `build` section in `apps/electron/package.json`:

```json
{
  "name": "@verbatim/electron",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main/index.js",
  "scripts": {
    "dev": "concurrently \"pnpm dev:main\" \"pnpm dev:preload\"",
    "dev:main": "tsc -p tsconfig.json --watch",
    "dev:preload": "tsc -p tsconfig.preload.json --watch",
    "build": "tsc -p tsconfig.json && tsc -p tsconfig.preload.json",
    "start": "electron .",
    "pack": "electron-builder --dir",
    "dist": "electron-builder",
    "prepare-resources": "../../scripts/prepare-electron-resources.sh"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/node": "^22.10.5",
    "concurrently": "^9.1.2",
    "electron": "^34.0.0",
    "electron-builder": "^25.1.8",
    "typescript": "^5.7.2"
  },
  "build": {
    "appId": "com.verbatimstudio.app",
    "productName": "Verbatim Studio",
    "directories": {
      "output": "../../dist"
    },
    "files": [
      "dist/**/*"
    ],
    "extraResources": [
      {
        "from": "../../build/resources/python",
        "to": "python",
        "filter": ["**/*"]
      },
      {
        "from": "../../build/resources/backend",
        "to": "backend",
        "filter": ["**/*"]
      },
      {
        "from": "../../packages/frontend/dist",
        "to": "frontend",
        "filter": ["**/*"]
      },
      {
        "from": "../../scripts/requirements-ml.txt",
        "to": "requirements-ml.txt"
      }
    ],
    "mac": {
      "category": "public.app-category.productivity",
      "target": [
        {
          "target": "dmg",
          "arch": ["arm64", "x64"]
        }
      ],
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "entitlements.mac.plist",
      "entitlementsInherit": "entitlements.mac.plist"
    },
    "win": {
      "target": [
        {
          "target": "nsis",
          "arch": ["x64"]
        }
      ]
    },
    "linux": {
      "target": [
        {
          "target": "AppImage",
          "arch": ["x64"]
        }
      ],
      "category": "Office"
    }
  }
}
```

**Step 2: Create macOS entitlements file**

Create `apps/electron/entitlements.mac.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.automation.apple-events</key>
    <true/>
</dict>
</plist>
```

**Step 3: Commit**

```bash
git add apps/electron/package.json apps/electron/entitlements.mac.plist
git commit -m "feat(electron): configure electron-builder for Python bundling"
```

---

## Task 6: Update Backend Manager for Bundled Python

**Files:**
- Modify: `apps/electron/src/main/backend.ts`

**Step 1: Update getPythonPath to handle all platforms**

Update the `getPythonPath` method in `apps/electron/src/main/backend.ts`:

```typescript
private getPythonPath(): string {
  if (app.isPackaged) {
    // Bundled Python in resources
    const resourcesPath = process.resourcesPath;
    if (process.platform === 'win32') {
      return path.join(resourcesPath, 'python', 'python.exe');
    } else {
      return path.join(resourcesPath, 'python', 'bin', 'python3');
    }
  } else {
    // Development: Use venv Python
    const backendPath = path.join(__dirname, '../../../../packages/backend');
    if (process.platform === 'win32') {
      return path.join(backendPath, '.venv', 'Scripts', 'python.exe');
    } else {
      return path.join(backendPath, '.venv', 'bin', 'python');
    }
  }
}
```

**Step 2: Verify build**

```bash
cd apps/electron && pnpm build
```

**Step 3: Commit**

```bash
git add apps/electron/src/main/backend.ts
git commit -m "feat(electron): handle Windows Python paths in BackendManager"
```

---

## Task 7: Test Full Build Pipeline

**Step 1: Run the full build pipeline**

```bash
# From project root
./scripts/download-python-standalone.sh
./scripts/install-bundled-deps.sh
./scripts/prepare-electron-resources.sh

# Build frontend
cd packages/frontend && pnpm build && cd ../..

# Build Electron
cd apps/electron && pnpm build && pnpm pack
```

**Step 2: Verify the packaged app**

Check that `dist/` contains the app with bundled resources.

**Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "feat(electron): complete Phase 1b - Python bundling pipeline"
```

---

## Summary

After completing these tasks:

1. ✅ Script to download python-build-standalone for any platform
2. ✅ Script to install core dependencies into bundled Python
3. ✅ Script to prepare resources for electron-builder
4. ✅ ML requirements file for on-demand installation
5. ✅ electron-builder configured to bundle Python + backend
6. ✅ Backend manager handles bundled Python paths
7. ✅ Full build pipeline tested

**Next steps (Phase 1c):**
- GitHub Actions workflow for automated builds
- Code signing configuration
- Auto-update setup
