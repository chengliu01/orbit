CREATE TABLE IF NOT EXISTS todos (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  title       TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending',
  parent_id   TEXT REFERENCES todos(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  completed_at INTEGER,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id                TEXT PRIMARY KEY,
  todo_id           TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  cli               TEXT NOT NULL,
  model             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'idle',
  workspace         TEXT NOT NULL,
  ctx_pct           REAL NOT NULL DEFAULT 0,
  tool_calls        INTEGER NOT NULL DEFAULT 0,
  claude_session_id TEXT,
  created_at        INTEGER NOT NULL,
  ended_at          INTEGER,
  error_msg         TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  content     TEXT,
  tool_name   TEXT,
  tool_input  TEXT,
  tool_output TEXT,
  tool_status TEXT,
  ts          INTEGER NOT NULL,
  is_streaming INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS attachments (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  filename   TEXT NOT NULL,
  mime_type  TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  path       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_todos_date ON todos(date);
CREATE INDEX IF NOT EXISTS idx_todos_parent ON todos(parent_id);
CREATE INDEX IF NOT EXISTS idx_agents_todo ON agents(todo_id);
CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id);
CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(agent_id, ts);
