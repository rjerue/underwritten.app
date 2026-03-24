#!/bin/bash
set -e

# Ensure we are in the root directory
cd "$(dirname "$0")/.."

echo "Building all packages..."
vp run build -r

# List of packages to check and publish in order
PACKAGES=(
  "packages/underwritten-bridge-contract"
  "packages/underwritten-bridge"
  "apps/cli"
  "apps/mcp"
)

# Detect if we should use provenance (recommended for CI/OIDC)
PROVENANCE_FLAG=""
if [ "$GITHUB_ACTIONS" = "true" ]; then
  PROVENANCE_FLAG="--provenance"
fi

for dir in "${PACKAGES[@]}"; do
  echo "---------------------------------------------------"
  echo "Checking $dir..."
  
  # Use a subshell to avoid changing the main directory
  (
    cd "$dir"
    PACKAGE_NAME=$(node -p "require('./package.json').name")
    PACKAGE_VERSION=$(node -p "require('./package.json').version")
    
    # Check if this version exists on npm
    if ! vp info "${PACKAGE_NAME}@${PACKAGE_VERSION}" version --json >/dev/null 2>&1; then
      echo "Publishing ${PACKAGE_NAME}@${PACKAGE_VERSION}..."
      vp pm publish --access public --no-git-checks $PROVENANCE_FLAG
    else
      echo "${PACKAGE_NAME}@${PACKAGE_VERSION} is already published; skipping."
    fi
  )
done

echo "---------------------------------------------------"
echo "All packages processed."
