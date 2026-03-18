#!/usr/bin/env zsh

set -euo pipefail

sessions_dir="${HOME}/.codex/sessions"
session_file="${1:-}"

if [[ -z "${session_file}" ]]; then
  if [[ ! -d "${sessions_dir}" ]]; then
    echo "Codex sessions directory not found: ${sessions_dir}" >&2
    exit 1
  fi

  session_file="$(find "${sessions_dir}" -type f -name '*.jsonl' | sort | tail -n 1)"
fi

if [[ -z "${session_file}" || ! -f "${session_file}" ]]; then
  echo "Session file not found: ${session_file:-<latest session unavailable>}" >&2
  exit 1
fi

token_event="$(rg '"type":"token_count"' "${session_file}" | tail -n 1 || true)"

if [[ -z "${token_event}" ]]; then
  echo "No token_count event found in: ${session_file}" >&2
  exit 1
fi

printf '%s\n' "${token_event}" | jq -r '
  .payload.info as $info
  | $info.last_token_usage.total_tokens as $turn_used
  | $info.total_token_usage.total_tokens as $session_used
  | $info.model_context_window as $window
  | ($window - $turn_used) as $left
  | ($turn_used / $window * 100) as $used_pct
  | ($left / $window * 100) as $left_pct
  | "session: \(.timestamp)\nfile: '"${session_file}"'\nturn_used: \($turn_used)\nwindow: \($window)\nturn_left: \($left)\nturn_used_pct: \($used_pct|round)%\nturn_left_pct: \($left_pct|round)%\nsession_total_used: \($session_used)"
'
