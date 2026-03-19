import { z } from 'zod';
import { nanoid } from 'nanoid';
import { promises as fs } from 'fs';
import { join } from 'path';
import { getDb } from '../db/client.js';
import { createAgentFolder, agentFolderPath, todoFolderPath, listWorkspaceFiles, resolveWorkspacePath } from '../fs/layout.js';
import { spawnAgent, killAgent, isAgentRunning } from '../agent/runner.js';
import { generateWorkspaceMd } from '../agent/workspace-md.js';
import { broadcastAll } from '../ws/handler.js';
import { getCodexModelOption } from '../models-config.js';
const CreateAgentSchema = z.object({
    todoId: z.string(),
    cli: z.enum(['codex', 'claude-code']),
    model: z.string(),
    reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).nullable().optional(),
    workspace: z.string().default(''),
    writeWorkspaceMd: z.boolean().default(true),
    storeRecordsInWorkspace: z.boolean().default(true),
    prompt: z.string().default(''),
});
const SendSchema = z.object({
    text: z.string(),
    attachmentIds: z.array(z.string()).default([]),
});
const UpdateAgentSchema = z.object({
    name: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
});
function formatAgent(row, db) {
    return {
        id: row.id,
        todoId: row.todo_id,
        name: row.name,
        cli: row.cli,
        model: row.model,
        reasoningEffort: row.reasoning_effort ?? undefined,
        status: row.status,
        workspace: row.workspace,
        writeWorkspaceMd: row.write_workspace_md === 1,
        storeRecordsInWorkspace: row.store_records_in_workspace === 1,
        ctxPct: row.ctx_pct,
        tokensUsed: row.tokens_used,
        tokensTotal: row.tokens_total,
        toolCalls: row.tool_calls,
        createdAt: row.created_at,
        endedAt: row.ended_at ?? undefined,
    };
}
function formatMessage(row) {
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
export async function agentsRoutes(app) {
    // GET /api/agents?todoId=...
    app.get('/api/agents', async (req) => {
        const { todoId } = req.query;
        const db = getDb();
        const query = todoId
            ? db.prepare('SELECT * FROM agents WHERE todo_id = ? ORDER BY created_at ASC').all(todoId)
            : db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all();
        return query.map(r => formatAgent(r, db));
    });
    // GET /api/agents/:id
    app.get('/api/agents/:id', async (req, reply) => {
        const { id } = req.params;
        const db = getDb();
        const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
        if (!row)
            return reply.code(404).send({ error: 'not found' });
        const messages = db.prepare('SELECT * FROM messages WHERE agent_id = ? ORDER BY ts ASC').all(id);
        return { ...formatAgent(row, db), messages: messages.map(formatMessage) };
    });
    // GET /api/agents/:id/messages
    app.get('/api/agents/:id/messages', async (req, reply) => {
        const { id } = req.params;
        const { offset = '0', limit = '100' } = req.query;
        const db = getDb();
        const rows = db.prepare('SELECT * FROM messages WHERE agent_id = ? ORDER BY ts ASC LIMIT ? OFFSET ?')
            .all(id, parseInt(limit), parseInt(offset));
        return rows.map(formatMessage);
    });
    // PATCH /api/agents/:id
    app.patch('/api/agents/:id', async (req, reply) => {
        const { id } = req.params;
        const body = UpdateAgentSchema.parse(req.body);
        const db = getDb();
        const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
        if (!agent)
            return reply.code(404).send({ error: 'not found' });
        if (body.name !== undefined) {
            db.prepare('UPDATE agents SET name = ? WHERE id = ?').run(body.name, id);
        }
        if (body.model !== undefined) {
            db.prepare('UPDATE agents SET model = ? WHERE id = ?').run(body.model, id);
        }
        const updated = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
        return formatAgent(updated, db);
    });
    // POST /api/agents — create + spawn
    app.post('/api/agents', async (req, reply) => {
        const body = CreateAgentSchema.parse(req.body);
        const db = getDb();
        const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(body.todoId);
        if (!todo)
            return reply.code(404).send({ error: 'todo not found' });
        // Determine workspace
        const wsPath = resolveWorkspacePath(body.workspace) || todoFolderPath(todo.date, todo.id);
        let reasoningEffort = null;
        if (body.cli === 'codex') {
            const modelOption = getCodexModelOption(body.model);
            if (!modelOption)
                return reply.code(400).send({ error: `unsupported codex model: ${body.model}` });
            const allowed = modelOption.reasoningEfforts ?? [];
            if (body.reasoningEffort) {
                if (!allowed.includes(body.reasoningEffort)) {
                    return reply.code(400).send({ error: `reasoning_effort '${body.reasoningEffort}' is not valid for '${body.model}'` });
                }
                reasoningEffort = body.reasoningEffort;
            }
        }
        // Name: cli-NNN
        const existingCount = db.prepare('SELECT COUNT(*) as cnt FROM agents WHERE todo_id = ?').get(body.todoId).cnt;
        const num = String(existingCount + 1).padStart(3, '0');
        const name = `${body.cli}-${num}`;
        const id = 'ag' + nanoid(6);
        const now = Date.now();
        db.prepare(`
      INSERT INTO agents (id, todo_id, name, cli, model, reasoning_effort, status, workspace, write_workspace_md, store_records_in_workspace, ctx_pct, tokens_used, tokens_total, tool_calls, claude_session_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?, 0, 0, 0, 0, NULL, ?)
    `).run(id, body.todoId, name, body.cli, body.model, reasoningEffort, wsPath, body.writeWorkspaceMd ? 1 : 0, body.storeRecordsInWorkspace ? 1 : 0, now);
        // Create agent folder
        await createAgentFolder(todo.date, todo.id, id);
        await fs.mkdir(wsPath, { recursive: true });
        // Get sub-todos for WORKSPACE.md
        const subTodos = db.prepare('SELECT id, title, status FROM todos WHERE parent_id = ?').all(body.todoId);
        const existingFiles = await listWorkspaceFiles(wsPath);
        // Generate WORKSPACE.md
        if (body.writeWorkspaceMd) {
            const wsMd = generateWorkspaceMd({ id: todo.id, title: todo.title, note: todo.note, status: todo.status, date: todo.date, createdAt: todo.created_at, subTodos }, { id }, existingFiles);
            await fs.writeFile(join(wsPath, 'WORKSPACE.md'), wsMd, 'utf-8');
        }
        const initTs = Date.now();
        db.prepare(`
      INSERT INTO messages (id, agent_id, kind, content, ts, is_streaming)
      VALUES (?, ?, 'sys', ?, ?, 0)
    `).run(nanoid(8), id, `Session initialized · workspace: ${wsPath}`, initTs);
        db.prepare(`
      INSERT INTO messages (id, agent_id, kind, content, ts, is_streaming)
      VALUES (?, ?, 'sys', ?, ?, 0)
    `).run(nanoid(8), id, body.writeWorkspaceMd
            ? (body.cli === 'codex' && reasoningEffort
                ? `WORKSPACE.md written · model: ${body.model} · reasoning: ${reasoningEffort}`
                : `WORKSPACE.md written · model: ${body.model}`)
            : `Custom workspace connected · WORKSPACE.md disabled`, initTs + 1);
        // Spawn agent if prompt provided
        if (body.prompt) {
            spawnAgent(id, body.prompt);
        }
        const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
        const messages = db.prepare('SELECT * FROM messages WHERE agent_id = ? ORDER BY ts ASC').all(id);
        return reply.code(201).send({ ...formatAgent(row, db), messages: messages.map(formatMessage) });
    });
    // POST /api/agents/:id/send
    app.post('/api/agents/:id/send', async (req, reply) => {
        const { id } = req.params;
        const body = SendSchema.parse(req.body);
        const db = getDb();
        const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
        if (!agent)
            return reply.code(404).send({ error: 'not found' });
        // Kill current process if running
        killAgent(id);
        // For Codex: fetch conversation history BEFORE saving the new user message so we can
        // inject it into the prompt (codex exec has no native session resumption that carries
        // over the full context — history injection is the reliable fallback).
        let conversationPrefix = '';
        if (agent.cli === 'codex') {
            const prevMsgs = db.prepare(`SELECT kind, content FROM messages WHERE agent_id = ? AND kind IN ('user','out') ORDER BY ts ASC`).all(id);
            if (prevMsgs.length > 0) {
                const lines = [
                    '=== Previous conversation (for context) ===',
                ];
                for (const m of prevMsgs) {
                    if (m.kind === 'user' && m.content)
                        lines.push(`User: ${m.content}`);
                    else if (m.kind === 'out' && m.content)
                        lines.push(`Assistant: ${m.content}`);
                }
                lines.push('=== End of previous conversation ===', '');
                conversationPrefix = lines.join('\n');
            }
        }
        // Build prompt with attachments
        let prompt = body.text;
        if (body.attachmentIds.length > 0) {
            const attachments = body.attachmentIds.map(aid => {
                const att = db.prepare('SELECT * FROM attachments WHERE id = ?').get(aid);
                return att ? att.path : null;
            }).filter(Boolean);
            if (attachments.length > 0) {
                prompt = `User attached files:\n${attachments.join('\n')}\n\n${body.text}`;
            }
        }
        // Prepend history for Codex
        if (conversationPrefix) {
            prompt = conversationPrefix + `User: ${prompt}`;
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
        const { id } = req.params;
        const db = getDb();
        const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
        if (!agent)
            return reply.code(404).send({ error: 'not found' });
        killAgent(id);
        db.prepare(`UPDATE agents SET status = 'idle', ended_at = ? WHERE id = ?`).run(Date.now(), id);
        broadcastAll('agent:status', { agentId: id, status: 'idle' });
        return { ok: true };
    });
    // POST /api/agents/:id/cancel — interrupt and revert to message before last user input
    app.post('/api/agents/:id/cancel', async (req, reply) => {
        const { id } = req.params;
        const db = getDb();
        const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
        if (!agent)
            return reply.code(404).send({ error: 'not found' });
        killAgent(id);
        // Find the last user message and remove it plus everything produced after it
        const lastUserMsg = db.prepare(`SELECT id, ts FROM messages WHERE agent_id = ? AND kind = 'user' ORDER BY ts DESC LIMIT 1`).get(id);
        if (lastUserMsg) {
            db.prepare(`DELETE FROM messages WHERE agent_id = ? AND ts >= ?`).run(id, lastUserMsg.ts);
            db.prepare(`UPDATE agents SET status = 'idle' WHERE id = ?`).run(id);
            broadcastAll('agent:cancelled', { agentId: id, revertToTs: lastUserMsg.ts });
            broadcastAll('agent:status', { agentId: id, status: 'idle' });
        }
        else {
            db.prepare(`UPDATE agents SET status = 'idle' WHERE id = ?`).run(id);
            broadcastAll('agent:status', { agentId: id, status: 'idle' });
        }
        return { ok: true };
    });
    // GET /api/agents/:id/diff — returns git diff in the workspace
    app.get('/api/agents/:id/diff', async (req, reply) => {
        const { id } = req.params;
        const db = getDb();
        const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
        if (!agent)
            return reply.code(404).send({ error: 'not found' });
        const wsPath = resolveWorkspacePath(agent.workspace) || agent.workspace;
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);
        try {
            const { stdout } = await execFileAsync('git', ['diff', 'HEAD'], { cwd: wsPath, maxBuffer: 1024 * 1024 });
            return { diff: stdout };
        }
        catch (err) {
            // git diff exits non-zero only on error; try without HEAD for non-repo dirs
            const msg = err instanceof Error ? err.message : String(err);
            return { diff: '', error: msg };
        }
    });
    // POST /api/agents/:id/compact — delete tool/think/sys messages + old out messages, keep last pair
    app.post('/api/agents/:id/compact', async (req, reply) => {
        const { id } = req.params;
        const db = getDb();
        const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
        if (!agent)
            return reply.code(404).send({ error: 'not found' });
        if (isAgentRunning(id))
            return reply.code(409).send({ error: 'agent is running' });
        // Delete all tool, think, sys messages
        db.prepare(`DELETE FROM messages WHERE agent_id = ? AND kind IN ('tool', 'think', 'sys')`).run(id);
        // Keep only the last out message (remove the rest)
        const lastOut = db.prepare(`SELECT id FROM messages WHERE agent_id = ? AND kind = 'out' ORDER BY ts DESC LIMIT 1`).get(id);
        if (lastOut) {
            db.prepare(`DELETE FROM messages WHERE agent_id = ? AND kind = 'out' AND id != ?`).run(id, lastOut.id);
        }
        // Add compaction marker
        const msgId = nanoid(8);
        db.prepare(`INSERT INTO messages (id, agent_id, kind, content, ts, is_streaming) VALUES (?, ?, 'sys', ?, ?, 0)`)
            .run(msgId, id, 'Context compacted — older messages removed to reduce context size.', Date.now());
        broadcastAll('agent:compacted', { agentId: id });
        return { ok: true };
    });
    // POST /api/agents/:id/clean — delete all messages and reset session
    app.post('/api/agents/:id/clean', async (req, reply) => {
        const { id } = req.params;
        const db = getDb();
        const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
        if (!agent)
            return reply.code(404).send({ error: 'not found' });
        if (isAgentRunning(id))
            return reply.code(409).send({ error: 'agent is running' });
        db.prepare(`DELETE FROM messages WHERE agent_id = ?`).run(id);
        db.prepare(`UPDATE agents SET claude_session_id = NULL, ctx_pct = 0, tokens_used = 0, tokens_total = 0, tool_calls = 0, status = 'idle' WHERE id = ?`).run(id);
        const msgId = nanoid(8);
        db.prepare(`INSERT INTO messages (id, agent_id, kind, content, ts, is_streaming) VALUES (?, ?, 'sys', ?, ?, 0)`)
            .run(msgId, id, 'Session cleaned — all messages cleared, context reset.', Date.now());
        broadcastAll('agent:cleaned', { agentId: id });
        broadcastAll('agent:status', { agentId: id, status: 'idle', ctxPct: 0, tokensUsed: 0, tokensTotal: 0, toolCalls: 0 });
        return { ok: true };
    });
    // DELETE /api/agents/:id
    app.delete('/api/agents/:id', async (req, reply) => {
        const { id } = req.params;
        const db = getDb();
        const agent = db.prepare(`
      SELECT a.*, t.date FROM agents a JOIN todos t ON a.todo_id = t.id WHERE a.id = ?
    `).get(id);
        if (!agent)
            return reply.code(404).send({ error: 'not found' });
        killAgent(id);
        const agentDir = agentFolderPath(agent.date, agent.todo_id, id);
        db.prepare('DELETE FROM agents WHERE id = ?').run(id);
        try {
            await (await import('fs')).promises.rm(agentDir, { recursive: true, force: true });
        }
        catch {
            // ignore
        }
        return reply.code(204).send();
    });
}
