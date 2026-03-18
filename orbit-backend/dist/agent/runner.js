import { spawn } from 'child_process';
import * as readline from 'readline';
import { promises as fs } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { getDb } from '../db/client.js';
import { broadcastAll } from '../ws/handler.js';
import { parseClaudeEvent, parseCodexEvent } from './parser.js';
import { agentFolderPath, resolveWorkspacePath } from '../fs/layout.js';
const processes = new Map();
/** Returns the known context window for a model, used as fallback before the
 *  event stream provides a definitive value. */
function getDefaultContextWindow(model) {
    if (/claude/.test(model))
        return 200000;
    if (/o[1-4][-_]|^o[1-4]$/.test(model))
        return 200000;
    if (/gpt-4o/.test(model))
        return 128000;
    if (/gpt-4-turbo/.test(model))
        return 128000;
    return 128000;
}
function buildCommand(agent, prompt) {
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
    }
    else {
        // `codex exec resume` does NOT support -C or --skip-git-repo-check;
        // those flags are only valid for `codex exec` (new session).
        if (agent.claude_session_id) {
            const args = [
                'exec', 'resume',
                '--json', '--full-auto',
                '--skip-git-repo-check',
                `--model=${agent.model}`,
                ...(agent.reasoning_effort ? ['--config', `model_reasoning_effort=${agent.reasoning_effort}`] : []),
                agent.claude_session_id,
                prompt,
            ];
            return { cmd: 'codex', args, useStdin: false };
        }
        else {
            const args = [
                'exec', '--json', '--full-auto',
                '--skip-git-repo-check',
                `--model=${agent.model}`,
                ...(agent.reasoning_effort ? ['--config', `model_reasoning_effort=${agent.reasoning_effort}`] : []),
                '-C', workspacePath,
                prompt,
            ];
            return { cmd: 'codex', args, useStdin: false };
        }
    }
}
function getAgentDate(agentId) {
    const db = getDb();
    const row = db.prepare(`
    SELECT t.date FROM agents a JOIN todos t ON a.todo_id = t.id WHERE a.id = ?
  `).get(agentId);
    return row?.date ?? new Date().toISOString().slice(0, 10);
}
function saveMessage(agentId, kind, fields) {
    const db = getDb();
    const id = nanoid(8);
    const ts = Date.now();
    db.prepare(`
    INSERT INTO messages (id, agent_id, kind, content, tool_name, tool_input, tool_output, tool_status, ts, is_streaming)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, agentId, kind, fields.content ?? null, fields.tool_name ?? null, fields.tool_input ?? null, fields.tool_output ?? null, fields.tool_status ?? null, ts, fields.is_streaming ?? 0);
    return id;
}
function updateMessageStreaming(msgId, content, done) {
    const db = getDb();
    db.prepare(`UPDATE messages SET content = ?, is_streaming = ? WHERE id = ?`)
        .run(content, done ? 0 : 1, msgId);
}
function updateToolMessage(msgId, output, status) {
    const db = getDb();
    db.prepare(`UPDATE messages SET tool_output = ?, tool_status = ? WHERE id = ?`)
        .run(output, status, msgId);
}
function updateAgentStatus(agentId, status, extra) {
    const db = getDb();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (!agent)
        return;
    const ctxPct = extra?.ctxPct ?? agent.ctx_pct;
    const tokensUsed = extra?.tokensUsed ?? agent.tokens_used;
    const tokensTotal = extra?.tokensTotal ?? agent.tokens_total;
    const toolCalls = extra?.toolCalls ?? agent.tool_calls;
    const sessionId = extra?.sessionId ?? agent.claude_session_id;
    const endedAt = extra?.endedAt ?? null;
    db.prepare(`
    UPDATE agents SET status = ?, ctx_pct = ?, tokens_used = ?, tokens_total = ?, tool_calls = ?, claude_session_id = ?, ended_at = ? WHERE id = ?
  `).run(status, ctxPct, tokensUsed, tokensTotal, toolCalls, sessionId, endedAt, agentId);
    broadcastAll('agent:status', { agentId, status, ctxPct, tokensUsed, tokensTotal, toolCalls });
}
async function appendLog(logPath, obj) {
    try {
        await fs.appendFile(logPath, JSON.stringify(obj) + '\n', 'utf-8');
    }
    catch {
        // ignore
    }
}
function handleJsonLine(active, line) {
    if (!line.trim())
        return;
    const agentId = active.agentId;
    appendLog(active.logPath, { raw: line, ts: Date.now() });
    const db = getDb();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (!agent)
        return;
    const parser = agent.cli === 'claude-code' ? parseClaudeEvent : parseCodexEvent;
    const events = parser(line);
    for (const ev of events) {
        if (ev.kind === 'sys') {
            const msgId = saveMessage(agentId, 'sys', { content: ev.content });
            broadcastAll('agent:message', {
                agentId,
                message: { id: msgId, kind: 'sys', content: ev.content, ts: Date.now() },
            });
        }
        else if (ev.kind === 'think') {
            const msgId = saveMessage(agentId, 'think', { content: ev.content });
            broadcastAll('agent:message', {
                agentId,
                message: { id: msgId, kind: 'think', content: ev.content, ts: Date.now() },
            });
        }
        else if (ev.kind === 'tool') {
            // If item.started already registered this toolUseId, skip creating a duplicate
            if (ev.toolUseId && active.pendingTools.has(ev.toolUseId)) {
                continue;
            }
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
        }
        else if (ev.kind === 'tool_result') {
            // find pending tool message
            let toolMsgId;
            if (ev.toolUseId && active.pendingTools.has(ev.toolUseId)) {
                toolMsgId = active.pendingTools.get(ev.toolUseId);
                active.pendingTools.delete(ev.toolUseId);
            }
            else {
                // find last running tool
                const lastTool = db.prepare(`
          SELECT id FROM messages WHERE agent_id = ? AND kind = 'tool' AND tool_status = 'running' ORDER BY ts DESC LIMIT 1
        `).get(agentId);
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
        }
        else if (ev.kind === 'out') {
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
                }
                else {
                    // append delta to DB (read current, append)
                    const cur = db.prepare('SELECT content FROM messages WHERE id = ?').get(active.currentOutMsgId);
                    const newContent = (cur?.content ?? '') + (ev.content ?? '');
                    updateMessageStreaming(active.currentOutMsgId, newContent, false);
                    broadcastAll('agent:message:stream', {
                        agentId,
                        messageId: active.currentOutMsgId,
                        delta: ev.content ?? '',
                    });
                }
            }
            else {
                // complete out block (non-streaming)
                if (active.currentOutMsgId) {
                    // finalize streaming
                    const cur = db.prepare('SELECT content FROM messages WHERE id = ?').get(active.currentOutMsgId);
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
        }
        else if (ev.kind === 'session_id' && ev.sessionId) {
            db.prepare('UPDATE agents SET claude_session_id = ? WHERE id = ?').run(ev.sessionId, agentId);
        }
        else if (ev.kind === 'ctx_update') {
            if (ev.contextWindow != null && ev.contextWindow > 0) {
                active.contextWindow = ev.contextWindow;
            }
            if (ev.totalTokens != null) {
                const tokensUsed = ev.tokensUsed ?? ev.totalTokens;
                const tokensTotal = ev.tokensTotal ?? active.contextWindow;
                const pct = tokensTotal > 0 ? Math.min(100, (tokensUsed / tokensTotal) * 100) : 0;
                db.prepare('UPDATE agents SET ctx_pct = ?, tokens_used = ?, tokens_total = ? WHERE id = ?')
                    .run(pct, tokensUsed, tokensTotal, agentId);
                broadcastAll('agent:ctx', {
                    agentId,
                    ctxPct: pct,
                    tokensUsed,
                    tokensTotal,
                });
            }
            else if (ev.contextWindow != null && ev.totalTokens == null) {
                // task_started: just update the context window size, no token count yet
                db.prepare('UPDATE agents SET tokens_total = ? WHERE id = ?').run(ev.contextWindow, agentId);
                broadcastAll('agent:ctx', {
                    agentId,
                    ctxPct: null,
                    tokensUsed: null,
                    tokensTotal: ev.contextWindow,
                });
            }
            else if (ev.pct !== undefined) {
                // legacy fallback
                db.prepare('UPDATE agents SET ctx_pct = ? WHERE id = ?').run(ev.pct, agentId);
                broadcastAll('agent:ctx', { agentId, ctxPct: ev.pct });
            }
        }
    }
}
function handleExit(active, code) {
    const agentId = active.agentId;
    processes.delete(agentId);
    // finalize any open streaming message
    if (active.currentOutMsgId) {
        const db = getDb();
        const cur = db.prepare('SELECT content FROM messages WHERE id = ?').get(active.currentOutMsgId);
        updateMessageStreaming(active.currentOutMsgId, cur?.content ?? '', true);
        broadcastAll('agent:message:stream:end', { agentId, messageId: active.currentOutMsgId });
    }
    // mark any still-running tools as error
    const db = getDb();
    db.prepare(`
    UPDATE messages SET tool_status = 'error' WHERE agent_id = ? AND kind = 'tool' AND tool_status = 'running'
  `).run(agentId);
    // If process was intentionally killed (interrupt/cancel), skip status/sys-message updates
    // so the caller's explicit status set is not overwritten.
    if (active.killed)
        return;
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
export function spawnAgent(agentId, prompt) {
    const db = getDb();
    const agent = db.prepare(`
    SELECT a.*, t.date FROM agents a JOIN todos t ON a.todo_id = t.id WHERE a.id = ?
  `).get(agentId);
    if (!agent) {
        console.error(`[runner] agent ${agentId} not found`);
        return;
    }
    const date = agent.date;
    const logPath = join(agentFolderPath(date, agent.todo_id, agentId), 'log.jsonl');
    const workspacePath = resolveWorkspacePath(agent.workspace) || agent.workspace;
    const { cmd, args, useStdin } = buildCommand(agent, prompt);
    // Log the exact CLI command being executed for debugging/auditing
    const cmdLogPath = join(agentFolderPath(date, agent.todo_id, agentId), 'cmd.log');
    const cmdLine = [cmd, ...args].map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ');
    const cmdLogEntry = `[${new Date().toISOString()}] ${cmdLine}\n`;
    fs.appendFile(cmdLogPath, cmdLogEntry, 'utf-8').catch(() => { });
    // Augment PATH so CLIs installed via homebrew/local are found regardless of
    // how the Node process was started (e.g. from an IDE without a login shell).
    const augmentedPath = [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        process.env.PATH ?? '',
    ].join(':');
    const proc = spawn(cmd, args, {
        cwd: workspacePath,
        env: { ...process.env, PATH: augmentedPath },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    const active = {
        proc,
        agentId,
        logPath,
        currentOutMsgId: null,
        pendingTools: new Map(),
        killed: false,
        contextWindow: agent.tokens_total > 0 ? agent.tokens_total : getDefaultContextWindow(agent.model),
    };
    processes.set(agentId, active);
    if (useStdin && proc.stdin) {
        proc.stdin.write(prompt + '\n');
        proc.stdin.end();
    }
    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', (line) => handleJsonLine(active, line));
    let stderrBuf = '';
    proc.stderr?.on('data', (chunk) => {
        const text = chunk.toString();
        appendLog(logPath, { stderr: text, ts: Date.now() });
        stderrBuf += text;
        // Flush complete lines as sys messages so errors are visible in the chat
        const lines = stderrBuf.split('\n');
        stderrBuf = lines.pop() ?? '';
        for (const line of lines) {
            if (!line.trim())
                continue;
            const msgId = saveMessage(agentId, 'sys', { content: `[stderr] ${line}` });
            broadcastAll('agent:message', { agentId, message: { id: msgId, kind: 'sys', content: `[stderr] ${line}`, ts: Date.now() } });
        }
    });
    proc.stderr?.on('end', () => {
        if (stderrBuf.trim()) {
            const msgId = saveMessage(agentId, 'sys', { content: `[stderr] ${stderrBuf.trim()}` });
            broadcastAll('agent:message', { agentId, message: { id: msgId, kind: 'sys', content: `[stderr] ${stderrBuf.trim()}`, ts: Date.now() } });
        }
    });
    proc.on('error', (err) => {
        active.killed = true; // prevent handleExit from double-reporting
        processes.delete(agentId);
        const msg = err.message.includes('ENOENT')
            ? `CLI not found: '${cmd}'. Make sure it is installed and on PATH.`
            : `Failed to start process: ${err.message}`;
        console.error(`[runner] spawn error for agent ${agentId}:`, err.message);
        const msgId = saveMessage(agentId, 'sys', { content: msg });
        broadcastAll('agent:message', { agentId, message: { id: msgId, kind: 'sys', content: msg, ts: Date.now() } });
        updateAgentStatus(agentId, 'error', { endedAt: Date.now() });
    });
    proc.on('exit', (code) => handleExit(active, code));
    updateAgentStatus(agentId, 'running');
    console.log(`[runner] spawned ${cmd} for agent ${agentId}`);
}
export function killAgent(agentId) {
    const active = processes.get(agentId);
    if (!active)
        return false;
    active.killed = true;
    active.proc.kill('SIGTERM');
    processes.delete(agentId);
    return true;
}
export function isAgentRunning(agentId) {
    return processes.has(agentId);
}
export function resetStaleAgents() {
    const db = getDb();
    db.prepare(`UPDATE agents SET status = 'idle' WHERE status = 'running'`).run();
    console.log('[runner] reset stale running agents to idle');
}
