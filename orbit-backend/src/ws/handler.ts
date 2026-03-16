import type { WebSocket } from '@fastify/websocket';

const connections = new Set<WebSocket>();

export function addConnection(ws: WebSocket): void {
  connections.add(ws);
  ws.on('close', () => connections.delete(ws));
}

export function broadcastAll(type: string, payload: unknown): void {
  const msg = JSON.stringify({ type, payload, ts: Date.now() });
  for (const ws of connections) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(msg);
    }
  }
}

export function getConnectionCount(): number {
  return connections.size;
}
