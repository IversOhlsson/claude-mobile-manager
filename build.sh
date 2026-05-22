#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

source .env

echo "Building Claude Code Manager (version ${MANAGER_VERSION})..."
docker compose build --no-cache
echo "Build complete."
