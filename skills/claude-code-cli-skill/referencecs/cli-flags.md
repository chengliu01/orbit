# Claude Code — CLI Flags Reference

## Shell Commands (outside a session)

| Command | Description |
|---------|-------------|
| `claude` | Start interactive REPL |
| `claude "query"` | Start REPL with initial prompt |
| `claude -p "query"` | Print mode: query once and exit |
| `claude -c` | Continue most recent conversation |
| `claude -c -p "query"` | Continue in print mode |
| `claude -r "ID" "query"` | Resume session by ID with follow-up |
| `claude --resume` | Interactive session picker |
| `claude update` | Update to latest version |
| `claude doctor` | Check installation and config health |
| `claude mcp` | Manage MCP servers |
| `claude auth login` | Log in / switch accounts |
| `claude auth status` | Check auth state |
| `claude auth logout` | Clear stored credentials |
| `claude install` | Migrate npm install to native binary |

---

## All CLI Flags

### Session & Interaction

| Flag | Description | Example |
|------|-------------|---------|
| `-p, --print` | Non-interactive: run once and exit | `claude -p "list TODOs"` |
| `-c, --continue` | Continue most recent conversation | `claude -c` |
| `-r, --resume [ID]` | Resume session by ID or open picker | `claude -r abc123 "follow up"` |
| `-n, --name NAME` | Name this session (v2.1.76+) | `claude -n "auth-refactor"` |
| `--from-pr PR` | Start session linked to a PR (v2.1.27+) | `claude --from-pr 123` |
| `--fork-session` | Fork the resumed session | `claude -r abc --fork-session` |

### Model & Output

| Flag | Values / Description | Example |
|------|----------------------|---------|
| `--model MODEL` | Override model for this session | `claude --model claude-opus-4-6` |
| `--output-format` | `text` (default) / `json` / `stream-json` | `claude -p "q" --output-format json` |
| `--input-format` | `text` / `stream-json` | `claude -p --input-format stream-json` |
| `--verbose` | Enable verbose/debug logging | `claude --verbose` |
| `--max-turns N` | Limit autonomous turns (use with `-p`) | `claude -p "fix" --max-turns 10` |

### Permissions & Tools

| Flag | Description | Example |
|------|-------------|---------|
| `--allowedTools TOOLS` | Pre-approve tools (skip prompts) | `--allowedTools "Edit,Bash(git *)"` |
| `--disallowedTools TOOLS` | Block specific tools | `--disallowedTools "Bash(rm *)"` |
| `--add-dir PATH` | Add extra writable directory | `--add-dir ../shared-lib` |
| `--dangerously-skip-permissions` | ⚠️ Skip ALL permission prompts | Use only in isolated CI environments |

### System Prompt Customization

| Flag | Description |
|------|-------------|
| `--system-prompt TEXT` | Replace the entire system prompt |
| `--system-prompt-file PATH` | Replace system prompt from a file (mutually exclusive with above) |
| `--append-system-prompt TEXT` | Append to built-in system prompt |
| `--append-system-prompt-file PATH` | Append from a file |

> **Tip:** Use append flags for most cases — they preserve Claude Code's built-in capabilities.
> Use replacement flags only when you need full control.

---

## Output Format Details

### JSON (`--output-format json`)
Single JSON object when session completes:
```json
{
  "type": "result",
  "subtype": "success",
  "result": "Response text here",
  "is_error": false,
  "total_cost_usd": 0.0034,
  "duration_ms": 2847,
  "duration_api_ms": 1923,
  "num_turns": 4,
  "session_id": "abc-123-def"
}
```

### Stream JSON (`--output-format stream-json`)
Newline-delimited JSON events, one per state change. Useful for real-time progress:
```bash
claude -p "build the app" --output-format stream-json | \
  while read line; do echo "$line" | jq -r 'select(.result) | .result'; done
```

### Exit Codes
| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (runtime, API, or Claude reported an error) |

---

## CI/CD Pattern

```bash
# GitHub Actions / CI pipeline
result=$(claude -p "review this diff for security issues" \
  --output-format json \
  --allowedTools "Read,Glob,Grep" \
  --max-turns 20 \
  2>/dev/null)

is_error=$(echo "$result" | jq -r '.is_error')
if [ "$is_error" = "true" ]; then
  echo "Review failed"
  exit 1
fi

echo "$result" | jq -r '.result'
```

---

## Model IDs (as of March 2026)

| Model | ID | Best For |
|-------|----|----------|
| Claude Opus 4.6 | `claude-opus-4-6` | Complex reasoning, architecture |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | General coding (default) |
| Claude Haiku 4.5 | `claude-haiku-4-5-20251001` | Fast/cheap subagent exploration |

**Pricing rule of thumb:** Haiku ~5x cheaper than Opus. Route exploration subagents to Haiku; save Opus for hard problems.

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | API key authentication |
| `DISABLE_AUTOUPDATER=1` | Disable automatic updates |
| `MAX_THINKING_TOKENS` | Cap extended thinking token budget |
| `CLAUDE_CODE_USE_BEDROCK=1` | Use AWS Bedrock |
| `CLAUDE_CODE_USE_VERTEX=1` | Use Google Vertex AI |
| `CLAUDE_CODE_USE_FOUNDRY=1` | Use Microsoft Foundry |
| `HTTPS_PROXY` | Corporate proxy URL |
| `AWS_REGION` | Bedrock region |
| `CLOUD_ML_REGION` | Vertex region |
| `ANTHROPIC_VERTEX_PROJECT_ID` | Vertex project |
