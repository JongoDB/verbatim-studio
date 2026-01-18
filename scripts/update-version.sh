#!/bin/bash
# Update version.ts from the current git tag
# Usage: ./scripts/update-version.sh

set -e

# Get the git version
VERSION=$(git describe --tags --always 2>/dev/null || echo "dev")

# Update frontend version.ts
VERSION_FILE="packages/frontend/src/version.ts"
cat > "$VERSION_FILE" << EOF
// This file is updated automatically by the release process
// Run: npm run update-version or ./scripts/update-version.sh
export const APP_VERSION = '${VERSION}';
EOF

echo "Updated $VERSION_FILE to version: $VERSION"
