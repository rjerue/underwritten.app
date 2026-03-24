#!/bin/bash
set -e

# Ensure we are in the root directory
cd "$(dirname "$0")/.."

if [ -x "${HOME}/.vite-plus/bin/vp" ]; then
  VP_BIN="${HOME}/.vite-plus/bin/vp"
else
  VP_BIN="$(command -v vp)"
fi

echo "Building all packages..."
"${VP_BIN}" run build -r

# List of packages to check and publish in order
PACKAGES=(
  "packages/underwritten-bridge-contract"
  "packages/underwritten-bridge"
  "apps/cli"
  "apps/mcp"
)

for dir in "${PACKAGES[@]}"; do
  echo "---------------------------------------------------"
  echo "Checking $dir..."
  
  # Use a subshell to avoid changing the main directory
  (
    cd "$dir"
    PACKAGE_NAME=$(node -p "require('./package.json').name")
    PACKAGE_VERSION=$(node -p "require('./package.json').version")
    
    # Check if this version exists on npm
    if ! "${VP_BIN}" info "${PACKAGE_NAME}@${PACKAGE_VERSION}" version --json >/dev/null 2>&1; then
      echo "Publishing ${PACKAGE_NAME}@${PACKAGE_VERSION}..."
      "${VP_BIN}" pm publish --access public --no-git-checks
    else
      echo "${PACKAGE_NAME}@${PACKAGE_VERSION} is already published; skipping."
    fi
  )
done

echo "---------------------------------------------------"
echo "All packages processed."
