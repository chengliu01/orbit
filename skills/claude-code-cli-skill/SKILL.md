---
name: claude-code-cli-skill
description: >
  Complete reference and usage guide for Claude Code — Anthropic's agentic CLI coding
  assistant. Use this skill whenever the user asks about: installing or configuring
  Claude Code, claude CLI flags and commands, slash commands (/init /clear /compact etc.),
  CLAUDE.md memory files, hooks automation, MCP server integration, subagents, skills
  system, permissions and security, session management, plan mode, non-interactive
  scripting with -p flag, CI/CD integration, or any question about using Claude Code
  effectively. Also trigger when users ask about claude -p, --dangerously-skip-permissions,
  settings.json, .claude/ directory structure, or agentic coding workflows.
---

# Claude Code Reference Skill

Claude Code is Anthropic's agentic CLI that reads your codebase, edits files, runs
commands, and helps you code through natural language conversation in the terminal.

For full CLI flags → `references/cli-flags.md`  
For slash commands, hooks, MCP, subagents, skills → `references/features.md`  
For configuration files and CLAUDE.md → `references/configuration.md`

---

## Installation

```bash
# Recommended: native binary
curl -fsSL https://claude.ai/install.sh | bash   # macOS / Linux
brew install --cask claude-code                   # macOS Homebrew
irm https://claude.ai/install.ps1 | iex          # Windows PowerShell

# Legacy (deprecated as of v2.1.15)
npm install -g @anthropic-ai/claude-code          # Requires Node.js 18+

# Migrate from npm to native binary
claude install

# Verify installation
claude doctor
```

**Authentication:**
```bash
claude auth login        # Browser OAuth (Claude Pro/Max subscription)
claude auth status       # Check auth state
claude auth logout       # Clear credentials

# API key alternative
export ANTHROPIC_API_KEY="sk-ant-..."
```

---

## Quick Start

```bash
claude                              # Interactive REPL in current directory
claude "explain this codebase"      # REPL with initial prompt
claude -p "count lines by type"     # Print mode: run once and exit
claude -c                           # Continue most recent session
claude --resume                     # Pick from session list
```

**First things first:** Run `/init` in a new project to generate a `CLAUDE.md` with
architecture notes. This single file is the highest-leverage thing you can do for quality.

---

## Core Interaction Modes

### Interactive REPL
```bash
claude                        # Launch in current directory
claude "fix the failing tests" # Pre-fill prompt
```

Inside the REPL, use:
- `@./path/to/file` — reference a file or directory
- `!npm test` — run a shell command directly
- `# note to remember` — quickly add something to CLAUDE.md memory

### Print Mode (`-p`) — scripting / CI
```bash
claude -p "review this file for security issues"
cat error.log | claude -p "identify the root cause"
claude -p "generate a changelog" > CHANGELOG.md

# JSON output for scripting
claude -p "count todos" --output-format json
claude -p "run lint" --output-format stream-json | jq -r '.result'

# Limit turns, allow tools without prompting
claude -p "fix lint errors" --max-turns 5 --allowedTools "Edit,Bash(npm run lint)"
```

JSON output fields: `type`, `result`, `is_error`, `total_cost_usd`, `duration_ms`, `session_id`

### Session Management
```bash
claude -c                          # Continue most recent session
claude -c -p "now add tests"       # Continue in print mode
claude -r "SESSION_ID" "follow up" # Resume specific session
claude --resume                    # Interactive session picker
claude -n "auth-refactor"          # Name a new session (v2.1.76+)
```

### Plan Mode
Press `Shift+Tab` to cycle: `normal → plan → auto-accept`

In plan mode Claude only uses read-only tools (Read, Glob, Grep, WebSearch) and writes
a plan to `.claude/plans/`. No edits happen until you approve. Use for complex
refactors and unfamiliar codebases.

---

## Key CLI Flags

| Flag | Description |
|------|-------------|
| `-p, --print` | Non-interactive print mode |
| `-c, --continue` | Continue most recent conversation |
| `-r, --resume ID` | Resume session by ID |
| `-n, --name NAME` | Name the session |
| `--model MODEL` | Override model (e.g. `claude-opus-4-6`) |
| `--add-dir PATH` | Add extra working directory |
| `--allowedTools TOOLS` | Pre-approve tools (no prompts) |
| `--disallowedTools TOOLS` | Block specific tools |
| `--max-turns N` | Limit agentic turns |
| `--output-format` | `text` / `json` / `stream-json` |
| `--system-prompt TEXT` | Replace system prompt |
| `--append-system-prompt TEXT` | Append to system prompt |
| `--verbose` | Enable verbose logging |
| `--dangerously-skip-permissions` | ⚠️ Skip ALL permission prompts |

Full flag reference → `references/cli-flags.md`

---

## Built-in Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | List all commands (built-in + custom) |
| `/init` | Generate CLAUDE.md for this project |
| `/clear` | Reset conversation context |
| `/compact` | Summarize context to free up tokens |
| `/cost` | Show token usage and cost for session |
| `/model` | Switch model interactively |
| `/config` | Open settings interface |
| `/permissions` | View/update tool permissions |
| `/allowed-tools` | Configure tool permissions |
| `/hooks` | Configure hooks |
| `/mcp` | Manage MCP servers |
| `/agents` | Manage subagents |
| `/rename NAME` | Rename current session |
| `/resume` | Resume a previous session |
| `/plan [desc]` | Enter plan mode |
| `/vim` | Enable Vim editing mode |
| `/export [file]` | Export conversation |
| `/terminal-setup` | Install terminal shortcuts |

---

## Key Patterns

### Reference files and run shell commands
```
> Review @./src/auth.ts for security issues
> Compare @./old.js and @./new.js
> !npm test
> !git status
```

### Context hygiene
```
/clear                    # Start fresh for a new task
/compact                  # Summarize when context is large
/cost                     # Check spend before a long task
```

### Safety tips
- Review changes before accepting
- Use `.claude/settings.local.json` for personal/sensitive settings (add to `.gitignore`)
- Never commit `.env` — deny CC access to it in settings.json
- Prefer `--allowedTools` for CI over `--dangerously-skip-permissions`

---

## Five Core Systems (Power User Path)

1. **Configuration hierarchy** → `references/configuration.md`
2. **Permission system** → `references/features.md#permissions`
3. **Hooks** (deterministic automation) → `references/features.md#hooks`
4. **MCP** (tool integrations) → `references/features.md#mcp`
5. **Subagents** (delegation / context isolation) → `references/features.md#subagents`
