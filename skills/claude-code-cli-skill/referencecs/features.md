# Claude Code — Advanced Features Reference

## Table of Contents
- [Permissions](#permissions)
- [Hooks](#hooks)
- [MCP (Model Context Protocol)](#mcp)
- [Subagents](#subagents)
- [Skills](#skills)
- [Custom Slash Commands](#custom-slash-commands)
- [Extended Thinking](#extended-thinking)
- [Keyboard Shortcuts](#keyboard-shortcuts)

---

## Permissions

Claude Code asks for approval before each tool use. Configure defaults to reduce friction.

### Permission Levels
- **allow** — runs without prompting
- **ask** — prompts each time (default for most tools)
- **deny** — always blocked

### Tool Types
| Tool | Description |
|------|-------------|
| `Read` | File reading |
| `Write` | File creation/modification |
| `Edit` | Patching existing files |
| `Bash` | Shell command execution |
| `Glob` / `Grep` | File search |
| `WebFetch` | Fetch URL contents |
| `mcp__SERVER_NAME` | Specific MCP server tools |

### Scoping Permissions
```json
{
  "permissions": {
    "allow": [
      "Read",
      "Write(src/**)",
      "Bash(npm run:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git push:*)"
    ],
    "deny": [
      "Read(.env*)",
      "Read(secrets/**)",
      "Bash(rm -rf:*)",
      "Bash(sudo:*)"
    ]
  }
}
```

### YOLO Mode (use carefully)
```bash
claude --dangerously-skip-permissions
```
Skips ALL prompts. Only use inside an isolated CI container or VM.

For CI, prefer explicit allow-listing:
```bash
claude -p "fix lint" --allowedTools "Edit,Bash(npm run lint)"
```

---

## Hooks

Hooks run shell commands automatically on specific events, regardless of model behavior.
Use hooks for things that **must always happen** (formatting, linting, security checks).

### Hook Events
| Event | When It Fires | Can Block |
|-------|---------------|-----------|
| `PreToolUse` | Before tool execution | ✅ Yes |
| `PostToolUse` | After tool execution | ❌ No |
| `UserPromptSubmit` | Before processing user input | ✅ Yes |
| `SessionStart` | At session startup | ❌ No |

### Hook Configuration
In `settings.json`:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write(*.py)|Edit(*.py)",
        "hooks": [
          {
            "type": "command",
            "command": "python -m black \"$FILE_PATH\""
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "npx prettier --write \"$FILE_PATH\""
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash(git push:*)",
        "hooks": [
          {
            "type": "command",
            "command": "npm test"
          }
        ]
      }
    ]
  }
}
```

### Hook Environment Variables
| Variable | Value |
|----------|-------|
| `$FILE_PATH` | Path of the file being edited/written |
| `$TOOL_NAME` | Name of the tool being invoked |
| `$SESSION_ID` | Current session ID |

### Common Hook Recipes
```json
// Auto-format on save (Prettier)
{ "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "npx prettier --write \"$FILE_PATH\"" }] }

// Run tests before git push
{ "matcher": "Bash(git push:*)", "hooks": [{ "type": "command", "command": "npm test" }] }

// Security scan on file write
{ "matcher": "Write", "hooks": [{ "type": "command", "command": "semgrep --config auto \"$FILE_PATH\"" }] }

// Type-check TypeScript on edit
{ "matcher": "Edit(*.ts)|Write(*.ts)", "hooks": [{ "type": "command", "command": "npx tsc --noEmit" }] }
```

---

## MCP

Model Context Protocol extends Claude Code with external tool integrations — databases, GitHub, Sentry, and 3,000+ services.

### Managing MCP Servers
```bash
# Add a stdio server
claude mcp add my-server -- /path/to/server arg1 arg2

# Add with environment variables
claude mcp add my-server -e API_KEY=your-key -- npx -y @modelcontextprotocol/server-github

# Add an HTTP server
claude mcp add my-server --url https://mcp.example.com

# List configured servers
claude mcp list

# Remove a server
claude mcp remove my-server
```

### Popular MCP Servers
```bash
# GitHub
claude mcp add github -e GITHUB_PERSONAL_ACCESS_TOKEN=token \
  -- npx -y @modelcontextprotocol/server-github

# Filesystem (expanded access)
claude mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem /allowed/path

# PostgreSQL
claude mcp add postgres -e DATABASE_URL=postgres://... \
  -- npx -y @modelcontextprotocol/server-postgres

# Brave Search
claude mcp add search -e BRAVE_API_KEY=key \
  -- npx -y @modelcontextprotocol/server-brave-search
```

### MCP in settings.json
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" }
    }
  }
}
```

### Using MCP Tools in Session
Once added, MCP tools appear in Claude's toolbox automatically. Reference them with:
```
/mcp            # View and manage connected MCP servers
```

---

## Subagents

Subagents are specialized Claude instances with isolated context windows. They let you
delegate work without bloating the main conversation — only summaries return to core context.

### Built-in Agent Types
| Agent | Best For |
|-------|----------|
| `Explore` | Read-only codebase exploration, finding files |
| `Plan` | Architecture and implementation planning |
| General-purpose | Default for most delegated tasks |

### Custom Subagent Config
Create `.claude/agents/reviewer.md`:
```markdown
---
name: reviewer
description: Use for thorough code reviews focusing on security and performance
model: claude-sonnet-4-6
color: orange
---

You are an expert code reviewer. When reviewing code:
1. Check for security vulnerabilities (injection, auth flaws, data exposure)
2. Identify performance bottlenecks
3. Assess maintainability and test coverage
4. Suggest specific improvements with examples

Be concise and actionable. Skip obvious issues.
```

### Managing Subagents
```
/agents         # Create, list, and edit subagents in session
```

### Subagent in a Skill (context: fork)
```markdown
---
name: deep-research
description: Research a topic thoroughly in an isolated context
context: fork
agent: Explore
---

Research $ARGUMENTS thoroughly:
1. Find relevant files using Glob and Grep
2. Read and analyze the code
3. Summarize findings with specific file references
```

### Cost Optimization with Subagents
- Route exploration to **Haiku** (fast, ~5x cheaper than Opus)
- Reserve **Opus** for final implementation decisions
- Each subagent gets a clean context window — no token debt from main conversation

---

## Skills

Skills are markdown-based domain expertise guides. Unlike slash commands (explicit invocation),
skills are **model-invoked** — Claude decides when to use them based on context.

### File Structure
```
.claude/skills/my-skill/
├── SKILL.md        # Required: frontmatter + instructions
├── scripts/        # Optional: executable helpers
├── references/     # Optional: docs loaded on demand
└── assets/         # Optional: templates, files
```

### SKILL.md Format
```markdown
---
name: add-tests
description: Generate comprehensive Jest tests for TypeScript functions. Use when
  the user asks to add tests, write tests, or improve test coverage.
---

# Add Tests Skill

When asked to write tests:
1. Read the source file to understand the function signatures
2. Identify edge cases, error paths, and happy paths
3. Generate tests using Jest + TypeScript
4. Place test file alongside source: `Button.test.tsx` next to `Button.tsx`
5. Run `npm test` to verify they pass

Test structure to follow:
- Group related tests with `describe`
- Use descriptive `it()` names: "should return null when input is empty"
- Mock external dependencies
- Aim for >80% branch coverage
```

### Slash Commands vs Skills
| | Slash Commands | Skills |
|--|----------------|--------|
| Invocation | Explicit `/command` | Model decides automatically |
| Location | `.claude/commands/` | `.claude/skills/` |
| Status | Legacy (still works) | Recommended for new work |
| Extra files | ❌ | ✅ Scripts, references, assets |
| Subagent support | ❌ | ✅ `context: fork` |

---

## Custom Slash Commands

Legacy system — still works, but Skills are recommended for new work.

### Create a Command
```bash
# Project command
mkdir -p .claude/commands
cat > .claude/commands/optimize.md << 'EOF'
Analyze this code for performance bottlenecks and suggest specific optimizations.
Focus on: algorithm complexity, unnecessary re-renders, N+1 queries, memory leaks.
EOF

# Personal command (all projects)
mkdir -p ~/.claude/commands
cat > ~/.claude/commands/security.md << 'EOF'
Review this code for security vulnerabilities:
- SQL/command injection
- Authentication/authorization flaws  
- Sensitive data exposure
- Input validation
EOF
```

### Commands with Arguments
```markdown
<!-- .claude/commands/fix-issue.md -->
---
allowed-tools: Bash(git add:*), Bash(git commit:*)
description: Fix a GitHub issue
---

## Context
- Current branch: !`git branch --show-current`
- Current diff: !`git diff HEAD`

Fix GitHub issue #$ARGUMENTS following our coding standards.
Create a commit with a descriptive message.
```

Usage: `/fix-issue 123`

---

## Extended Thinking

Lets Claude reason through problems before responding. Enabled by default.

```
Alt+T (Windows/Linux)    # Toggle extended thinking
Option+T (macOS)         # Toggle extended thinking
Ctrl+O                   # Toggle verbose mode (see thinking output)
```

```bash
# Cap thinking token budget
export MAX_THINKING_TOKENS=10000
```

Thinking tokens are billed the same as regular tokens. `Shift+Tab` in plan mode gives
Claude dedicated exploration time without wasting tokens on edits.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Cancel current response |
| `Ctrl+D` | Exit Claude Code |
| `Esc` | Stop generation (without exiting) |
| `Esc Esc` | Show list of previous messages to jump to |
| `Shift+Tab` | Cycle: normal → plan → auto-accept mode |
| `Alt+T` / `Option+T` | Toggle extended thinking |
| `Ctrl+O` | Toggle verbose mode |
| `↑` | Navigate to previous messages/sessions |
| `Ctrl+V` | Paste image from clipboard (not Cmd+V on macOS) |

**macOS note:** Use `Ctrl+V` (not `Cmd+V`) to paste images from clipboard.
Hold `Shift` when dragging a file into the terminal to reference it (vs opening in new tab).
