#!/usr/bin/env bash

# Share the same data as the Electron desktop app
export DB_PATH="$HOME/Library/Application Support/Orbit/data/orbit.db"
export WORKSPACE_ROOT="$HOME/orbit-workspace"

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/orbit-backend"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Install Node.js and npm first."
  exit 1
fi

if [[ ! -f "$BACKEND_DIR/package.json" ]]; then
  echo "Backend package.json not found: $BACKEND_DIR/package.json"
  exit 1
fi

if [[ ! -d "$BACKEND_DIR/node_modules" ]]; then
  echo "Dependencies are missing. Run: cd \"$BACKEND_DIR\" && npm install"
  exit 1
fi

PORT="${PORT:-3001}"

port_in_use() {
  command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

if port_in_use "$PORT"; then
  echo "Port $PORT is already in use."
  echo "Stop the existing process or run with another port, for example: PORT=3002 ./scripts/start-backend.sh"
  exit 1
fi

echo "Starting Orbit backend on http://localhost:$PORT"
if [[ "$PORT" != "3001" ]]; then
  echo "Open the frontend with: /orbit.html?apiOrigin=http://localhost:$PORT&wsOrigin=ws://localhost:$PORT"
fi
cd "$BACKEND_DIR"
PORT="$PORT" npm run dev
