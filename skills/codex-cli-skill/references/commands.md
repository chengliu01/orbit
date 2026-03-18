# Codex CLI — Command Details & Examples

## `codex` (Interactive TUI)

Launches the terminal UI. Web search defaults to cached; use `--search` for live browsing.

```bash
# Basic launch
codex

# Pre-fill prompt
codex "explain what's happening in auth.py"

# Full-auto mode (most commands run without prompts)
codex --full-auto "refactor the payment module"

# Attach image
codex -i error_screenshot.png "why is this crashing?"

# Override model
codex -m gpt-5.3-codex "implement the TODO items"

# Use local Ollama model
codex --oss "quick code review"

# Enable live web search
codex --search "update dependencies to latest versions"
```

---

## `codex exec` — Non-interactive / CI

Runs Codex without interaction. Alias: `codex e`.

```bash
# Basic non-interactive run
codex exec "add unit tests for utils.py"

# Read prompt from stdin
echo "add error handling" | codex exec -
cat tasks.txt | codex exec -

# JSON output for scripting
codex exec --json "run linter" | jq '.type == "message"'

# Save final message to file
codex exec --output-last-message summary.md "describe all changes made"

# Full automation preset
codex exec --full-auto "fix all TypeScript errors"

# Ephemeral (no session files saved)
codex exec --ephemeral "one-time analysis"

# Custom working directory
codex exec --cd /path/to/project "install dependencies"

# Skip git check (for non-repo directories)
codex exec --skip-git-repo-check "process these files"

# With output schema validation
codex exec --output-schema response-schema.json "extract metadata"

# CI/CD pattern: JSONL + save last message
codex exec --json --output-last-message result.md --full-auto "run tests"
```

### Resume a non-interactive session

```bash
# Resume most recent exec session
codex exec resume --last

# Resume with follow-up
codex exec resume --last "now also add integration tests"

# Resume by session ID
codex exec resume abc123de-...

# Resume from any directory
codex exec resume --last --all
```

---

## `codex resume` — Continue Interactive Session

```bash
# Open session picker
codex resume

# Resume most recent
codex resume --last

# Resume across all directories
codex resume --last --all

# Resume specific session
codex resume abc123de-f456-...
```

---

## `codex fork` — Branch a Session

Preserves the original transcript; creates a new thread from that point.

```bash
# Open session picker
codex fork

# Fork most recent
codex fork --last

# Fork specific session
codex fork abc123de-f456-...

# Fork from sessions in any directory
codex fork --all
```

---

## `codex login` — Authentication

```bash
# Browser OAuth (default)
codex login

# Device code flow (headless / SSH)
codex login --device-auth

# API key via stdin
printenv OPENAI_API_KEY | codex login --with-api-key
echo "sk-..." | codex login --with-api-key

# Check auth status (exits 0 if authenticated)
codex login status
```

---

## `codex logout`

Removes all saved credentials (both API key and ChatGPT auth). No flags.

```bash
codex logout
```

---

## `codex apply` — Apply Cloud Task Diff

```bash
# Apply latest diff from a cloud task
codex apply <TASK_ID>
```

Exits non-zero if `git apply` fails (e.g., conflicts). You must be authenticated and have access to the task.

---

## `codex cloud` — Manage Cloud Tasks

```bash
# Interactive cloud task picker
codex cloud

# Submit a task directly
codex cloud exec --env <ENV_ID> "implement feature X"

# Submit with multiple attempts (best-of-N)
codex cloud exec --env <ENV_ID> --attempts 3 "fix this bug"

# List recent tasks
codex cloud list

# List filtered + JSON output
codex cloud list --env <ENV_ID> --json --limit 10

# Paginate
codex cloud list --cursor <cursor_from_previous>
```

JSON task object fields: `id`, `url`, `title`, `status`, `updated_at`, `environment_id`, `environment_label`, `summary`, `is_review`, `attempt_total`

---

## `codex features` — Feature Flags

```bash
# List all feature flags with maturity and state
codex features list

# Enable a feature (persists to config.toml)
codex features enable <feature-name>

# Disable a feature
codex features disable <feature-name>

# Per-profile management
codex features --profile ci enable <feature-name>
```

---

## `codex mcp` — MCP Server Management

```bash
# List configured servers
codex mcp list
codex mcp list --json

# Add stdio server
codex mcp add my-server -- npx -y my-mcp-server
codex mcp add my-server --env API_KEY=secret -- ./mcp-binary

# Add HTTP server
codex mcp add my-server --url https://mcp.example.com

# Add HTTP server with bearer token
codex mcp add my-server \
  --url https://mcp.example.com \
  --bearer-token-env-var MY_TOKEN

# Show server config
codex mcp get my-server
codex mcp get my-server --json

# Remove server
codex mcp remove my-server

# OAuth login/logout for HTTP servers
codex mcp login my-server
codex mcp login my-server --scopes read,write
codex mcp logout my-server
```

---

## `codex mcp-server`

Run Codex itself as an MCP server over stdio (useful when another agent consumes Codex).

```bash
codex mcp-server
```

Inherits global config overrides. Exits when the downstream client closes the connection.

---

## `codex app` (macOS only)

```bash
# Open Codex Desktop
codex app

# Open with specific workspace
codex app /path/to/project
```

---

## `codex app-server`

```bash
# Default: JSONL over stdio
codex app-server --listen stdio://

# WebSocket (experimental)
codex app-server --listen ws://127.0.0.1:8080
```

---

## `codex debug app-server send-message-v2`

Debug app-server V2 thread/turn flow.

```bash
codex debug app-server send-message-v2 "hello world"
```

---

## `codex execpolicy` — Policy Testing

```bash
# Check if a command would be allowed
codex execpolicy check \
  --rules ~/.codex/rules/my-rules.toml \
  -- git push

# Multiple rule files
codex execpolicy check \
  --rules rules1.toml \
  --rules rules2.toml \
  --pretty \
  -- rm -rf /tmp/test
```

Output shows the strictest decision and any matching rules.

---

## `codex sandbox` — Sandbox Helper

Run arbitrary commands under the same policies Codex uses.

```bash
# macOS Seatbelt
codex sandbox macos -- bash -c "make test"
codex sandbox macos --full-auto -- ./build.sh

# Linux Landlock
codex sandbox linux -- python run_tests.py
codex sandbox linux --full-auto -- make

# With config overrides
codex sandbox macos -c sandbox.allowed_paths='["/tmp"]' -- ./script.sh
```

---

## `codex completion` — Shell Completions

```bash
# Zsh
codex completion zsh > "${fpath[1]}/_codex"

# Bash
codex completion bash > /etc/bash_completion.d/codex

# Fish
codex completion fish > ~/.config/fish/completions/codex.fish

# PowerShell
codex completion power-shell | Out-String | Invoke-Expression
```

---

## Configuration Precedence

1. CLI flags / `-c key=value` overrides (highest priority)
2. Active `--profile` in `~/.codex/config.toml`
3. Root config in `~/.codex/config.toml`
4. Built-in defaults

See https://developers.openai.com/codex/config-basic#configuration-precedence
