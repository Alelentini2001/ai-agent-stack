#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="$HOME/.multica-selfhost/docker-compose.selfhost.yml"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Error: Multica compose file not found at $COMPOSE_FILE" >&2
  echo "Run the installer first: see tools/agent-stack/multica/README.md" >&2
  exit 1
fi

docker compose -f "$COMPOSE_FILE" up -d
echo "Multica is up — backend: http://localhost:8080  frontend: http://localhost:3010"
