#!/bin/bash
# Update version.ts from the current git tag
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

# Update frontend version.ts
VERSION_FILE="$REPO_ROOT/packages/frontend/src/version.ts"
cat > "$VERSION_FILE" << EOF
// This file is updated automatically by the release process
// Run: npm run update-version or ./scripts/update-version.sh
export const APP_VERSION = '${VERSION}';
EOF

echo "Updated $VERSION_FILE to version: $VERSION"
