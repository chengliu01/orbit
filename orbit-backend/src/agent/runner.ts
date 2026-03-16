import { spawn, type ChildProcess } from 'child_process';
import * as readline from 'readline';
import { promises as fs } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { getDb } from '../db/client.js';
import { broadcastAll } from '../ws/handler.js';
import { parseClaudeEvent, parseCodexEvent } from './parser.js';
import { agentFolderPath, resolveWorkspacePath } from '../fs/layout.js';

interface AgentRecord {
  id: string;
  todo_id: string;
  cli: string;
  model: string;
  status: string;
  workspace: string;
  ctx_pct: number;
  tool_calls: number;
  claude_session_id: string | null;
  date?: string;
}

interface ActiveProcess {
  proc: ChildProcess;
  agentId: string;
  logPath: string;
  // For streaming text deltas: track current out message id
  currentOutMsgId: string | null;
  // For tool_use: track pending tool use by id
  pendingTools: Map<string, string>; // toolUseId -> messageId
}

const processes = new Map<string, ActiveProcess>();

function buildCommand(agent: AgentRecord, prompt: string): { cmd: string; args: string[]; useStdin: boolean } {
  const workspacePath = resolveWorkspacePath(agent.workspace) || agent.workspace;
  if (agent.cli === 'claude-code') {
    const args = [
      '--print',
      '--output-format=stream-json',
      '--verbose',
      `--model=${agent.model}`,
      '--dangerously-skip-permissions',
    ];
    if (agent.claude_session_id) {
      args.push(`--resume=${agent.claude_session_id}`);
    }
    return { cmd: 'claude', args, useStdin: true };
  } else {
    const args = [
      'exec', '--json', '--full-auto',
      `--model=${agent.model}`,
      '-C', workspacePath,
      prompt,
    ];
    return { cmd: 'codex', args, useStdin: false };
  }
}

function getAgentDate(agentId: string): string {
  const db = getDb();
  const row = db.prepare(`
    SELECT t.date FROM agents a JOIN todos t ON a.todo_id = t.id WHERE a.id = ?
  `).get(agentId) as { date: string } | undefined;
  return row?.date ?? new Date().toISOString().slice(0, 10);
}

function saveMessage(agentId: string, kind: string, fields: {
  content?: string;
  tool_name?: string;
  tool_input?: string;
  tool_output?: string;
  tool_status?: string;
  is_streaming?: number;
}): string {
  const db = getDb();
  const id = nanoid(8);
  const ts = Date.now();
  db.prepare(`
    INSERT INTO messages (id, agent_id, kind, content, tool_name, tool_input, tool_output, tool_status, ts, is_streaming)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, agentId, kind,
    fields.content ?? null,
    fields.tool_name ?? null,
    fields.tool_input ?? null,
    fields.tool_output ?? null,
    fields.tool_status ?? null,
    ts,
    fields.is_streaming ?? 0,
  );
  return id;
}

function updateMessageStreaming(msgId: string, content: string, done: boolean): void {
  const db = getDb();
  db.prepare(`UPDATE messages SET content = ?, is_streaming = ? WHERE id = ?`)
    .run(content, done ? 0 : 1, msgId);
}

function updateToolMessage(msgId: string, output: string, status: string): void {
  const db = getDb();
  db.prepare(`UPDATE messages SET tool_output = ?, tool_status = ? WHERE id = ?`)
    .run(output, status, msgId);
}

function updateAgentStatus(agentId: string, status: string, extra?: { ctxPct?: number; toolCalls?: number; sessionId?: string; endedAt?: number }): void {
  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as AgentRecord;
  if (!agent) return;

  const ctxPct = extra?.ctxPct ?? agent.ctx_pct;
  const toolCalls = extra?.toolCalls ?? agent.tool_calls;
  const sessionId = extra?.sessionId ?? agent.claude_session_id;
  const endedAt = extra?.endedAt ?? null;

  db.prepare(`
    UPDATE agents SET status = ?, ctx_pct = ?, tool_calls = ?, claude_session_id = ?, ended_at = ? WHERE id = ?
  `).run(status, ctxPct, toolCalls, sessionId, endedAt, agentId);

  broadcastAll('agent:status', { agentId, status, ctxPct, toolCalls });
}

async function appendLog(logPath: string, obj: object): Promise<void> {
  try {
    await fs.appendFile(logPath, JSON.stringify(obj) + '\n', 'utf-8');
  } catch {
    // ignore
  }
}

function handleJsonLine(active: ActiveProcess, line: string): void {
  if (!line.trim()) return;

  const agentId = active.agentId;
  appendLog(active.logPath, { raw: line, ts: Date.now() });

  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as AgentRecord;
  if (!agent) return;

  const parser = agent.cli === 'claude-code' ? parseClaudeEvent : parseCodexEvent;
  const events = parser(line);

  for (const ev of events) {
    if (ev.kind === 'sys') {
      const msgId = saveMessage(agentId, 'sys', { content: ev.content });
      broadcastAll('agent:message', {
        agentId,
        message: { id: msgId, kind: 'sys', content: ev.content, ts: Date.now() },
      });

    } else if (ev.kind === 'think') {
      const msgId = saveMessage(agentId, 'think', { content: ev.content });
      broadcastAll('agent:message', {
        agentId,
        message: { id: msgId, kind: 'think', content: ev.content, ts: Date.now() },
      });

    } else if (ev.kind === 'tool') {
      const msgId = saveMessage(agentId, 'tool', {
        tool_name: ev.tool,
        tool_input: ev.input,
        tool_status: 'running',
      });
      if (ev.toolUseId) {
        active.pendingTools.set(ev.toolUseId, msgId);
      }
      // update tool_calls count
      const newToolCalls = agent.tool_calls + 1;
      db.prepare('UPDATE agents SET tool_calls = ? WHERE id = ?').run(newToolCalls, agentId);
      broadcastAll('agent:message', {
        agentId,
        message: { id: msgId, kind: 'tool', tool: ev.tool, input: ev.input, status: 'running', ts: Date.now() },
      });

    } else if (ev.kind === 'tool_result') {
      // find pending tool message
      let toolMsgId: string | undefined;
      if (ev.toolUseId && active.pendingTools.has(ev.toolUseId)) {
        toolMsgId = active.pendingTools.get(ev.toolUseId)!;
        active.pendingTools.delete(ev.toolUseId);
      } else {
        // find last running tool
        const lastTool = db.prepare(`
          SELECT id FROM messages WHERE agent_id = ? AND kind = 'tool' AND tool_status = 'running' ORDER BY ts DESC LIMIT 1
        `).get(agentId) as { id: string } | undefined;
        toolMsgId = lastTool?.id;
      }
      if (toolMsgId) {
        const status = ev.status === 'error' ? 'error' : 'ok';
        updateToolMessage(toolMsgId, ev.output ?? '', status);
        broadcastAll('agent:message', {
          agentId,
          message: { id: toolMsgId, kind: 'tool', output: ev.output, status, ts: Date.now() },
        });
      }

    } else if (ev.kind === 'out') {
      if (ev.isStreaming) {
        // streaming delta
        if (!active.currentOutMsgId) {
          // start new streaming message
          const msgId = saveMessage(agentId, 'out', { content: ev.content ?? '', is_streaming: 1 });
          active.currentOutMsgId = msgId;
          broadcastAll('agent:message', {
            agentId,
            message: { id: msgId, kind: 'out', content: ev.content ?? '', streaming: true, ts: Date.now() },
          });
        } else {
          // append delta to DB (read current, append)
          const cur = db.prepare('SELECT content FROM messages WHERE id = ?').get(active.currentOutMsgId) as { content: string } | undefined;
          const newContent = (cur?.content ?? '') + (ev.content ?? '');
          updateMessageStreaming(active.currentOutMsgId, newContent, false);
          broadcastAll('agent:message:stream', {
            agentId,
            messageId: active.currentOutMsgId,
            delta: ev.content ?? '',
          });
        }
      } else {
        // complete out block (non-streaming)
        if (active.currentOutMsgId) {
          // finalize streaming
          const cur = db.prepare('SELECT content FROM messages WHERE id = ?').get(active.currentOutMsgId) as { content: string } | undefined;
          updateMessageStreaming(active.currentOutMsgId, cur?.content ?? '', true);
          broadcastAll('agent:message:stream:end', { agentId, messageId: active.currentOutMsgId });
          active.currentOutMsgId = null;
        }
        const msgId = saveMessage(agentId, 'out', { content: ev.content });
        broadcastAll('agent:message', {
          agentId,
          message: { id: msgId, kind: 'out', content: ev.content, ts: Date.now() },
        });
      }

    } else if (ev.kind === 'session_id' && ev.sessionId) {
      db.prepare('UPDATE agents SET claude_session_id = ? WHERE id = ?').run(ev.sessionId, agentId);

    } else if (ev.kind === 'ctx_update' && ev.pct !== undefined) {
      const freshAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as AgentRecord;
      db.prepare('UPDATE agents SET ctx_pct = ? WHERE id = ?').run(ev.pct, agentId);
      broadcastAll('agent:ctx', { agentId, ctxPct: ev.pct });
    }
  }
}

function handleExit(active: ActiveProcess, code: number | null): void {
  const agentId = active.agentId;
  processes.delete(agentId);

  // finalize any open streaming message
  if (active.currentOutMsgId) {
    const db = getDb();
    const cur = db.prepare('SELECT content FROM messages WHERE id = ?').get(active.currentOutMsgId) as { content: string } | undefined;
    updateMessageStreaming(active.currentOutMsgId, cur?.content ?? '', true);
    broadcastAll('agent:message:stream:end', { agentId, messageId: active.currentOutMsgId });
  }

  // mark any still-running tools as error
  const db = getDb();
  db.prepare(`
    UPDATE messages SET tool_status = 'error' WHERE agent_id = ? AND kind = 'tool' AND tool_status = 'running'
  `).run(agentId);

  const status = (code === 0 || code === null) ? 'finished' : 'error';
  updateAgentStatus(agentId, status, { endedAt: Date.now() });

  const sysMsg = code === 0 || code === null
    ? 'Agent finished'
    : `Process exited with code ${code}`;
  const msgId = saveMessage(agentId, 'sys', { content: sysMsg });
  broadcastAll('agent:message', {
    agentId,
    message: { id: msgId, kind: 'sys', content: sysMsg, ts: Date.now() },
  });
}

export function spawnAgent(agentId: string, prompt: string): void {
  const db = getDb();
  const agent = db.prepare(`
    SELECT a.*, t.date FROM agents a JOIN todos t ON a.todo_id = t.id WHERE a.id = ?
  `).get(agentId) as (AgentRecord & { date: string }) | undefined;

  if (!agent) {
    console.error(`[runner] agent ${agentId} not found`);
    return;
  }

  const date = agent.date;
  const logPath = join(agentFolderPath(date, agent.todo_id, agentId), 'log.jsonl');
  const workspacePath = resolveWorkspacePath(agent.workspace) || agent.workspace;

  const { cmd, args, useStdin } = buildCommand(agent, prompt);

  const proc = spawn(cmd, args, {
    cwd: workspacePath,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const active: ActiveProcess = {
    proc,
    agentId,
    logPath,
    currentOutMsgId: null,
    pendingTools: new Map(),
  };

  processes.set(agentId, active);

  if (useStdin && proc.stdin) {
    proc.stdin.write(prompt + '\n');
    proc.stdin.end();
  }

  const rl = readline.createInterface({ input: proc.stdout! });
  rl.on('line', (line) => handleJsonLine(active, line));

  proc.stderr?.on('data', (chunk: Buffer) => {
    appendLog(logPath, { stderr: chunk.toString(), ts: Date.now() });
  });

  proc.on('exit', (code) => handleExit(active, code));

  updateAgentStatus(agentId, 'running');
  console.log(`[runner] spawned ${cmd} for agent ${agentId}`);
}

export function killAgent(agentId: string): boolean {
  const active = processes.get(agentId);
  if (!active) return false;
  active.proc.kill('SIGTERM');
  processes.delete(agentId);
  return true;
}

export function isAgentRunning(agentId: string): boolean {
  return processes.has(agentId);
}

export function resetStaleAgents(): void {
  const db = getDb();
  db.prepare(`UPDATE agents SET status = 'idle' WHERE status = 'running'`).run();
  console.log('[runner] reset stale running agents to idle');
}
