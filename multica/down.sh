#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="$HOME/.multica-selfhost/docker-compose.selfhost.yml"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Error: Multica compose file not found at $COMPOSE_FILE" >&2
  exit 1
fi

docker compose -f "$COMPOSE_FILE" down
echo "Multica stopped. Data volumes preserved."
echo "To wipe all data: docker compose -f $COMPOSE_FILE down -v"
