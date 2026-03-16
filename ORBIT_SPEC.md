# Orbit — 完整项目规格文档

> **给 Claude Code 的阅读说明**
> 本文档是 Orbit 项目的完整规格，分为两大部分：
> - **第 0 章**：项目全景介绍，请务必完整阅读，这是理解所有后续决策的前提
> - **第 1-11 章**：后端实现规格，按章节顺序执行
>
> 项目前端（`orbit.html`，单文件 React MVP）已完成，你的任务是实现配套后端并最终将前端从 mock 数据切换到真实 API。

---

## 0. 项目全景

### 0.1 产品定义

**Orbit** 是一个以 Todo 为核心的 AI 协作工作台。本质是一个**日历式 Todo 管理器**，但每个 Todo 可以选择性地绑定一个或多个 **CLI Agent**（底层为 `codex` 或 `claude-code` 命令行工具），由 Agent 在对应的文件夹工作区内自主完成任务。

**核心理念**：Todo 是锚点，Agent 是执行者。用户保持对任务全局的掌控，Agent 处理具体的代码、文档、分析工作，两者通过结构化的文件系统和实时消息流紧密协作。

**目标用户**：开发者、技术型个人用户，习惯在本地运行 `codex` / `claude-code`，希望将 AI 辅助工作流与任务管理统一在一个界面中。

---

### 0.2 核心功能矩阵

| 功能模块 | 说明 | 当前状态 |
|----------|------|----------|
| **Todo 管理** | 创建/删除/完成/编辑 Todo，支持无限层级子 Todo，标题+备注均为 Markdown 实时渲染 | ✅ 前端 mock 完成 |
| **日历侧边栏** | 按日期组织 Todo，显示完成进度，支持跨日期关键词搜索 | ✅ 前端 mock 完成 |
| **Agent 管理** | 为每个 Todo 创建 1 对多 Agent，选择 CLI 类型（codex/claude-code）和模型 | ✅ 前端 mock 完成 |
| **Agent 实时输出** | 将 Agent 的思考过程、工具调用、执行结果以结构化消息流展示给用户 | ✅ 前端 mock 完成 |
| **用户 ↔ Agent 对话** | 用户可在 Agent 运行中发送消息（含图片/文件附件），Agent 实时响应 | ✅ 前端 mock 完成 |
| **文件系统映射** | 每个 Todo 对应唯一文件夹（UUID 命名），Agent 在其中工作，删除 Todo 即清理全部文件 | ✅ 前端设计完成 |
| **WORKSPACE.md** | Agent 启动时自动生成工作区说明文件，包含任务描述、目录权限表、已创建文件列表 | ✅ 前端设计完成 |
| **后端 + 真实 Agent 调用** | Node.js 后端，PTY 进程管理，WebSocket 实时流，SQLite 持久化 | ❌ **待实现** |

---

### 0.3 前端现状（`orbit.html`）

前端是一个**单文件 HTML + React**，无构建工具，直接在浏览器打开即可运行。所有数据均为 mock，通过 `useState` 维护在内存中。

**文件位置**：`orbit.html`（与本文档同目录）

**前端技术细节**：
- React 18，从 `cdnjs.cloudflare.com` 加载，纯 `React.createElement` 写法（无 JSX/Babel）
- 无路由，单页应用
- 全部样式内联 `<style>`，CSS 变量，深色主题（`--bg0: #0e0e10`）
- 无外部字体依赖，使用系统字体栈

**前端已实现的 UI 模块**：

```
App
├── Sidebar                    # 左侧，200px
│   ├── 搜索框                  # 实时过滤，显示 sr-item 结果列表
│   └── 日期列表                # 点击切换当前日期，显示完成进度
├── 主区域（TodoList）          # 中间，flex:1
│   └── TodoCard               # 每个根 Todo 一张卡片
│       ├── 标题（双击编辑）
│       ├── Markdown 备注（split-pane：左侧编辑，右侧实时预览）
│       └── 子 Todo 列表
└── AgentPanel                 # 右侧，340px
    ├── Tab 栏（多 Agent 切换）
    ├── StatusBar              # running 动画 + context 进度条
    ├── ChatThread             # 消息流
    │   ├── SysBlock           # 灰色分割线
    │   ├── ThinkBlock         # 可折叠，橙色边框
    │   ├── ToolBlock          # 可展开 input/output，图标区分工具类型
    │   ├── OutBlock           # 绿色背景，支持 streaming cursor
    │   └── UserBubble         # 右侧气泡，图片/文件预览
    └── Composer               # 输入框 + 附件按钮 + drag&drop
```

**前端 mock 数据结构**（后端 API 响应必须与之对齐）：

```javascript
// Todo 对象
{
  id: 'a3f9k2',           // 6位 nanoid
  date: '2025-03-16',
  title: 'Build auth module',
  note: '**Markdown** content...',
  status: 'pending' | 'in_progress' | 'done',
  parentId: null,          // null = 根级 todo
  children: ['b7x1m4'],   // 子 todo id 数组
  agentIds: ['ag1'],
  createdAt: 1710000000000,
  completedAt: undefined
}

// Agent 对象
{
  id: 'ag1',
  todoId: 'a3f9k2',
  name: 'codex-001',       // 自动命名：{cli}-{三位数序号}
  cli: 'codex' | 'claude-code',
  model: 'o4-mini',
  status: 'idle' | 'running' | 'paused' | 'finished' | 'error',
  workspace: '~/workspace/orbit/2025-03-16/todo_a3f9k2/',
  ctxPct: 42,              // context 使用率 0-100
  toolCalls: 22,
  messages: [...],
  createdAt: 1710000000000,
  endedAt: undefined
}

// 消息对象（5种 kind）
{ id, kind: 'sys',   content: 'Session initialized...',  ts }
{ id, kind: 'think', content: 'Let me check...',         ts }
{ id, kind: 'tool',  tool: 'read_file',
         input: '{"path":"src/auth.ts"}',
         output: '// content...',
         status: 'ok' | 'error' | 'running',             ts }
{ id, kind: 'out',   content: 'Task complete.',
         streaming: true,                                 ts }
{ id, kind: 'user',  content: 'Add rate limiting',
         attachments: [{type:'image', dataUrl, name}],    ts }
```

---

### 0.4 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户浏览器                                │
│                                                                   │
│  ┌──────────────┐  ┌─────────────────────┐  ┌───────────────┐   │
│  │  Sidebar     │  │   TodoList          │  │  AgentPanel   │   │
│  │  日期导航    │  │   TodoCard × N      │  │  Tab 切换     │   │
│  │  搜索        │  │   ├─ Markdown 备注  │  │  ChatThread   │   │
│  └──────────────┘  │   └─ 子 Todo        │  │  Composer     │   │
│                    └─────────────────────┘  └───────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP REST + WebSocket (ws://:3001)
┌────────────────────────────▼────────────────────────────────────┐
│                     Node.js 后端 (Fastify)                       │
│                                                                   │
│   REST Routes              WebSocket Handler                     │
│   ├─ /api/todos            ├─ agent:message      (server→client) │
│   ├─ /api/agents           ├─ agent:message:stream               │
│   ├─ /api/attachments      ├─ agent:status                       │
│   └─ /api/workspace        ├─ workspace:file                     │
│                            └─ agent:send         (client→server) │
│                                                                   │
│   Agent Engine             Data Layer                            │
│   ├─ runner.ts (node-pty)  ├─ SQLite (todos/agents/messages)     │
│   ├─ parser.ts             ├─ .todo.json  (agent 参考快照)       │
│   └─ session.ts            └─ log.jsonl   (原始输出备份)         │
└────────────────────────────┬────────────────────────────────────┘
                             │ PTY stdin/stdout
┌────────────────────────────▼────────────────────────────────────┐
│               本地 CLI Agent 进程                                 │
│   codex --model o4-mini /path/to/workspace                       │
│   claude --model claude-sonnet-4-5 /path/to/workspace            │
└────────────────────────────┬────────────────────────────────────┘
                             │ 读写文件
┌────────────────────────────▼────────────────────────────────────┐
│                    本地文件系统                                    │
│   ~/workspace/orbit/                                              │
│   └─ 2025-03-16/                                                  │
│       └─ todo_a3f9k2/                                             │
│           ├─ WORKSPACE.md     ← Agent 启动时自动生成              │
│           ├─ .todo.json       ← Todo 元数据快照（只读）           │
│           ├─ agents/ag1/                                          │
│           │   ├─ session.json                                     │
│           │   ├─ log.jsonl                                        │
│           │   └─ attachments/                                     │
│           └─ src/auth/refresh.ts  ← Agent 自由创建               │
└─────────────────────────────────────────────────────────────────┘
```

---

### 0.5 关键设计决策

**① Todo 文件夹用 UUID 命名**
用户随时可改 Todo 标题，若用标题作文件夹名，改名会导致所有 Agent session 路径断裂。UUID 与 Todo 永久绑定，与 Notion Block ID 逻辑一致。

**② `node-pty` 而非 `child_process.spawn`**
`codex`/`claude-code` 通过 `process.stdout.isTTY` 检测终端环境。非 TTY 下会禁用彩色输出、简化进度格式、关闭交互确认，导致 parser 失效且丢失工具调用可视化。`node-pty` 创建伪终端，是唯一可靠方案。

**③ WORKSPACE.md 权限说明**
Agent 在 `--full-auto` 模式下无人工确认。若误操作 `.todo.json` 或 `session.json` 会导致数据损坏。WORKSPACE.md 明确告知只读目录，是低成本的软防护。

**④ SQLite 而非 JSON 文件**
Todo 层级查询、跨日期搜索、消息分页，都需要关系型能力。SQLite 零部署、单文件，是个人工具的最优解。文件系统上的 `.todo.json` 和 `log.jsonl` 仅供 Agent 读取和人工 debug，不是主数据源。

**⑤ Parser 采用"行级启发式"策略**
两个 CLI 的输出都是混合 ANSI 转义码的文本流，没有稳定的结构化 JSON 输出模式。Parser 第一版只需覆盖 70% 的常见模式，通过 `log.jsonl` 持续迭代改进，不追求一步到位。

---

### 0.6 本地开发环境要求

```bash
# 必须已安装
node --version    # >= 20.0.0
npm --version     # >= 10.0.0
codex --version   # 或 claude --version（至少一个可用）

# node-pty 需要原生编译工具（macOS）
xcode-select --install

# 创建工作区根目录（可在 .env 中自定义路径）
mkdir -p ~/workspace/orbit
```

---

---

## 目录

1. [技术栈选型](#1-技术栈选型)
2. [项目结构](#2-项目结构)
3. [数据模型与文件系统](#3-数据模型与文件系统)
4. [HTTP REST API](#4-http-rest-api)
5. [WebSocket 实时通信协议](#5-websocket-实时通信协议)
6. [Agent 执行引擎](#6-agent-执行引擎)
7. [文件附件处理](#7-文件附件处理)
8. [WORKSPACE.md 自动管理](#8-workspacemd-自动管理)
9. [数据持久化](#9-数据持久化)
10. [前端对接说明](#10-前端对接说明)
11. [实现顺序建议](#11-实现顺序建议)

---

## 1. 技术栈选型

```
Runtime:     Node.js 20+ (LTS)
语言:         TypeScript 5.x（strict mode）
HTTP框架:     Fastify 4.x（比 Express 快，原生 TypeScript 支持好）
WebSocket:    @fastify/websocket（基于 ws，集成 Fastify 生命周期）
数据库:       better-sqlite3（单文件，零部署，足够 MVP）
文件系统:     Node.js fs/promises（原生，不需要额外依赖）
进程管理:     child_process.spawn（配合 CLI 原生 JSON 输出模式）
配置:         dotenv
校验:         zod（运行时 schema 校验，与 TypeScript 类型同步）
```

**为什么用 `child_process.spawn` 而不是 `node-pty`？**

两个 CLI 都支持原生结构化 JSON 输出模式：
- Claude Code：`claude --print --output-format=stream-json --verbose`
- Codex：`codex exec --json`

这两种模式下 CLI 以非交互方式运行，输出为 **JSONL 格式**（每行一个 JSON 事件），无需解析 ANSI 转义码，无需 parser，进程结束即代表任务完成。`child_process.spawn` + `readline` 按行读取即可。

**多轮对话与打断机制：**

采用"**轮次模型**"而非"常驻进程模型"：每一轮对话启动一个独立进程，进程结束后通过 `--resume <session_id>` 恢复上下文发起下一轮。

用户打断时，直接 kill 当前进程。由于 Claude Code 的 session 状态在每轮 `result` 事件写入磁盘前才算提交，kill 操作不会污染上一轮的干净状态。下一次 `--resume` 自动回到打断前的检查点。

```
轮1: spawn → session_id=AAA → 输出流 → result 写入 → 进程退出
轮2: spawn --resume AAA → 输出流 → 用户打断 → kill 进程（session 未提交）
轮3: spawn --resume AAA → 从轮1的干净状态继续（轮2被丢弃）
```

---

## 2. 项目结构

```
orbit-backend/
├── src/
│   ├── index.ts                  # 入口，启动 Fastify + WebSocket
│   ├── config.ts                 # 环境变量读取与校验
│   ├── db/
│   │   ├── schema.ts             # SQLite 建表语句
│   │   ├── client.ts             # better-sqlite3 单例
│   │   └── migrations/           # 版本迁移 SQL 文件
│   │       └── 001_init.sql
│   ├── routes/
│   │   ├── todos.ts              # /api/todos CRUD
│   │   ├── agents.ts             # /api/agents CRUD + 控制
│   │   ├── attachments.ts        # /api/attachments 上传/读取
│   │   └── workspace.ts          # /api/workspace 元信息
│   ├── ws/
│   │   ├── handler.ts            # WebSocket 连接管理
│   │   └── events.ts             # 所有 WS 事件类型定义
│   ├── agent/
│   │   ├── runner.ts             # 核心：spawn agent 进程，管理 PTY
│   │   ├── parser.ts             # 解析 codex/claude-code 原始输出
│   │   ├── session.ts            # session 持久化与恢复
│   │   └── workspace-md.ts       # WORKSPACE.md 生成与更新
│   ├── fs/
│   │   ├── layout.ts             # 文件夹结构创建/删除逻辑
│   │   └── watcher.ts            # chokidar 监听工作区文件变化
│   └── types/
│       └── index.ts              # 共享 TypeScript 类型（与前端同步）
├── data/
│   └── orbit.db                  # SQLite 数据文件（gitignore）
├── workspace/                    # 所有 todo 的工作区根目录（可配置）
│   └── {YYYY-MM-DD}/
│       └── todo_{id}/
├── package.json
├── tsconfig.json
└── .env
```

---

## 3. 数据模型与文件系统

### 3.1 SQLite 表结构

```sql
-- migrations/001_init.sql

CREATE TABLE todos (
  id          TEXT PRIMARY KEY,          -- 6位 nanoid，如 "a3f9k2"
  date        TEXT NOT NULL,             -- "2025-03-16"
  title       TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',  -- markdown 原文
  status      TEXT NOT NULL DEFAULT 'pending', -- pending|in_progress|done
  parent_id   TEXT REFERENCES todos(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0, -- 同层排序
  created_at  INTEGER NOT NULL,          -- Unix ms
  completed_at INTEGER,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE agents (
  id                TEXT PRIMARY KEY,        -- "ag" + 6位 nanoid
  todo_id           TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,           -- "claude-001"
  cli               TEXT NOT NULL,           -- "codex" | "claude-code"
  model             TEXT NOT NULL,           -- "claude-sonnet-4-6" 等
  status            TEXT NOT NULL DEFAULT 'idle', -- idle|running|finished|error
  workspace         TEXT NOT NULL,           -- 绝对路径
  ctx_pct           REAL NOT NULL DEFAULT 0,
  tool_calls        INTEGER NOT NULL DEFAULT 0,
  claude_session_id TEXT,                    -- claude --resume 用的 session_id（result 事件获取）
  created_at        INTEGER NOT NULL,
  ended_at          INTEGER,
  error_msg         TEXT                     -- 如果 status=error，记录原因
);

CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,  -- sys|think|tool|out|user
  content    TEXT,           -- think/sys/out/user 的文本内容
  tool_name  TEXT,           -- kind=tool 时
  tool_input TEXT,           -- kind=tool 时，JSON 字符串
  tool_output TEXT,          -- kind=tool 时
  tool_status TEXT,          -- ok|error|running
  ts         INTEGER NOT NULL,
  is_streaming INTEGER NOT NULL DEFAULT 0  -- 1=流式中尚未完成
);

CREATE TABLE attachments (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  filename   TEXT NOT NULL,
  mime_type  TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  path       TEXT NOT NULL,  -- 相对于 workspace 的路径
  created_at INTEGER NOT NULL
);

-- 索引
CREATE INDEX idx_todos_date ON todos(date);
CREATE INDEX idx_todos_parent ON todos(parent_id);
CREATE INDEX idx_agents_todo ON agents(todo_id);
CREATE INDEX idx_messages_agent ON messages(agent_id);
CREATE INDEX idx_messages_ts ON messages(agent_id, ts);
```

### 3.2 文件系统布局

每个 todo 在创建时（无论是否启动 agent）都立即创建对应文件夹：

```
{WORKSPACE_ROOT}/
└── {date}/                            # 例: 2025-03-16/
    └── todo_{id}/                     # 例: todo_a3f9k2/
        ├── .todo.json                 # todo 元数据快照（只读，agent 参考用）
        ├── WORKSPACE.md               # 工作区说明（agent 启动时生成/更新）
        ├── agents/
        │   └── {agent_id}/            # 例: ag7x2k1/
        │       ├── session.json       # CLI session 状态（codex/claude-code 格式）
        │       ├── log.jsonl          # 完整消息日志，每行一个 JSON message 对象
        │       └── attachments/       # 用户上传的图片/文件
        │           └── {timestamp}_{filename}
        └── <agent 自由创建的工作文件>
```

`.todo.json` 格式（agent 只读，每次 todo 更新时同步写入）：

```json
{
  "id": "a3f9k2",
  "title": "Build authentication module",
  "note": "JWT + refresh token strategy...",
  "status": "in_progress",
  "date": "2025-03-16",
  "createdAt": 1710000000000,
  "subTodos": [
    { "id": "b7x1m4", "title": "Design token schema", "status": "done" },
    { "id": "c2p8n6", "title": "Implement /auth/login", "status": "in_progress" }
  ]
}
```

---

## 4. HTTP REST API

所有接口前缀 `/api`，Content-Type: `application/json`。

### 4.1 Todos

```
GET    /api/todos?date={YYYY-MM-DD}     # 获取指定日期所有根 todo（含 children id 列表）
GET    /api/todos/:id                   # 获取单个 todo（含 children 完整对象）
POST   /api/todos                       # 创建 todo
PATCH  /api/todos/:id                   # 更新 todo（title/note/status/position）
DELETE /api/todos/:id                   # 删除 todo（级联删除 children、agents、文件夹）
GET    /api/todos/search?q={query}      # 全文搜索 title+note，返回最多 30 条
```

**POST /api/todos body：**
```json
{
  "date": "2025-03-16",
  "title": "Build auth module",
  "note": "",
  "parentId": null          // 或父 todo id
}
```
创建时立即：
1. 插入数据库
2. `fs.mkdir(todoFolderPath, { recursive: true })`
3. 写入 `.todo.json`
4. 如果有 `parentId`，更新父 todo 的 `.todo.json`

**DELETE /api/todos/:id：**
1. 从数据库删除（CASCADE 处理子孙）
2. `fs.rm(todoFolderPath, { recursive: true, force: true })`
3. 如果有正在运行的 agent，先强制 kill 进程

### 4.2 Agents

```
GET    /api/agents?todoId={id}          # 获取 todo 的所有 agents
GET    /api/agents/:id                  # 获取单个 agent（含 messages）
GET    /api/agents/:id/messages         # 分页获取消息，?offset=0&limit=100
POST   /api/agents                      # 创建并启动 agent（首轮）
POST   /api/agents/:id/interrupt        # 打断当前轮（kill 进程，回到上一轮干净状态）
POST   /api/agents/:id/send             # 发送新消息（启动新一轮进程）
DELETE /api/agents/:id                  # 停止并删除 agent（删除文件）
```

**POST /api/agents body：**
```json
{
  "todoId": "a3f9k2",
  "cli": "claude-code",
  "model": "claude-sonnet-4-6",
  "prompt": "帮我实现认证模块",
  "workspace": "/absolute/path/or/empty"
}
```

启动流程（详见第 6 节）：
1. 插入数据库，status = "idle"
2. 创建 agent 文件夹结构
3. 生成/更新 WORKSPACE.md
4. 更新 .todo.json
5. spawn 子进程（`child_process.spawn`）
6. status → "running"，通过 WS 广播

**POST /api/agents/:id/send body：**
```json
{
  "text": "Can you also add rate limiting?",
  "attachments": ["att_id_1", "att_id_2"]
}
```

行为：kill 当前进程（如果在运行）→ 保存 user 消息 → 以新 prompt + `--resume <session_id>` 启动新进程。

**POST /api/agents/:id/interrupt：**

kill 当前进程，status → "idle"，session_id 不变。下次 send 会从上一轮干净状态恢复。

### 4.3 Attachments

```
POST   /api/attachments                 # 上传文件（multipart/form-data）
GET    /api/attachments/:id             # 下载/读取文件
DELETE /api/attachments/:id            # 删除文件
```

**POST /api/attachments body（multipart）：**
- Field `agentId`: string
- Field `file`: binary（支持多文件）

返回：
```json
{
  "attachments": [
    {
      "id": "att_x9k2p1",
      "filename": "screenshot.png",
      "mimeType": "image/png",
      "sizeBytes": 204800,
      "path": "agents/ag7x2k1/attachments/1710000000_screenshot.png"
    }
  ]
}
```

### 4.4 Workspace

```
GET  /api/workspace                     # 获取 workspace 根路径、磁盘用量等元信息
GET  /api/workspace/dates               # 获取有 todo 的所有日期列表（sidebar 用）
```

---

## 5. WebSocket 实时通信协议

### 5.1 连接

```
ws://localhost:3001/ws
```

连接后立即发送当前所有 running agents 的状态快照，让前端恢复显示。

### 5.2 消息格式

所有消息统一格式：
```typescript
interface WsMessage {
  type: string;
  payload: unknown;
  ts: number;  // Unix ms
}
```

### 5.3 Server → Client 事件

**`agent:message`** — agent 产生新的消息（逐条推送）
```json
{
  "type": "agent:message",
  "payload": {
    "agentId": "ag1",
    "message": {
      "id": "msg_abc",
      "kind": "think",
      "content": "Let me check the existing structure...",
      "ts": 1710000000000
    }
  }
}
```

**`agent:message:stream`** — 流式内容追加（`out` 类型消息逐 token 推送）
```json
{
  "type": "agent:message:stream",
  "payload": {
    "agentId": "ag1",
    "messageId": "msg_xyz",
    "delta": "Rate limiting added to"
  }
}
```

**`agent:message:stream:end`** — 流式消息完成
```json
{
  "type": "agent:message:stream:end",
  "payload": { "agentId": "ag1", "messageId": "msg_xyz" }
}
```

**`agent:status`** — agent 状态变更
```json
{
  "type": "agent:status",
  "payload": {
    "agentId": "ag1",
    "status": "paused",           // idle|running|paused|finished|error
    "ctxPct": 58.3,
    "toolCalls": 14
  }
}
```

**`agent:ctx`** — context 使用率更新（每 5 秒推送一次 running agent 的状态）
```json
{
  "type": "agent:ctx",
  "payload": { "agentId": "ag1", "ctxPct": 61.2 }
}
```

**`agent:error`** — agent 进程报错或异常退出
```json
{
  "type": "agent:error",
  "payload": { "agentId": "ag1", "message": "Process exited with code 1" }
}
```

**`todo:update`** — todo 被修改（例如 agent 写文件后触发文件监听，自动更新 .todo.json）
```json
{
  "type": "todo:update",
  "payload": { "todoId": "a3f9k2", "fields": { "status": "done" } }
}
```

**`workspace:file`** — 工作区文件变化（chokidar 监听）
```json
{
  "type": "workspace:file",
  "payload": {
    "todoId": "a3f9k2",
    "agentId": "ag1",
    "event": "add",              // add|change|unlink
    "path": "src/auth/refresh.ts"
  }
}
```

### 5.4 Client → Server 事件

```json
{ "type": "agent:send", "payload": { "agentId": "ag1", "text": "...", "attachmentIds": [] } }
{ "type": "agent:interrupt", "payload": { "agentId": "ag1" } }
{ "type": "ping", "payload": {} }
```

---

## 6. Agent 执行引擎

这是整个后端最核心的部分，位于 `src/agent/runner.ts`。

### 6.1 CLI 启动命令

```bash
# Claude Code — 首次启动（--print 非交互模式，输出结构化 JSONL）
echo "你的 prompt" | claude --print --output-format=stream-json --verbose \
  --model claude-sonnet-4-6 \
  --dangerously-skip-permissions \
  --cwd /path/to/workspace

# Claude Code — 恢复上一轮 session
echo "继续的 prompt" | claude --print --output-format=stream-json --verbose \
  --resume <session_id>

# Codex — 首次启动
codex exec --json --full-auto --model o4-mini \
  -C /path/to/workspace \
  "你的 prompt"

# Codex — 目前不支持跨进程 --resume，每轮独立（上下文通过 prompt 传递）
```

**附件传递**：将附件路径拼入 prompt 文本即可，两个 CLI 都支持通过 `-i` 或 prompt 中引用本地路径让 agent 读取。

### 6.2 进程生命周期管理

```typescript
import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';

interface AgentProcess {
  proc: ChildProcess;
  agentId: string;
  sessionId?: string;       // claude --resume 用的 session_id
  lastActivity: number;
}

const processes = new Map<string, AgentProcess>();

function spawnAgent(agent: Agent, prompt: string): void {
  const { cmd, args } = buildCommand(agent, prompt);  // 见下方

  const proc = spawn(cmd, args, {
    cwd: agent.workspace,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // 按行读取 JSONL stdout
  const rl = readline.createInterface({ input: proc.stdout! });
  rl.on('line', (line) => {
    handleJsonLine(agent.id, line);
  });

  proc.on('exit', (code) => {
    handleExit(agent.id, code);
  });

  processes.set(agent.id, { proc, agentId: agent.id, lastActivity: Date.now() });
}

function buildCommand(agent: Agent, prompt: string): { cmd: string; args: string[] } {
  if (agent.cli === 'claude-code') {
    const args = [
      '--print',
      '--output-format=stream-json',
      '--verbose',
      `--model=${agent.model}`,
      '--dangerously-skip-permissions',
    ];
    if (agent.sessionId) args.push(`--resume=${agent.sessionId}`);
    return { cmd: 'claude', args };
    // prompt 通过 proc.stdin.write(prompt) 写入
  } else {
    // codex
    const args = [
      'exec', '--json', '--full-auto',
      `--model=${agent.model}`,
      '-C', agent.workspace,
      prompt,
    ];
    return { cmd: 'codex', args };
  }
}
```

### 6.3 JSONL 事件解析

不再需要 ANSI 解析器。两个 CLI 输出原生 JSON，直接按类型映射到 Orbit 消息格式。

**Claude Code JSONL 事件 → Orbit Message 映射：**

```typescript
// src/agent/parser.ts

interface ClaudeEvent {
  type: 'system' | 'assistant' | 'result';
  // assistant 事件
  message?: {
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: unknown }
      | { type: 'tool_result'; tool_use_id: string; content: string }
    >;
  };
  // result 事件
  session_id?: string;
  usage?: { input_tokens: number; output_tokens: number };
  subtype?: 'success' | 'error';
}

export function parseClaudeEvent(raw: string): ParsedEvent | null {
  let event: ClaudeEvent;
  try { event = JSON.parse(raw); } catch { return null; }

  if (event.type === 'system') {
    return { kind: 'sys', content: `Session initialized` };
  }

  if (event.type === 'assistant' && event.message) {
    const results: ParsedEvent[] = [];
    for (const block of event.message.content) {
      if (block.type === 'text') {
        results.push({ kind: 'out', content: block.text });
      } else if (block.type === 'tool_use') {
        results.push({ kind: 'tool', tool: block.name, input: JSON.stringify(block.input), status: 'running' });
      } else if (block.type === 'tool_result') {
        results.push({ kind: 'tool', phase: 'result', content: block.content, status: 'ok' });
      }
    }
    return results.length === 1 ? results[0] : { kind: 'batch', events: results };
  }

  if (event.type === 'result') {
    // 提取 session_id 用于下轮 --resume
    if (event.session_id) saveSessionId(event.session_id);
    // 提取 context 使用率
    const total = (event.usage?.input_tokens ?? 0) + (event.usage?.output_tokens ?? 0);
    return { kind: 'ctx_update', pct: Math.min(100, (total / 200000) * 100) };
  }

  return null;
}
```

**Codex JSONL 事件映射**（格式类似，字段名不同，按实际输出调整）：

```typescript
export function parseCodexEvent(raw: string): ParsedEvent | null {
  let event: Record<string, unknown>;
  try { event = JSON.parse(raw); } catch { return null; }

  // codex exec --json 的事件类型待真实运行后确认，以 log.jsonl 为准
  const type = event.type as string;
  if (type === 'thinking') return { kind: 'think', content: event.content as string };
  if (type === 'tool_call') return { kind: 'tool', tool: event.name as string, input: JSON.stringify(event.input), status: 'running' };
  if (type === 'tool_result') return { kind: 'tool', phase: 'result', content: event.output as string, status: 'ok' };
  if (type === 'output') return { kind: 'out', content: event.content as string };

  return null;
}
```

> **注意**：Codex 的 `--json` 事件格式需要通过真实运行 `log.jsonl` 确认，上方为估计值，以实际输出为准。

### 6.4 用户发送新消息（多轮对话）

新消息不是写入 stdin，而是**启动新一轮进程**：

```typescript
async function sendToAgent(agentId: string, text: string, attachments: Attachment[]): Promise<void> {
  // 1. 如果当前轮还在运行，先 kill（丢弃当前轮）
  const current = processes.get(agentId);
  if (current) {
    current.proc.kill('SIGTERM');
    processes.delete(agentId);
  }

  // 2. 构造新 prompt（含附件路径）
  let prompt = text;
  if (attachments.length > 0) {
    const paths = attachments.map(a => a.path).join('\n');
    prompt = `User attached files:\n${paths}\n\n${text}`;
  }

  // 3. 存入数据库为 user 消息
  await saveMessage(agentId, { kind: 'user', content: text, attachments });

  // 4. 启动新进程（带 --resume session_id）
  const agent = await getAgent(agentId);
  spawnAgent(agent, prompt);
}
```

### 6.5 打断（Interrupt）

```typescript
function interruptAgent(agentId: string): void {
  const proc = processes.get(agentId);
  if (!proc) return;

  // kill 当前进程，session_id 不变，下次 send 会从上一轮干净状态 --resume
  proc.proc.kill('SIGTERM');
  processes.delete(agentId);
  updateAgentStatus(agentId, 'idle');
  broadcastWsEvent('agent:status', { agentId, status: 'idle' });
}
```

### 6.6 Session 持久化

Claude Code 的 session 由 CLI 自身管理（存于 `~/.claude/` 下）。Orbit 只需记录 `session_id`：

```typescript
// agents 表新增字段（或存入 session.json）
interface AgentSession {
  agentId: string;
  cli: string;
  model: string;
  claudeSessionId?: string;   // 从 result 事件的 session_id 字段获取
  createdAt: number;
  lastActiveAt: number;
}
```

Resume 时：
1. 读取 DB 中的 `claudeSessionId`
2. 启动新进程时带 `--resume <claudeSessionId>`
3. 重新建立 WS 广播
4. 从 DB 的 messages 表加载历史消息（前端重载）

---

## 7. 文件附件处理

### 7.1 上传流程

```
前端拖拽/粘贴图片
  → POST /api/attachments (multipart)
  → 后端保存至 agents/{agentId}/attachments/{ts}_{filename}
  → 返回 attachment id 和路径
  → 前端 Composer 显示预览缩略图
  → 用户点击 Send
  → POST /api/agents/:id/send { text, attachmentIds }
  → 后端将文件路径注入 agent PTY stdin
```

### 7.2 图片处理

```typescript
import sharp from 'sharp';  // 可选，用于压缩大图

async function processImageAttachment(filePath: string): Promise<void> {
  const stats = await fs.stat(filePath);
  // 超过 4MB 的图片压缩到 2048px 以内，保留比例
  if (stats.size > 4 * 1024 * 1024) {
    await sharp(filePath)
      .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(filePath + '.compressed.jpg');
  }
}
```

### 7.3 向 Agent 传递图片

Codex 和 Claude Code 都支持在消息中引用本地文件路径，agent 可以自行读取：

```
User attached image: /absolute/path/to/agents/ag1/attachments/screenshot.png
Please analyze this image and implement accordingly.
```

---

## 8. WORKSPACE.md 自动管理

### 8.1 创建时机

每次 `POST /api/agents` 启动新 agent 时，在 workspace 目录下写入/更新 `WORKSPACE.md`。

### 8.2 文件内容

```typescript
// src/agent/workspace-md.ts
export function generateWorkspaceMd(todo: Todo, agent: Agent, existingFiles: string[]): string {
  return `# WORKSPACE.md — ${todo.title}

> Auto-generated by Orbit · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}
> Do not delete — Orbit reads this file to track workspace state.

## Task

${todo.note || '_No description provided._'}

## Sub-tasks
${todo.subTodos.length === 0 ? '_None_' : todo.subTodos.map(s =>
  `- [${s.status === 'done' ? 'x' : ' '}] ${s.title}`
).join('\n')}

## Directory Structure

\`\`\`
todo_${todo.id}/
├── WORKSPACE.md          ← this file (READ-ONLY for agent)
├── .todo.json            ← task metadata snapshot (READ-ONLY for agent)
├── agents/
│   └── ${agent.id}/
│       ├── session.json  ← your session state (do not modify)
│       ├── log.jsonl     ← execution log (do not modify)
│       └── attachments/  ← files sent by user (READ-ONLY for agent)
└── <your work files>     ← create files here freely
\`\`\`

## Permissions

| Path | Access |
|------|--------|
| \`WORKSPACE.md\` | Read-only |
| \`\.todo\.json\` | Read-only |
| \`agents/\` | Read-only (your session subfolder is writable) |
| \`agents/${agent.id}/attachments/\` | Read-only |
| Everything else | Read + Write |

## Files Created

${existingFiles.length === 0
  ? '_No files created yet._'
  : existingFiles.map(f => `- \`${f}\``).join('\n')}

---
*This file is automatically updated by Orbit when files are added or modified.*
`;
}
```

### 8.3 自动更新触发时机

使用 `chokidar` 监听 workspace 目录，当 agent 创建或修改文件时，更新 `WORKSPACE.md` 的 "Files Created" 列表：

```typescript
import chokidar from 'chokidar';

function watchWorkspace(todoId: string, workspacePath: string): void {
  const watcher = chokidar.watch(workspacePath, {
    ignored: [
      '**/WORKSPACE.md',
      '**/.todo.json',
      '**/agents/**',           // 不监听 agent 内部文件
      '**/node_modules/**',
    ],
    ignoreInitial: true,
    depth: 5,
  });

  watcher.on('add', (filePath) => {
    updateWorkspaceMdFiles(workspacePath, 'add', filePath);
    broadcastWsEvent('workspace:file', { todoId, event: 'add', path: relative(workspacePath, filePath) });
  });

  watcher.on('unlink', (filePath) => {
    updateWorkspaceMdFiles(workspacePath, 'remove', filePath);
    broadcastWsEvent('workspace:file', { todoId, event: 'unlink', path: relative(workspacePath, filePath) });
  });
}
```

---

## 9. 数据持久化

### 9.1 原则

- **SQLite 是真相来源**：所有 todo、agent、message 数据以 SQLite 为准
- **文件系统是镜像**：`.todo.json` 是 SQLite 数据的导出快照，供 agent 读取
- **`log.jsonl` 是备份**：每条 message 写入 DB 的同时追加到 `log.jsonl`，便于离线查阅和 debug

### 9.2 写入时序

```
agent 输出原始字节
  → parser 解析为 ParsedEvent
  → 构造 Message 对象（含 id、ts）
  → 同时并行：
      (a) INSERT INTO messages ...
      (b) append to log.jsonl
      (c) 广播 WebSocket 事件
  → 每 10 条消息或 30 秒，更新 agents.ctx_pct 和 agents.tool_calls
```

### 9.3 启动时恢复

服务启动时：
1. 查询所有 `status = 'running'` 的 agent
2. 将它们标记为 `status = 'idle'`（进程已随后端重启而终止，无孤儿进程问题）
3. `claude_session_id` 保留，前端重连后用户可直接继续发消息（自动 `--resume`）

---

## 10. 前端对接说明

### 10.1 前端需要修改的部分

当前前端 `orbit.html` 中所有数据都是 mock，需要替换为真实 API 调用。

**建议将前端拆分为独立项目**（不再是单 HTML 文件）：

```
orbit-frontend/
├── src/
│   ├── api.ts          # 所有 HTTP 请求封装
│   ├── ws.ts           # WebSocket 连接管理与事件分发
│   └── App.tsx         # 现有逻辑迁移为真实 React 组件
```

**`src/api.ts` 示例：**
```typescript
const BASE = 'http://localhost:3001/api';

export const api = {
  todos: {
    list: (date: string) => fetch(`${BASE}/todos?date=${date}`).then(r => r.json()),
    create: (data: CreateTodoInput) => fetch(`${BASE}/todos`, { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }).then(r => r.json()),
    update: (id: string, data: Partial<Todo>) => fetch(`${BASE}/todos/${id}`, { method: 'PATCH', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }).then(r => r.json()),
    delete: (id: string) => fetch(`${BASE}/todos/${id}`, { method: 'DELETE' }),
    search: (q: string) => fetch(`${BASE}/todos/search?q=${encodeURIComponent(q)}`).then(r => r.json()),
  },
  agents: {
    create: (data: CreateAgentInput) => fetch(`${BASE}/agents`, { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }).then(r => r.json()),
    send: (id: string, text: string, attachmentIds: string[]) => fetch(`${BASE}/agents/${id}/send`, { method: 'POST', body: JSON.stringify({ text, attachmentIds }), headers: { 'Content-Type': 'application/json' } }).then(r => r.json()),
    pause: (id: string) => fetch(`${BASE}/agents/${id}/pause`, { method: 'POST' }),
    resume: (id: string) => fetch(`${BASE}/agents/${id}/resume`, { method: 'POST' }),
    delete: (id: string) => fetch(`${BASE}/agents/${id}`, { method: 'DELETE' }),
  },
  attachments: {
    upload: (agentId: string, files: File[]) => {
      const form = new FormData();
      form.append('agentId', agentId);
      files.forEach(f => form.append('file', f));
      return fetch(`${BASE}/attachments`, { method: 'POST', body: form }).then(r => r.json());
    },
  },
};
```

**`src/ws.ts` 示例：**
```typescript
class OrbitWS {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Function>>();

  connect() {
    this.ws = new WebSocket('ws://localhost:3001/ws');
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      this.handlers.get(msg.type)?.forEach(h => h(msg.payload));
    };
    this.ws.onclose = () => setTimeout(() => this.connect(), 2000);  // 自动重连
  }

  on(type: string, handler: Function) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);  // 返回 unsubscribe
  }

  send(type: string, payload: unknown) {
    this.ws?.send(JSON.stringify({ type, payload }));
  }
}

export const ws = new OrbitWS();
```

### 10.2 CORS 配置

后端需配置允许前端开发服务器域名：
```typescript
await app.register(require('@fastify/cors'), {
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
});
```

### 10.3 环境变量

```env
# .env
PORT=3001
WORKSPACE_ROOT=/Users/yourname/workspace/orbit
DB_PATH=./data/orbit.db
NODE_ENV=development
```

---

## 11. 实现顺序建议

按以下顺序实现，每步完成后可独立测试：

### Phase 1 — 基础骨架（约 2-3 小时）
1. 初始化 Fastify + TypeScript 项目
2. 配置 `better-sqlite3`，运行 migration，建表
3. 实现 `/api/todos` 的完整 CRUD（无文件系统）
4. 测试：用 curl 或 Postman 创建、读取、删除 todo

### Phase 2 — 文件系统（约 1 小时）
5. 实现 `src/fs/layout.ts`：创建/删除 todo 文件夹、写 `.todo.json`
6. 将文件系统操作嵌入 todo 创建/删除流程
7. 测试：创建 todo 后检查本地文件夹是否生成

### Phase 3 — WebSocket 基础（约 1 小时）
8. 注册 `@fastify/websocket`，实现连接管理
9. 实现 `broadcastWsEvent` 工具函数
10. 测试：前端连接 WS，后端推送 ping，前端收到

### Phase 4 — Agent 引擎（约 3-4 小时，最核心）
11. 实现 `runner.ts`：`child_process.spawn` 启动 claude CLI，readline 按行读取 JSONL stdout
12. 实现 `parser.ts`：Claude Code JSONL 事件 → Orbit Message 类型映射
13. 实现 message 写入 DB + 广播 WS
14. 实现 `POST /api/agents` 完整启动流程（首轮）
15. **测试**：真实运行，查看 `log.jsonl` 确认 JSONL 格式，调整 parser 字段映射
16. 实现 `interrupt`（kill 进程）和 `send`（新一轮 --resume）
17. 扩展支持 codex `--json` 格式（parser 分支，事件格式待真实运行确认）

### Phase 5 — 附件（约 1 小时）
18. 实现 `POST /api/attachments` multipart 上传
19. 实现 send 时将附件路径注入 agent stdin

### Phase 6 — WORKSPACE.md 与文件监听（约 1 小时）
20. 实现 `workspace-md.ts` 生成函数
21. 集成 `chokidar` 监听，自动更新 Files Created

### Phase 7 — 前端对接（约 2-3 小时）
22. 将前端 `orbit.html` 中 mock 数据替换为真实 API 调用
23. 接入 WS 事件，实现实时消息流
24. 联调：完整走一遍"创建 todo → 启动 agent → 实时看输出 → 发消息 → 完成"流程

---

## 附录 A — 关键依赖版本

```json
{
  "dependencies": {
    "fastify": "^4.28.0",
    "@fastify/websocket": "^10.0.0",
    "@fastify/cors": "^9.0.0",
    "@fastify/multipart": "^8.0.0",
    "better-sqlite3": "^9.6.0",
    "chokidar": "^3.6.0",
    "nanoid": "^5.0.0",
    "zod": "^3.23.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0"
  }
}
```

## 附录 B — 已知难点与注意事项

1. **Codex `--json` 事件格式需实测确认**：本文档中 codex JSONL 事件字段为估计值。第一次真实运行后，用 `log.jsonl` 记录原始输出，对照实际字段更新 parser 映射。

2. **Claude Code session_id 生命周期**：session_id 由 claude CLI 自身管理，存于 `~/.claude/` 下。Orbit 只记录 ID，不管理文件。若用户清空 `~/.claude/`，历史 session 无法恢复（agent 将从新 session 开始）。

3. **进程清理**：后端重启时，查询 `status = 'running'` 的 agent 并标记为 `idle`（进程已不存在）。不存在 PTY 孤儿进程问题，因为子进程随父进程退出而终止（stdio: pipe 模式）。

4. **并发控制**：多个 agent 同时运行不存在技术问题，但受 API key 并发限制约束。可在 `POST /api/agents` 时检查 running agent 数量给用户提示。

5. **打断语义**：interrupt 后 session_id 保留，下次 send 自动 `--resume` 到上一轮。若用户希望"丢弃整个对话从头开始"，需要创建新 agent（不传 session_id）。

6. **Context 百分比计算**：从 `result` 事件的 `usage.input_tokens + output_tokens` 除以模型 context window（claude-sonnet-4-6 为 200,000）估算。

---

*文档版本：v1.1 · 2026-03-16 · 将进程模型从 node-pty 改为 child_process.spawn + CLI 原生 JSONL 输出*
