#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
FRONTEND_FILE="$ROOT_DIR/orbit.html"

if [[ ! -f "$FRONTEND_FILE" ]]; then
  echo "Frontend entry not found: $FRONTEND_FILE"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found. Install Python 3 first."
  exit 1
fi

port_in_use() {
  command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

if port_in_use "$FRONTEND_PORT"; then
  echo "Port $FRONTEND_PORT is already in use."
  echo "Run with another port, for example: FRONTEND_PORT=3002 ./scripts/start-frontend.sh"
  exit 1
fi

echo "Starting Orbit frontend on http://localhost:$FRONTEND_PORT/orbit.html"
cd "$ROOT_DIR"
exec python3 -m http.server "$FRONTEND_PORT" --bind 127.0.0.1
