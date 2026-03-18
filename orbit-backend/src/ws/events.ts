export interface WsMessage {
  type: string;
  payload: unknown;
  ts: number;
}

export type AgentStatus = 'idle' | 'running' | 'finished' | 'error';

export interface AgentStatusPayload {
  agentId: string;
  status: AgentStatus;
  ctxPct?: number;
  toolCalls?: number;
  tokensUsed?: number;
  tokensTotal?: number;
}

export interface AgentMessagePayload {
  agentId: string;
  message: {
    id: string;
    kind: string;
    content?: string;
    tool?: string;
    input?: string;
    output?: string;
    status?: string;
    streaming?: boolean;
    ts: number;
  };
}

export interface AgentStreamPayload {
  agentId: string;
  messageId: string;
  delta: string;
}

export interface AgentStreamEndPayload {
  agentId: string;
  messageId: string;
}

export interface WorkspaceFilePayload {
  todoId: string;
  agentId?: string;
  event: 'add' | 'change' | 'unlink';
  path: string;
}
