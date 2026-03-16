const connections = new Set();
export function addConnection(ws) {
    connections.add(ws);
    ws.on('close', () => connections.delete(ws));
}
export function broadcastAll(type, payload) {
    const msg = JSON.stringify({ type, payload, ts: Date.now() });
    for (const ws of connections) {
        if (ws.readyState === 1 /* OPEN */) {
            ws.send(msg);
        }
    }
}
export function getConnectionCount() {
    return connections.size;
}
