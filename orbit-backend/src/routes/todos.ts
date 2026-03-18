import { promises as fs } from 'fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { getDb } from '../db/client.js';
import { createTodoFolder, deleteTodoFolder, writeTodoJson, todoFolderPath, listWorkspaceFiles } from '../fs/layout.js';
import { watchTodoWorkspace, stopWatcher } from '../fs/watcher.js';
import { killAgent } from '../agent/runner.js';
import { generateWorkspaceMd } from '../agent/workspace-md.js';
import { config } from '../config.js';
import { join } from 'path';

const CreateTodoSchema = z.object({
  date: z.string(),
  title: z.string().min(1),
  note: z.string().default(''),
  parentId: z.string().nullable().default(null),
});

const UpdateTodoSchema = z.object({
  title: z.string().min(1).optional(),
  note: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'done']).optional(),
  position: z.number().optional(),
});

interface TodoRow {
  id: string;
  date: string;
  title: string;
  note: string;
  status: string;
  parent_id: string | null;
  position: number;
  created_at: number;
  completed_at: number | null;
  updated_at: number;
}

interface AgentRow {
  id: string;
  todo_id: string;
  name: string;
  cli: string;
  model: string;
  reasoning_effort: string | null;
  status: string;
  workspace: string;
  ctx_pct: number;
  tool_calls: number;
  claude_session_id: string | null;
  created_at: number;
  ended_at: number | null;
  error_msg: string | null;
}

function formatTodo(row: TodoRow, db: ReturnType<typeof getDb>) {
  const children = (db.prepare('SELECT id FROM todos WHERE parent_id = ? ORDER BY position ASC, created_at ASC').all(row.id) as { id: string }[]).map(r => r.id);
  const agentIds = (db.prepare('SELECT id FROM agents WHERE todo_id = ? ORDER BY created_at ASC').all(row.id) as { id: string }[]).map(r => r.id);
  return {
    id: row.id,
    date: row.date,
    title: row.title,
    note: row.note,
    status: row.status,
    parentId: row.parent_id,
    children,
    agentIds,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function buildTodoJsonData(todoId: string, db: ReturnType<typeof getDb>) {
  const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(todoId) as TodoRow;
  if (!row) return null;
  const subRows = db.prepare('SELECT * FROM todos WHERE parent_id = ? ORDER BY position ASC').all(todoId) as TodoRow[];
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    status: row.status,
    date: row.date,
    createdAt: row.created_at,
    subTodos: subRows.map(s => ({ id: s.id, title: s.title, status: s.status })),
  };
}

async function syncTodoJson(todoId: string, db: ReturnType<typeof getDb>): Promise<void> {
  const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(todoId) as TodoRow | undefined;
  if (!row) return;
  const jsonData = buildTodoJsonData(todoId, db);
  if (jsonData) await writeTodoJson(row.date, todoId, jsonData);
}

async function syncWorkspaceMd(todoId: string, db: ReturnType<typeof getDb>): Promise<void> {
  const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(todoId) as TodoRow | undefined;
  if (!row) return;

  const subTodos = (db.prepare('SELECT id, title, status FROM todos WHERE parent_id = ? ORDER BY position ASC, created_at ASC').all(todoId) as { id: string; title: string; status: string }[]);
  const agents = db.prepare('SELECT * FROM agents WHERE todo_id = ? ORDER BY created_at ASC').all(todoId) as AgentRow[];

  await Promise.all(agents.map(async (agent) => {
    const existingFiles = await listWorkspaceFiles(agent.workspace);
    const wsMd = generateWorkspaceMd(
      { id: row.id, title: row.title, note: row.note, status: row.status, date: row.date, createdAt: row.created_at, subTodos },
      { id: agent.id },
      existingFiles,
    );
    await fs.writeFile(join(agent.workspace, 'WORKSPACE.md'), wsMd, 'utf-8');
  }));
}

export async function todosRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/todos?date=YYYY-MM-DD
  app.get('/api/todos', async (req, reply) => {
    const { date } = req.query as { date?: string };
    if (!date) return reply.code(400).send({ error: 'date required' });
    const db = getDb();
    const rows = db.prepare('SELECT * FROM todos WHERE date = ? AND parent_id IS NULL ORDER BY position ASC, created_at ASC').all(date) as TodoRow[];
    return rows.map(r => formatTodo(r, db));
  });

  // GET /api/todos/search?q=...
  app.get('/api/todos/search', async (req, reply) => {
    const { q } = req.query as { q?: string };
    if (!q) return [];
    const db = getDb();
    const like = `%${q}%`;
    const rows = db.prepare(`
      SELECT * FROM todos WHERE title LIKE ? OR note LIKE ? ORDER BY created_at DESC LIMIT 30
    `).all(like, like) as TodoRow[];
    return rows.map(r => formatTodo(r, db));
  });

  // GET /api/todos/:id
  app.get('/api/todos/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as TodoRow | undefined;
    if (!row) return reply.code(404).send({ error: 'not found' });
    return formatTodo(row, db);
  });

  // POST /api/todos
  app.post('/api/todos', async (req, reply) => {
    const body = CreateTodoSchema.parse(req.body);
    const db = getDb();
    const id = nanoid(6);
    const now = Date.now();

    db.prepare(`
      INSERT INTO todos (id, date, title, note, status, parent_id, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, 0, ?, ?)
    `).run(id, body.date, body.title, body.note, body.parentId, now, now);

    if (body.parentId) {
      // no-op: children derived from DB query
    }

    // Create workspace folder
    await createTodoFolder(body.date, id);

    // Write .todo.json
    const jsonData = buildTodoJsonData(id, db);
    if (jsonData) await writeTodoJson(body.date, id, jsonData);

    // Update parent's .todo.json if applicable
    if (body.parentId) {
      const parent = db.prepare('SELECT * FROM todos WHERE id = ?').get(body.parentId) as TodoRow | undefined;
      if (parent) {
        const parentJsonData = buildTodoJsonData(body.parentId, db);
        if (parentJsonData) await writeTodoJson(parent.date, body.parentId, parentJsonData);
      }
      await syncWorkspaceMd(body.parentId, db);
    } else {
      await syncWorkspaceMd(id, db);
    }

    // Start watching workspace
    const wsPath = todoFolderPath(body.date, id);
    watchTodoWorkspace(id, wsPath);

    const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as TodoRow;
    return reply.code(201).send(formatTodo(row, db));
  });

  // PATCH /api/todos/:id
  app.patch('/api/todos/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as TodoRow | undefined;
    if (!row) return reply.code(404).send({ error: 'not found' });

    const body = UpdateTodoSchema.parse(req.body);
    const now = Date.now();

    if (body.title !== undefined) db.prepare('UPDATE todos SET title = ?, updated_at = ? WHERE id = ?').run(body.title, now, id);
    if (body.note !== undefined) db.prepare('UPDATE todos SET note = ?, updated_at = ? WHERE id = ?').run(body.note, now, id);
    if (body.status !== undefined) {
      const completedAt = body.status === 'done' ? now : null;
      db.prepare('UPDATE todos SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(body.status, completedAt, now, id);
    }
    if (body.position !== undefined) db.prepare('UPDATE todos SET position = ?, updated_at = ? WHERE id = ?').run(body.position, now, id);

    // Update .todo.json
    const updated = db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as TodoRow;
    await syncTodoJson(id, db);
    if (row.parent_id) await syncTodoJson(row.parent_id, db);
    await syncWorkspaceMd(row.parent_id ?? id, db);

    return formatTodo(updated, db);
  });

  // DELETE /api/todos/:id
  app.delete('/api/todos/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as TodoRow | undefined;
    if (!row) return reply.code(404).send({ error: 'not found' });
    const parentId = row.parent_id;

    // Kill any running agents
    const agents = db.prepare('SELECT id, status FROM agents WHERE todo_id = ?').all(id) as AgentRow[];
    for (const ag of agents) {
      if (ag.status === 'running') killAgent(ag.id);
    }

    // Stop watcher
    await stopWatcher(id);

    // Delete from DB (cascades)
    db.prepare('DELETE FROM todos WHERE id = ?').run(id);

    if (parentId) {
      await syncTodoJson(parentId, db);
      await syncWorkspaceMd(parentId, db);
    }

    // Delete workspace folder
    await deleteTodoFolder(row.date, id);

    return reply.code(204).send();
  });
}
