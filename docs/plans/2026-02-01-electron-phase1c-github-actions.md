# Electron Phase 1c: GitHub Actions Build Pipeline

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create GitHub Actions workflow to automatically build and release the Electron app for all platforms.

**Architecture:** GitHub Actions workflow triggered on tags builds for macOS (arm64/x64), Windows (x64), and Linux (x64). Artifacts are uploaded to GitHub Releases.

**Tech Stack:** GitHub Actions, electron-builder, code signing

---

## Task 1: Create Base GitHub Actions Workflow

**Files:**
- Create: `.github/workflows/build-electron.yml`

**Step 1: Create the workflow file**

```yaml
name: Build Electron App

on:
  push:
    tags:
      - 'v*'
  pull_request:
    branches: [main]
    paths:
      - 'apps/electron/**'
      - 'packages/frontend/**'
      - 'packages/backend/**'
      - 'scripts/**'
      - '.github/workflows/build-electron.yml'
  workflow_dispatch:

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-14
            arch: arm64
            platform: darwin
          - os: macos-13
            arch: x64
            platform: darwin
          - os: ubuntu-latest
            arch: x64
            platform: linux
          - os: windows-latest
            arch: x64
            platform: win32

    runs-on: ${{ matrix.os }}
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Get pnpm store directory
        shell: bash
        run: |
          echo "STORE_PATH=$(pnpm store path --silent)" >> $GITHUB_ENV

      - name: Setup pnpm cache
        uses: actions/cache@v4
        with:
          path: ${{ env.STORE_PATH }}
          key: ${{ runner.os }}-pnpm-store-${{ hashFiles('**/pnpm-lock.yaml') }}
          restore-keys: |
            ${{ runner.os }}-pnpm-store-

      - name: Install dependencies
        run: pnpm install

      - name: Download Python standalone
        shell: bash
        run: ./scripts/download-python-standalone.sh ${{ matrix.arch }}

      - name: Install Python dependencies
        shell: bash
        run: ./scripts/install-bundled-deps.sh

      - name: Prepare Electron resources
        shell: bash
        run: ./scripts/prepare-electron-resources.sh

      - name: Build frontend
        run: pnpm --filter @verbatim/frontend build

      - name: Build Electron
        run: pnpm --filter @verbatim/electron build

      - name: Package Electron app
        run: pnpm --filter @verbatim/electron dist
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: verbatim-studio-${{ matrix.platform }}-${{ matrix.arch }}
          path: |
            dist/*.dmg
            dist/*.exe
            dist/*.AppImage
          if-no-files-found: error

  release:
    needs: build
    if: startsWith(github.ref, 'refs/tags/')
    runs-on: ubuntu-latest
    permissions:
      contents: write
    
    steps:
      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: artifacts

      - name: Create Release
        uses: softprops/action-gh-release@v2
        with:
          files: artifacts/**/*
          generate_release_notes: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Step 2: Commit**

```bash
git add .github/workflows/build-electron.yml
git commit -m "ci: add GitHub Actions workflow for Electron builds"
```

---

## Task 2: Update Scripts for Cross-Platform CI

**Files:**
- Modify: `scripts/download-python-standalone.sh`
- Modify: `scripts/install-bundled-deps.sh`

**Step 1: Update download script for CI**

The download script needs to handle GitHub Actions runners properly. Update `scripts/download-python-standalone.sh` to handle the case where running on Windows GitHub Actions (which uses Git Bash):

Add after the existing platform detection (around line 46):

```bash
# GitHub Actions Windows runner detection
if [ "$RUNNER_OS" = "Windows" ]; then
  PLATFORM="windows"
  TARGET="x86_64-pc-windows-msvc"
  # Use .zip instead of .tar.gz on Windows
  FILENAME="cpython-${PYTHON_VERSION}+${RELEASE_DATE}-${TARGET}-install_only.zip"
fi
```

And update the extraction logic for Windows:

```bash
# Extract based on file type
if [[ "$FILENAME" == *.zip ]]; then
  echo "Extracting $FILENAME (zip)..."
  unzip -q "$FILENAME" -d "$OUTPUT_DIR"
else
  echo "Extracting $FILENAME (tar.gz)..."
  tar -xzf "$FILENAME" -C "$OUTPUT_DIR"
fi
```

**Step 2: Update install script for Windows paths**

Update `scripts/install-bundled-deps.sh` to handle Windows site-packages path:

```bash
# Site-packages directory differs on Windows
if [ "$PLATFORM" = "windows" ]; then
  SITE_PACKAGES="$PYTHON_DIR/Lib/site-packages"
else
  SITE_PACKAGES="$PYTHON_DIR/lib/python3.12/site-packages"
fi
```

**Step 3: Commit**

```bash
git add scripts/download-python-standalone.sh scripts/install-bundled-deps.sh
git commit -m "fix: update build scripts for Windows CI compatibility"
```

---

## Task 3: Add Package Metadata

**Files:**
- Modify: `apps/electron/package.json`

**Step 1: Add description and author**

Update `apps/electron/package.json` to include required metadata:

```json
{
  "name": "@verbatim/electron",
  "version": "0.1.0",
  "description": "Verbatim Studio - Transcription and Research Tool",
  "author": "Verbatim Studio <hello@verbatimstudio.io>",
  "private": true,
  ...
}
```

**Step 2: Commit**

```bash
git add apps/electron/package.json
git commit -m "chore(electron): add package metadata for electron-builder"
```

---

## Task 4: Test Workflow Locally with act (Optional)

**Step 1: Install act if not present**

```bash
brew install act  # macOS
```

**Step 2: Run workflow locally**

```bash
act -j build --matrix os:macos-14,arch:arm64
```

This step is optional but helps verify the workflow works before pushing.

---

## Task 5: Create PR to Test Workflow

**Step 1: Create a test branch**

```bash
git checkout -b ci/electron-builds
git push -u origin ci/electron-builds
```

**Step 2: Create PR**

```bash
gh pr create --title "ci: add GitHub Actions for Electron builds" --body "Adds automated builds for:
- macOS arm64 (Apple Silicon)
- macOS x64 (Intel)
- Windows x64
- Linux x64

Builds are triggered on:
- Tags (v*) - creates GitHub Release
- PRs that touch electron/frontend/backend code
- Manual workflow dispatch"
```

**Step 3: Verify builds pass on PR**

Monitor the GitHub Actions tab to ensure all 4 platform builds succeed.

---

## Task 6: Add Build Status Badge to README

**Files:**
- Modify: `README.md`

**Step 1: Add badge after the existing badges**

```markdown
[![Build Electron](https://github.com/JongoDB/verbatim-studio/actions/workflows/build-electron.yml/badge.svg)](https://github.com/JongoDB/verbatim-studio/actions/workflows/build-electron.yml)
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add Electron build status badge"
```

---

## Summary

After completing these tasks:

1. ✅ GitHub Actions workflow builds for all 4 platform/arch combinations
2. ✅ Builds trigger on tags (release) and PRs (validation)
3. ✅ Artifacts uploaded to GitHub Releases on tag push
4. ✅ Build scripts work cross-platform in CI
5. ✅ Package metadata complete for electron-builder
6. ✅ Build status visible in README

**Next steps (Phase 1d):**
- Code signing for macOS (Apple Developer cert)
- Code signing for Windows (EV certificate)
- Auto-update configuration (electron-updater)
