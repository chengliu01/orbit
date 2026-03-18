export interface ParsedEvent {
  kind: 'sys' | 'think' | 'tool' | 'out' | 'ctx_update' | 'session_id' | 'tool_result';
  content?: string;
  tool?: string;
  input?: string;
  output?: string;
  status?: 'ok' | 'error' | 'running';
  pct?: number;
  totalTokens?: number;
  contextWindow?: number;
  tokensUsed?: number;
  tokensTotal?: number;
  sessionId?: string;
  toolUseId?: string;
  isStreaming?: boolean;
}

interface ClaudeContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | Array<{ type: string; text?: string }>;
}

interface ClaudeEvent {
  type: string;
  subtype?: string;
  message?: {
    content: ClaudeContentBlock[];
  };
  session_id?: string;
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  model_context_window?: number;
  cost_usd?: number;
  // streaming events
  index?: number;
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
  };
}

export function parseClaudeEvent(raw: string): ParsedEvent[] {
  let event: ClaudeEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return [];
  }

  if (event.type === 'system') {
    return [{ kind: 'sys', content: 'Session initialized' }];
  }

  if (event.type === 'assistant' && event.message) {
    const results: ParsedEvent[] = [];
    for (const block of event.message.content) {
      if (block.type === 'text' && block.text) {
        results.push({ kind: 'out', content: block.text });
      } else if (block.type === 'tool_use') {
        results.push({
          kind: 'tool',
          tool: block.name,
          input: JSON.stringify(block.input),
          status: 'running',
          toolUseId: block.id,
        });
      } else if (block.type === 'tool_result') {
        const outputContent = block.content;
        let output = '';
        if (typeof outputContent === 'string') {
          output = outputContent;
        } else if (Array.isArray(outputContent)) {
          output = outputContent.map(c => c.text ?? '').join('\n');
        }
        results.push({
          kind: 'tool_result',
          output,
          status: 'ok',
          toolUseId: block.tool_use_id,
        });
      }
    }
    return results;
  }

  // streaming text delta
  if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
    return [{ kind: 'out', content: event.delta.text, isStreaming: true }];
  }

  if (event.type === 'result') {
    const results: ParsedEvent[] = [];
    if (event.session_id) {
      results.push({ kind: 'session_id', sessionId: event.session_id });
    }
    if (event.usage) {
      const totalTokens = (event.usage.input_tokens ?? 0) + (event.usage.output_tokens ?? 0);
      const contextWindow = event.model_context_window;
      results.push({ kind: 'ctx_update', totalTokens, contextWindow });
    }
    return results;
  }

  return [];
}

export function parseCodexEvent(raw: string): ParsedEvent[] {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(raw);
  } catch {
    return [];
  }

  const type = event.type as string;

  // thread.started: capture session/thread id for resumption
  if (type === 'thread.started') {
    // codex may put the id at the top level or nested under a thread object
    const sid =
      (event.session_id as string | undefined) ??
      (event.thread_id as string | undefined) ??
      (event.id as string | undefined) ??
      ((event.thread as Record<string, unknown> | undefined)?.id as string | undefined);
    if (sid) return [{ kind: 'session_id', sessionId: sid }];
    return [];
  }

  // turn.started: no UI event needed
  if (type === 'turn.started') return [];

  // item.started: tool beginning (e.g. command_execution in_progress)
  if (type === 'item.started') {
    const item = event.item as Record<string, unknown>;
    if (!item) return [];
    const itemType = item.type as string;
    if (itemType === 'command_execution') {
      return [{
        kind: 'tool',
        tool: 'shell',
        input: item.command as string,
        status: 'running',
        toolUseId: item.id as string,
      }];
    }
    return [];
  }

  // item.completed: the main payload event
  if (type === 'item.completed') {
    const item = event.item as Record<string, unknown>;
    if (!item) return [];
    const itemType = item.type as string;

    if (itemType === 'agent_message') {
      return [{ kind: 'out', content: item.text as string }];
    }

    if (itemType === 'command_execution') {
      const toolId = item.id as string;
      const cmd = (item.command as string) ?? (item.cmd as string) ?? '';
      // Always emit tool start + result so a tool block always appears in the UI,
      // even when item.started was not received.  The runner deduplicates by toolUseId.
      return [
        { kind: 'tool', tool: 'shell', input: cmd, status: 'running', toolUseId: toolId },
        {
          kind: 'tool_result',
          output: (item.aggregated_output as string) ?? '',
          status: (item.exit_code as number) === 0 ? 'ok' : 'error',
          toolUseId: toolId,
        },
      ];
    }

    if (itemType === 'file_change') {
      const changes = item.changes as Array<{ path: string; kind: string }> | undefined;
      const input = changes ? changes.map(c => `${c.kind}: ${c.path}`).join('\n') : '';
      const id = item.id as string;
      // Emit tool start + immediate result so the runner saves and closes it in one pass
      return [
        { kind: 'tool', tool: 'file_change', input, status: 'running', toolUseId: id },
        { kind: 'tool_result', output: '', status: 'ok', toolUseId: id },
      ];
    }

    if (itemType === 'error') {
      return [{ kind: 'sys', content: item.message as string }];
    }

    return [];
  }

  // event_msg → task_started gives us context window upfront; token_count gives cumulative usage
  if (type === 'event_msg') {
    const payload = event.payload as Record<string, unknown> | undefined;
    if (!payload) return [];

    // task_started: capture model_context_window before any tokens are consumed
    if (payload.type === 'task_started' && payload.model_context_window != null) {
      return [{ kind: 'ctx_update', contextWindow: payload.model_context_window as number }];
    }

    // token_count: prefer last_token_usage for the just-finished turn; fall back to total_token_usage
    if (payload.type === 'token_count') {
      const info = payload.info as Record<string, unknown> | undefined;
      const lastUsage = info?.last_token_usage as Record<string, unknown> | undefined;
      const totalUsage = info?.total_token_usage as Record<string, unknown> | undefined;
      const ctxWindow = info?.model_context_window as number | undefined;
      const usage = lastUsage ?? totalUsage;
      if (usage != null) {
        const tokensUsed = (usage.total_tokens as number) ?? 0;
        const tokensTotal = ctxWindow ?? 0;
        return [{
          kind: 'ctx_update',
          totalTokens: tokensUsed,
          contextWindow: ctxWindow,
          tokensUsed,
          tokensTotal,
        }];
      }
    }
    return [];
  }

  // turn.completed → update context usage
  if (type === 'turn.completed') {
    const usage = event.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    if (usage) {
      const totalTokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
      return [{ kind: 'ctx_update', totalTokens }];
    }
    return [];
  }

  // top-level error
  if (type === 'error') {
    let msg = event.message as string;
    try { const parsed = JSON.parse(msg); msg = parsed?.detail ?? msg; } catch {}
    return [{ kind: 'sys', content: msg }];
  }

  // turn.failed
  if (type === 'turn.failed') {
    const err = event.error as { message?: string } | undefined;
    let msg = err?.message ?? 'Turn failed';
    try { const parsed = JSON.parse(msg); msg = parsed?.detail ?? msg; } catch {}
    return [{ kind: 'sys', content: msg }];
  }

  return [];
}
