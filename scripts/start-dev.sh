#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_SCRIPT="$ROOT_DIR/scripts/start-backend.sh"
FRONTEND_SCRIPT="$ROOT_DIR/scripts/start-frontend.sh"

if [[ ! -x "$BACKEND_SCRIPT" ]]; then
  echo "Backend script is not executable: $BACKEND_SCRIPT"
  exit 1
fi

if [[ ! -x "$FRONTEND_SCRIPT" ]]; then
  echo "Frontend script is not executable: $FRONTEND_SCRIPT"
  exit 1
fi

backend_pid=""
frontend_pid=""
frontend_url="http://localhost:${FRONTEND_PORT:-3000}/orbit.html"

if [[ "${PORT:-3001}" != "3001" ]]; then
  frontend_url="${frontend_url}?apiOrigin=http://localhost:${PORT:-3001}&wsOrigin=ws://localhost:${PORT:-3001}"
fi

cleanup() {
  local exit_code=$?

  if [[ -n "$backend_pid" ]] && kill -0 "$backend_pid" >/dev/null 2>&1; then
    kill "$backend_pid" >/dev/null 2>&1 || true
  fi

  if [[ -n "$frontend_pid" ]] && kill -0 "$frontend_pid" >/dev/null 2>&1; then
    kill "$frontend_pid" >/dev/null 2>&1 || true
  fi

  wait >/dev/null 2>&1 || true
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

"$BACKEND_SCRIPT" &
backend_pid=$!

"$FRONTEND_SCRIPT" &
frontend_pid=$!

echo "Orbit dev started."
echo "Frontend: $frontend_url"
echo "Backend:  http://localhost:${PORT:-3001}"

while true; do
  if ! kill -0 "$backend_pid" >/dev/null 2>&1; then
    wait "$backend_pid" || true
    exit 1
  fi

  if ! kill -0 "$frontend_pid" >/dev/null 2>&1; then
    wait "$frontend_pid" || true
    exit 1
  fi

  sleep 1
done
