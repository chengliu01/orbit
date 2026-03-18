# Codex CLI — Complete Flag Reference

## Global Flags

These apply to `codex` (TUI) and propagate to subcommands unless overridden.
Place global flags **after** the subcommand: `codex exec --oss ...`

| Flag | Type/Values | Description |
|------|-------------|-------------|
| `--add-dir` | `path` | Grant write access to additional directories (repeatable) |
| `--ask-for-approval, -a` | `untrusted\|on-failure\|on-request\|never` | Controls when Codex pauses for human approval before running a command |
| `--cd, -C` | `path` | Set working directory before agent starts |
| `--config, -c` | `key=value` | Override config values (JSON-parsed if possible, else literal string) |
| `--dangerously-bypass-approvals-and-sandbox, --yolo` | boolean | ⚠️ Skip all approvals and sandboxing. Only use inside hardened environment |
| `--disable` | `feature` | Force-disable a feature flag (`-c features.<n>=false`). Repeatable |
| `--enable` | `feature` | Force-enable a feature flag (`-c features.<n>=true`). Repeatable |
| `--full-auto` | boolean | Preset: `--ask-for-approval on-request` + `--sandbox workspace-write` |
| `--image, -i` | `path[,path...]` | Attach image files to initial prompt (comma-separated or repeatable) |
| `--model, -m` | string | Override model from config (e.g. `gpt-5-codex`) |
| `--no-alt-screen` | boolean | Disable TUI alternate screen mode |
| `--oss` | boolean | Use local OSS provider (`model_provider="oss"`); requires Ollama running |
| `--profile, -p` | string | Load named config profile from `~/.codex/config.toml` |
| `--sandbox, -s` | `read-only\|workspace-write\|danger-full-access` | Sandbox policy for model-generated shell commands |
| `--search` | boolean | Enable live web search (default is cached mode) |
| `PROMPT` | string | Optional prompt to pre-fill TUI or start non-interactive session |

---

## `codex exec` Flags

Non-interactive runs for scripted/CI use. Alias: `codex e`.

| Flag | Type/Values | Description |
|------|-------------|-------------|
| `--cd, -C` | `path` | Set workspace root before executing |
| `--color` | `always\|never\|auto` | Control ANSI color output |
| `--dangerously-bypass-approvals-and-sandbox, --yolo` | boolean | ⚠️ Bypass approvals/sandboxing |
| `--ephemeral` | boolean | Run without persisting session files to disk |
| `--full-auto` | boolean | `workspace-write` sandbox + `on-request` approvals |
| `--image, -i` | `path[,path...]` | Attach images to first message |
| `--json, --experimental-json` | boolean | Output newline-delimited JSON events instead of formatted text |
| `--model, -m` | string | Override configured model |
| `--oss` | boolean | Use local OSS provider (requires Ollama) |
| `--output-last-message, -o` | `path` | Write assistant's final message to file |
| `--output-schema` | `path` | JSON Schema for validating tool output shape |
| `--profile, -p` | string | Select config profile from config.toml |
| `--sandbox, -s` | `read-only\|workspace-write\|danger-full-access` | Sandbox policy |
| `--skip-git-repo-check` | boolean | Allow running outside a Git repo |
| `-c, --config` | `key=value` | Inline config override (repeatable) |
| `PROMPT` | `string\|-` | Task prompt. Use `-` to read from stdin |

### `codex exec resume` Flags

| Flag | Type/Values | Description |
|------|-------------|-------------|
| `--all` | boolean | Include sessions from any directory (not just cwd) |
| `--image, -i` | `path[,path...]` | Attach images to follow-up prompt |
| `--last` | boolean | Resume most recent session from cwd |
| `PROMPT` | `string\|-` | Optional follow-up prompt after resuming |
| `SESSION_ID` | uuid | Resume specific session by ID |

---

## `codex resume` Flags

Continue a previous interactive (TUI) session.

| Flag | Type/Values | Description |
|------|-------------|-------------|
| `--all` | boolean | Include sessions outside cwd |
| `--last` | boolean | Skip picker; resume most recent from cwd |
| `SESSION_ID` | uuid | Resume specific session |

---

## `codex fork` Flags

Fork a session into a new thread (original transcript preserved).

| Flag | Type/Values | Description |
|------|-------------|-------------|
| `--all` | boolean | Show sessions beyond cwd in picker |
| `--last` | boolean | Fork most recent session automatically |
| `SESSION_ID` | uuid | Fork specific session |

---

## `codex login` Flags

| Flag | Type/Values | Description |
|------|-------------|-------------|
| `--device-auth` | boolean | Use OAuth device code flow (no browser) |
| `--with-api-key` | boolean | Read API key from stdin |
| `status` subcommand | — | Print auth mode; exits 0 when logged in |

---

## `codex cloud` Flags

| Flag | Type/Values | Description |
|------|-------------|-------------|
| `--attempts` | `1-4` | Best-of-N attempts for the cloud task |
| `--env` | `ENV_ID` | Target Codex Cloud environment (required for `exec`) |
| `QUERY` | string | Task prompt (interactive picker if omitted) |

### `codex cloud list` Flags

| Flag | Type/Values | Description |
|------|-------------|-------------|
| `--cursor` | string | Pagination cursor from previous request |
| `--env` | `ENV_ID` | Filter by environment |
| `--json` | boolean | Machine-readable JSON output |
| `--limit` | `1-20` | Max tasks to return |

---

## `codex app` Flags (macOS only)

| Flag | Type/Values | Description |
|------|-------------|-------------|
| `--download-url` | url | Override DMG download URL for install |
| `PATH` | path | Workspace path to open in Codex Desktop |

---

## `codex app-server` Flags

| Flag | Type/Values | Description |
|------|-------------|-------------|
| `--listen` | `stdio://\|ws://IP:PORT` | Transport URL. `ws://` is experimental |

---

## `codex mcp add` Flags

| Flag | Type/Values | Description |
|------|-------------|-------------|
| `--bearer-token-env-var` | `ENV_VAR` | Env var value sent as bearer token for HTTP servers |
| `--env KEY=VALUE` | repeatable | Env vars for stdio server launch |
| `--url` | `https://...` | Register streamable HTTP server (mutually exclusive with COMMAND) |
| `COMMAND...` | stdio transport | Executable + args to launch MCP server (after `--`) |

---

## `codex execpolicy` Flags

| Flag | Type/Values | Description |
|------|-------------|-------------|
| `--pretty` | boolean | Pretty-print JSON result |
| `--rules, -r` | path (repeatable) | Execpolicy rule file(s) to evaluate |
| `COMMAND...` | var-args | Command to check against policies |

---

## `codex sandbox` Flags

### macOS Seatbelt / Linux Landlock (same flags)

| Flag | Type/Values | Description |
|------|-------------|-------------|
| `--config, -c` | `key=value` | Config overrides for sandboxed run (repeatable) |
| `--full-auto` | boolean | Write access to cwd + `/tmp` |
| `COMMAND...` | var-args | Command to run under sandbox |

---

## `codex completion`

| Argument | Values | Description |
|----------|--------|-------------|
| `SHELL` | `bash\|zsh\|fish\|power-shell\|elvish` | Shell to generate completions for (output to stdout) |
