#!/bin/bash
# Update all version files from the current git tag
# Usage: ./scripts/update-version.sh

set -e

# Get the repo root directory
REPO_ROOT="$(git rev-parse --show-toplevel)"

# Get the git version
RAW_VERSION=$(git describe --tags --always 2>/dev/null || echo "dev")

# Convert format from "v0.26.1-3-gabcdef" to "v0.26.1+3" for cleaner display
# If exactly on a tag, keeps as-is (e.g., "v0.26.1")
if [[ "$RAW_VERSION" =~ ^(v[0-9]+\.[0-9]+\.[0-9]+)-([0-9]+)-g[a-f0-9]+$ ]]; then
    VERSION="${BASH_REMATCH[1]}+${BASH_REMATCH[2]}"
else
    VERSION="$RAW_VERSION"
fi

# Extract numeric version without 'v' prefix and '+N' suffix for package.json
NUMERIC_VERSION="${VERSION#v}"
NUMERIC_VERSION="${NUMERIC_VERSION%+*}"

# If version isn't valid semver (e.g. bare commit SHA on PR builds),
# fall back to the version already in package.json
if ! [[ "$NUMERIC_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    ELECTRON_PKG="$REPO_ROOT/apps/electron/package.json"
    FALLBACK=$(grep -o '"version": *"[^"]*"' "$ELECTRON_PKG" | head -1 | sed 's/"version": *"//;s/"//')
    echo "WARNING: '$NUMERIC_VERSION' is not valid semver, falling back to package.json version: $FALLBACK"
    NUMERIC_VERSION="$FALLBACK"
    VERSION="v$FALLBACK"
fi

# Update frontend version.ts
VERSION_FILE="$REPO_ROOT/packages/frontend/src/version.ts"
cat > "$VERSION_FILE" << EOF
// This file is updated automatically by the release process
// Run: npm run update-version or ./scripts/update-version.sh
export const APP_VERSION = '${VERSION}';
EOF
echo "Updated $VERSION_FILE to version: $VERSION"

# Update Electron package.json (critical for app.getVersion() in updater)
ELECTRON_PKG="$REPO_ROOT/apps/electron/package.json"
if [ -f "$ELECTRON_PKG" ]; then
    # Use sed to update the version field
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$NUMERIC_VERSION\"/" "$ELECTRON_PKG"
    else
        sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$NUMERIC_VERSION\"/" "$ELECTRON_PKG"
    fi
    echo "Updated $ELECTRON_PKG to version: $NUMERIC_VERSION"
fi

# Update backend pyproject.toml
PYPROJECT="$REPO_ROOT/packages/backend/pyproject.toml"
if [ -f "$PYPROJECT" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/^version = \"[^\"]*\"/version = \"$NUMERIC_VERSION\"/" "$PYPROJECT"
    else
        sed -i "s/^version = \"[^\"]*\"/version = \"$NUMERIC_VERSION\"/" "$PYPROJECT"
    fi
    echo "Updated $PYPROJECT to version: $NUMERIC_VERSION"
fi
