---
name: codex-cli
description: >
  Complete reference and usage guide for the OpenAI Codex CLI tool. Use this skill
  whenever the user asks about: running codex commands, codex CLI flags or options,
  codex exec/resume/fork/login/mcp subcommands, codex sandbox policies, codex cloud
  tasks, non-interactive automation with codex, or anything involving the `codex`
  terminal client. Also trigger when users ask how to run Codex in CI/CD, how to
  configure Codex from the command line, or how to use Codex with MCP servers.
---

# Codex CLI Reference Skill

This skill covers every documented Codex CLI command, flag, and subcommand.
Configuration defaults are loaded from `~/.codex/config.toml`; any `-c key=value`
overrides passed at invocation take precedence for that run.

For detailed flag tables, see `references/flags.md`.  
For command-specific details and examples, see `references/commands.md`.

---

## Quick Start

```bash
codex                              # Launch interactive TUI
codex "fix the failing tests"      # TUI with pre-filled prompt
codex exec "add docstrings" --full-auto   # Non-interactive run
codex resume --last                # Continue last session
codex login                        # Authenticate (browser OAuth)
```

---

## Command Overview

| Command | Maturity | Purpose |
|---------|----------|---------|
| `codex` | Stable | Interactive TUI; accepts global flags + optional prompt |
| `codex app` | Stable | Launch Codex Desktop on macOS |
| `codex app-server` | Experimental | Launch app server for local dev/debug |
| `codex apply` | Stable | Apply Codex Cloud task diff to local working tree |
| `codex cloud` | Experimental | Browse/submit Codex Cloud tasks from terminal |
| `codex completion` | Stable | Generate shell completions (bash/zsh/fish/powershell) |
| `codex exec` | Stable | Non-interactive / CI run (alias: `codex e`) |
| `codex execpolicy` | Experimental | Test execpolicy rule files |
| `codex features` | Stable | Manage feature flags in config.toml |
| `codex fork` | Stable | Fork a previous session into a new thread |
| `codex login` | Stable | Authenticate via OAuth or API key |
| `codex logout` | Stable | Remove stored credentials |
| `codex mcp` | Experimental | Manage MCP servers (list/add/remove/auth) |
| `codex mcp-server` | Experimental | Run Codex as an MCP server over stdio |
| `codex resume` | Stable | Continue a previous interactive session |
| `codex sandbox` | Experimental | Run commands inside Codex sandbox policies |

---

## Key Global Flags (apply to all commands)

| Flag | Values | Purpose |
|------|--------|---------|
| `--ask-for-approval, -a` | `untrusted\|on-failure\|on-request\|never` | When to pause for human approval |
| `--full-auto` | boolean | Preset: `workspace-write` sandbox + `on-request` approvals |
| `--sandbox, -s` | `read-only\|workspace-write\|danger-full-access` | Sandbox policy for model commands |
| `--model, -m` | string | Override configured model |
| `--config, -c` | `key=value` | Inline config override (repeatable) |
| `--profile, -p` | string | Load a config profile from `config.toml` |
| `--add-dir` | path | Grant write access to additional directories |
| `--cd, -C` | path | Set working directory before agent starts |
| `--image, -i` | `path[,path...]` | Attach images to initial prompt |
| `--dangerously-bypass-approvals-and-sandbox, --yolo` | boolean | ⚠️ Skip all approvals/sandboxing |
| `--search` | boolean | Enable live web search (default: cached) |
| `--oss` | boolean | Use local OSS provider via Ollama |

---

## Most-Used Workflows

### Interactive session
```bash
codex                                      # Plain TUI
codex --full-auto "refactor auth module"   # Auto-approve most commands
codex -m gpt-5-codex "write unit tests"   # Use specific model
codex -i screenshot.png "fix this UI bug" # Attach image
```

### Non-interactive / CI (`codex exec`)
```bash
codex exec "add JSDoc comments" --full-auto
codex exec - < prompt.txt                  # Read prompt from stdin
codex exec --json "run linter" | jq .      # JSONL output for scripting
codex exec --output-last-message result.md "summarize changes"
codex exec --ephemeral "one-off task"      # No session files saved
```

### Session management
```bash
codex resume --last             # Resume most recent session (TUI)
codex resume --last --all       # Include sessions from other directories
codex resume <SESSION_UUID>     # Resume specific session
codex fork --last               # Fork most recent session
codex exec resume --last "follow-up prompt"  # Resume non-interactive
```

### Authentication
```bash
codex login                        # Browser OAuth (default)
codex login --device-auth          # Device code flow (headless)
printenv OPENAI_API_KEY | codex login --with-api-key   # API key via stdin
codex login status                 # Check auth status (exits 0 if ok)
codex logout                       # Remove credentials
```

### Shell completions
```bash
codex completion zsh > "${fpath[1]}/_codex"   # Zsh
codex completion bash > /etc/bash_completion.d/codex  # Bash
```

---

## Safety Tips

- Use `--full-auto` for unattended local work; **avoid** combining with `--yolo` unless inside a dedicated VM.
- Prefer `--add-dir` over `--sandbox danger-full-access` when Codex needs extra write access.
- In CI, pair `--json` with `--output-last-message` for machine-readable progress + final summary.
- `--yolo` / `--dangerously-bypass-approvals-and-sandbox` should only be used inside an externally hardened environment.

---

## Further Details

- **All flag tables**: `references/flags.md`
- **Full subcommand docs with examples**: `references/commands.md`
- **Config file reference**: https://developers.openai.com/codex/config-reference
- **AGENTS.md guide**: https://developers.openai.com/codex/guides/agents-md
