---
name: codex-cli-skill
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

## Known Pitfalls & Gotchas

### `codex exec resume` — 与 `codex exec` 支持的 flag 不同
`codex exec resume` 是独立子命令，**不支持** `codex exec` 的部分 flag，使用时会报 `unexpected argument` 错误：

| Flag | `codex exec` | `codex exec resume` |
|------|:---:|:---:|
| `-C / --cd` | ✅ | ❌ 会报错 |
| `--skip-git-repo-check` | ✅ | ✅ 支持 |
| `--json` | ✅ | ✅ 支持 |
| `--full-auto` | ✅ | ✅ 支持 |
| `--model` | ✅ | ✅ 支持 |

正确用法：
```bash
# 新会话（支持 -C）
codex exec --json --full-auto --skip-git-repo-check -C /path/to/workspace "prompt"

# Resume 会话（不加 -C，用 spawn cwd 或外部切目录代替）
codex exec resume --json --full-auto --skip-git-repo-check <SESSION_ID> "follow-up prompt"
```

> **解决方案**：通过 Node `spawn(cmd, args, { cwd: workspacePath })` 设置工作目录，而不是依赖 `-C` flag。这样 resume 和新会话统一用 `cwd` 控制目录。

### `--session` flag 不存在
某些版本文档或第三方参考提到 `--session`，实际上 Codex CLI 并不存在此 flag，会报 `unexpected argument '--session' found`。正确方式是 `codex exec resume <SESSION_ID>`。

### resume 的 session 作用域：只找当前目录的 session
`codex exec resume --last` 默认只在当前 `cwd` 查找最近 session。如果进程 `cwd` 与 session 保存时的目录不同，会找不到。加 `--all` 可跨目录搜索，但会弹选择界面不适合非交互场景。建议明确传 `<SESSION_ID>`。

### `--skip-git-repo-check` 必须显式传递
在非 git 仓库目录或"不被信任"的目录运行时，Codex 会报：
```
Not inside a trusted directory and --skip-git-repo-check was not specified.
```
在程序化调用（非交互）场景下务必添加此 flag，**新会话和 resume 均需要**。

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
