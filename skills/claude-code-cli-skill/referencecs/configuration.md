# Claude Code — Configuration Reference

## Configuration Hierarchy

Settings are applied from lowest to highest priority (higher overrides lower):

| Level | Location | Scope | Overridable |
|-------|----------|-------|-------------|
| Enterprise | `/etc/claude-code/managed-settings.json` (Linux)<br>`/Library/Application Support/ClaudeCode/managed-settings.json` (macOS)<br>`C:\Program Files\ClaudeCode\managed-settings.json` (Windows) | All users | ❌ No |
| CLI flags | Command-line arguments | Current session | ✅ Yes |
| Local project | `.claude/settings.local.json` | Personal / current project | ✅ Yes |
| Shared project | `.claude/settings.json` | Team (check into git) | ✅ Yes |
| User global | `~/.claude/settings.json` | All your projects | ✅ Yes |
| Runtime state | `~/.claude.json` | OAuth, MCP state | N/A |

**Tip:** Use `.claude/settings.local.json` for personal preferences; add it to `.gitignore`.
Use `.claude/settings.json` for team-wide config that lives in version control.

---

## settings.json — Full Example

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "model": "claude-sonnet-4-6",
  "permissions": {
    "allow": [
      "Read",
      "Glob",
      "Grep",
      "Bash(npm run:*)",
      "Bash(git:*)",
      "Bash(make:*)",
      "Edit(src/**)",
      "Write(src/**)"
    ],
    "deny": [
      "Read(.env*)",
      "Read(secrets/**)",
      "Bash(rm -rf:*)",
      "Bash(sudo:*)",
      "Edit(package-lock.json)"
    ],
    "ask": [
      "WebFetch",
      "Bash(curl:*)",
      "Bash(docker:*)"
    ],
    "additionalDirectories": [
      "../shared-lib",
      "../docs"
    ],
    "defaultMode": "acceptEdits"
  },
  "env": {
    "NODE_ENV": "development",
    "DEBUG": "app:*"
  },
  "hooks": {
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
    ]
  },
  "includeCoAuthoredBy": true,
  "cleanupPeriodDays": 30,
  "outputStyle": "Explanatory",
  "respectGitignore": true,
  "showTurnDuration": true
}
```

---

## .claude/ Directory Structure

```
your-project/
├── .claude/
│   ├── settings.json        # Team config (commit to git)
│   ├── settings.local.json  # Personal config (gitignore this)
│   ├── commands/            # Custom slash commands (legacy, still works)
│   │   └── fix-issue.md     # Available as /fix-issue
│   ├── skills/              # Skills (recommended for new work)
│   │   └── my-skill/
│   │       └── SKILL.md
│   ├── agents/              # Custom subagents
│   │   └── reviewer.md
│   └── plans/               # Plan mode outputs
└── CLAUDE.md                # Project memory file
```

**Global equivalents** (apply to all projects):
```
~/.claude/
├── settings.json
├── commands/
├── skills/
├── agents/
└── CLAUDE.md
```

---

## CLAUDE.md — Memory Files

CLAUDE.md files provide persistent context. Claude reads them every session — no need to re-explain conventions.

**Loading hierarchy:**
1. `~/.claude/CLAUDE.md` — global (all projects)
2. `./CLAUDE.md` — project root
3. Subdirectory `CLAUDE.md` files — component-specific

**Good things to put in CLAUDE.md:**
```markdown
# Project Context

## Build & Run
- `npm run dev` — start dev server (port 3000)
- `npm test` — run tests
- `npm run lint` — ESLint + Prettier check

## Architecture
- Frontend: Next.js + TypeScript
- Backend: Express.js + PostgreSQL (Prisma ORM)
- Auth: JWT with refresh tokens in httpOnly cookies

## Coding Standards
- TypeScript strict mode; no `any`
- Functional React components with hooks only
- Tests alongside source files: `Button.test.tsx`
- ESLint config in `.eslintrc.js` — run before committing

## Important Paths
- API routes: `src/routes/`
- React components: `src/components/`
- DB migrations: `prisma/migrations/`

## Do Not Touch
- `package-lock.json` — managed by CI
- `.env.production` — secrets, never edit directly
```

**Quick add during session:**
```
# Use 2-space indentation for all JS/TS files
```
Type `#` at the start of a message to instantly add a note to CLAUDE.md.
