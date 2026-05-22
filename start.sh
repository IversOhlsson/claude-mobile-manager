#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

source .env

echo "Building and starting Claude Code Manager..."
docker compose up -d --build

echo ""
echo "Claude Code Manager running at http://localhost:${MANAGER_PORT}"
echo "Logs: docker compose logs -f"
