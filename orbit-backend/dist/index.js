import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocketPlugin from '@fastify/websocket';
import multipart from '@fastify/multipart';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { runMigrations } from './db/client.js';
import { loadModelsConfig } from './models-config.js';
import { todosRoutes } from './routes/todos.js';
import { agentsRoutes } from './routes/agents.js';
import { attachmentsRoutes } from './routes/attachments.js';
import { workspaceRoutes } from './routes/workspace.js';
import { addConnection } from './ws/handler.js';
import { resetStaleAgents } from './agent/runner.js';
import { getDb } from './db/client.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
// models.json lives at the project root (two levels up from src/)
const MODELS_PATH = resolve(__dirname, '../../models.json');
const app = Fastify({ logger: { level: 'info' } });
await app.register(cors, {
    origin: true, // allow all origins for local dev
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
});
await app.register(websocketPlugin);
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
// Routes
await todosRoutes(app);
await agentsRoutes(app);
await attachmentsRoutes(app);
await workspaceRoutes(app);
// GET /api/config/models — serve models.json so the UI can read it without restarting
app.get('/api/config/models', async (_req, reply) => {
    return reply.send(loadModelsConfig());
});
// WebSocket endpoint
app.get('/ws', { websocket: true }, (socket, req) => {
    addConnection(socket);
    // Send snapshot of running agents on connect
    const db = getDb();
    const runningAgents = db.prepare("SELECT * FROM agents WHERE status = 'running' OR status = 'idle'").all();
    socket.send(JSON.stringify({
        type: 'snapshot',
        payload: { agents: runningAgents },
        ts: Date.now(),
    }));
    socket.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'ping') {
                socket.send(JSON.stringify({ type: 'pong', payload: {}, ts: Date.now() }));
            }
        }
        catch {
            // ignore
        }
    });
});
// Run migrations and reset stale agents
runMigrations();
resetStaleAgents();
// Start server
const address = await app.listen({ port: config.PORT, host: '0.0.0.0' });
console.log(`[orbit] backend running at ${address}`);
