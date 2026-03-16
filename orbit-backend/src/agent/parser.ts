export interface ParsedEvent {
  kind: 'sys' | 'think' | 'tool' | 'out' | 'ctx_update' | 'session_id' | 'tool_result';
  content?: string;
  tool?: string;
  input?: string;
  output?: string;
  status?: 'ok' | 'error' | 'running';
  pct?: number;
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
  usage?: { input_tokens: number; output_tokens: number };
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
      const total = (event.usage.input_tokens ?? 0) + (event.usage.output_tokens ?? 0);
      const pct = Math.min(100, (total / 200000) * 100);
      results.push({ kind: 'ctx_update', pct });
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
  if (type === 'thinking') return [{ kind: 'think', content: event.content as string }];
  if (type === 'tool_call') return [{
    kind: 'tool',
    tool: event.name as string,
    input: JSON.stringify(event.input),
    status: 'running',
  }];
  if (type === 'tool_result') return [{
    kind: 'tool_result',
    output: event.output as string,
    status: 'ok',
  }];
  if (type === 'output' || type === 'message') return [{ kind: 'out', content: event.content as string }];

  return [];
}
