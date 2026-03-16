import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { promises as fs } from 'fs';
import { join } from 'path';
import { getDb } from '../db/client.js';
import { createAgentFolder, agentFolderPath, todoFolderPath, listWorkspaceFiles, resolveWorkspacePath } from '../fs/layout.js';
import { spawnAgent, killAgent, isAgentRunning } from '../agent/runner.js';
import { generateWorkspaceMd } from '../agent/workspace-md.js';
import { broadcastAll } from '../ws/handler.js';

const CreateAgentSchema = z.object({
  todoId: z.string(),
  cli: z.enum(['codex', 'claude-code']),
  model: z.string(),
  workspace: z.string().default(''),
  prompt: z.string().default(''),
});

const SendSchema = z.object({
  text: z.string(),
  attachmentIds: z.array(z.string()).default([]),
});

interface TodoRow {
  id: string;
  date: string;
  title: string;
  note: string;
  status: string;
  parent_id: string | null;
  created_at: number;
}

interface AgentRow {
  id: string;
  todo_id: string;
  name: string;
  cli: string;
  model: string;
  status: string;
  workspace: string;
  ctx_pct: number;
  tool_calls: number;
  claude_session_id: string | null;
  created_at: number;
  ended_at: number | null;
  error_msg: string | null;
}

interface MessageRow {
  id: string;
  agent_id: string;
  kind: string;
  content: string | null;
  tool_name: string | null;
  tool_input: string | null;
  tool_output: string | null;
  tool_status: string | null;
  ts: number;
  is_streaming: number;
}

interface AttachmentRow {
  id: string;
  filename: string;
  path: string;
}

function formatAgent(row: AgentRow, db: ReturnType<typeof getDb>) {
  return {
    id: row.id,
    todoId: row.todo_id,
    name: row.name,
    cli: row.cli,
    model: row.model,
    status: row.status,
    workspace: row.workspace,
    ctxPct: row.ctx_pct,
    toolCalls: row.tool_calls,
    createdAt: row.created_at,
    endedAt: row.ended_at ?? undefined,
  };
}

function formatMessage(row: MessageRow) {
  return {
    id: row.id,
    kind: row.kind,
    content: row.content ?? undefined,
    tool: row.tool_name ?? undefined,
    input: row.tool_input ?? undefined,
    output: row.tool_output ?? undefined,
    status: row.tool_status ?? undefined,
    streaming: row.is_streaming === 1,
    ts: row.ts,
  };
}

export async function agentsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/agents?todoId=...
  app.get('/api/agents', async (req) => {
    const { todoId } = req.query as { todoId?: string };
    const db = getDb();
    const query = todoId
      ? db.prepare('SELECT * FROM agents WHERE todo_id = ? ORDER BY created_at ASC').all(todoId)
      : db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all();
    return (query as AgentRow[]).map(r => formatAgent(r, db));
  });

  // GET /api/agents/:id
  app.get('/api/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined;
    if (!row) return reply.code(404).send({ error: 'not found' });
    const messages = db.prepare('SELECT * FROM messages WHERE agent_id = ? ORDER BY ts ASC').all(id) as MessageRow[];
    return { ...formatAgent(row, db), messages: messages.map(formatMessage) };
  });

  // GET /api/agents/:id/messages
  app.get('/api/agents/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { offset = '0', limit = '100' } = req.query as { offset?: string; limit?: string };
    const db = getDb();
    const rows = db.prepare('SELECT * FROM messages WHERE agent_id = ? ORDER BY ts ASC LIMIT ? OFFSET ?')
      .all(id, parseInt(limit), parseInt(offset)) as MessageRow[];
    return rows.map(formatMessage);
  });

  // POST /api/agents — create + spawn
  app.post('/api/agents', async (req, reply) => {
    const body = CreateAgentSchema.parse(req.body);
    const db = getDb();

    const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(body.todoId) as TodoRow | undefined;
    if (!todo) return reply.code(404).send({ error: 'todo not found' });

    // Determine workspace
    const wsPath = resolveWorkspacePath(body.workspace) || todoFolderPath(todo.date, todo.id);

    // Name: cli-NNN
    const existingCount = (db.prepare('SELECT COUNT(*) as cnt FROM agents WHERE todo_id = ?').get(body.todoId) as { cnt: number }).cnt;
    const num = String(existingCount + 1).padStart(3, '0');
    const name = `${body.cli}-${num}`;
    const id = 'ag' + nanoid(6);
    const now = Date.now();

    db.prepare(`
      INSERT INTO agents (id, todo_id, name, cli, model, status, workspace, ctx_pct, tool_calls, claude_session_id, created_at)
      VALUES (?, ?, ?, ?, ?, 'idle', ?, 0, 0, NULL, ?)
    `).run(id, body.todoId, name, body.cli, body.model, wsPath, now);

    // Create agent folder
    await createAgentFolder(todo.date, todo.id, id);
    await fs.mkdir(wsPath, { recursive: true });

    // Get sub-todos for WORKSPACE.md
    const subTodos = (db.prepare('SELECT id, title, status FROM todos WHERE parent_id = ?').all(body.todoId) as { id: string; title: string; status: string }[]);
    const existingFiles = await listWorkspaceFiles(wsPath);

    // Generate WORKSPACE.md
    const wsMd = generateWorkspaceMd(
      { id: todo.id, title: todo.title, note: todo.note, status: todo.status, date: todo.date, createdAt: todo.created_at, subTodos },
      { id },
      existingFiles,
    );
    await fs.writeFile(join(wsPath, 'WORKSPACE.md'), wsMd, 'utf-8');

    const initTs = Date.now();
    db.prepare(`
      INSERT INTO messages (id, agent_id, kind, content, ts, is_streaming)
      VALUES (?, ?, 'sys', ?, ?, 0)
    `).run(nanoid(8), id, `Session initialized · workspace: ${wsPath}`, initTs);
    db.prepare(`
      INSERT INTO messages (id, agent_id, kind, content, ts, is_streaming)
      VALUES (?, ?, 'sys', ?, ?, 0)
    `).run(nanoid(8), id, `WORKSPACE.md written · model: ${body.model}`, initTs + 1);

    // Spawn agent if prompt provided
    if (body.prompt) {
      spawnAgent(id, body.prompt);
    }

    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow;
    const messages = db.prepare('SELECT * FROM messages WHERE agent_id = ? ORDER BY ts ASC').all(id) as MessageRow[];
    return reply.code(201).send({ ...formatAgent(row, db), messages: messages.map(formatMessage) });
  });

  // POST /api/agents/:id/send
  app.post('/api/agents/:id/send', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = SendSchema.parse(req.body);
    const db = getDb();

    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined;
    if (!agent) return reply.code(404).send({ error: 'not found' });

    // Kill current process if running
    killAgent(id);

    // Build prompt with attachments
    let prompt = body.text;
    if (body.attachmentIds.length > 0) {
      const attachments = body.attachmentIds.map(aid => {
        const att = db.prepare('SELECT * FROM attachments WHERE id = ?').get(aid) as AttachmentRow | undefined;
        return att ? att.path : null;
      }).filter(Boolean);
      if (attachments.length > 0) {
        prompt = `User attached files:\n${attachments.join('\n')}\n\n${body.text}`;
      }
    }

    // Save user message
    const msgId = nanoid(8);
    db.prepare(`
      INSERT INTO messages (id, agent_id, kind, content, ts, is_streaming)
      VALUES (?, ?, 'user', ?, ?, 0)
    `).run(msgId, id, body.text, Date.now());

    broadcastAll('agent:message', {
      agentId: id,
      message: { id: msgId, kind: 'user', content: body.text, ts: Date.now() },
    });

    // Spawn new process
    spawnAgent(id, prompt);

    return { ok: true };
  });

  // POST /api/agents/:id/interrupt
  app.post('/api/agents/:id/interrupt', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined;
    if (!agent) return reply.code(404).send({ error: 'not found' });

    killAgent(id);
    db.prepare(`UPDATE agents SET status = 'idle', ended_at = ? WHERE id = ?`).run(Date.now(), id);
    broadcastAll('agent:status', { agentId: id, status: 'idle' });

    return { ok: true };
  });

  // DELETE /api/agents/:id
  app.delete('/api/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const agent = db.prepare(`
      SELECT a.*, t.date FROM agents a JOIN todos t ON a.todo_id = t.id WHERE a.id = ?
    `).get(id) as (AgentRow & { date: string }) | undefined;
    if (!agent) return reply.code(404).send({ error: 'not found' });

    killAgent(id);

    const agentDir = agentFolderPath(agent.date, agent.todo_id, id);
    db.prepare('DELETE FROM agents WHERE id = ?').run(id);
    try {
      await (await import('fs')).promises.rm(agentDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    return reply.code(204).send();
  });
}
