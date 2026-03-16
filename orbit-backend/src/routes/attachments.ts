import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { join } from 'path';
import { promises as fs } from 'fs';
import { getDb } from '../db/client.js';
import { resolveWorkspacePath } from '../fs/layout.js';

interface AgentRow {
  id: string;
  todo_id: string;
  workspace: string;
}

interface TodoRow {
  date: string;
}

export async function attachmentsRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/attachments — multipart upload
  app.post('/api/attachments', async (req, reply) => {
    const parts = req.parts();
    let agentId = '';
    const saved: object[] = [];

    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'agentId') {
        agentId = part.value as string;
        continue;
      }
      if (part.type === 'file') {
        if (!agentId) {
          await part.toBuffer(); // drain
          continue;
        }
        const db = getDb();
        const agent = db.prepare(`
          SELECT a.*, t.date FROM agents a JOIN todos t ON a.todo_id = t.id WHERE a.id = ?
        `).get(agentId) as (AgentRow & { date: string }) | undefined;

        if (!agent) {
          await part.toBuffer();
          continue;
        }

        const workspacePath = resolveWorkspacePath(agent.workspace) || agent.workspace;
        const attDir = join(workspacePath, 'agents', agentId, 'attachments');
        await fs.mkdir(attDir, { recursive: true });

        const ts = Date.now();
        const safeFilename = part.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filename = `${ts}_${safeFilename}`;
        const filepath = join(attDir, filename);

        const buffer = await part.toBuffer();
        await fs.writeFile(filepath, buffer);

        const id = 'att' + nanoid(6);
        const relPath = filepath; // absolute path for agent reference

        db.prepare(`
          INSERT INTO attachments (id, agent_id, message_id, filename, mime_type, size_bytes, path, created_at)
          VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
        `).run(id, agentId, part.filename, part.mimetype, buffer.length, relPath, ts);

        saved.push({
          id,
          filename: part.filename,
          mimeType: part.mimetype,
          sizeBytes: buffer.length,
          path: relPath,
        });
      }
    }

    return reply.code(201).send({ attachments: saved });
  });

  // GET /api/attachments/:id
  app.get('/api/attachments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const att = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as { path: string; filename: string; mime_type: string } | undefined;
    if (!att) return reply.code(404).send({ error: 'not found' });

    const buf = await fs.readFile(att.path);
    return reply
      .header('Content-Type', att.mime_type)
      .header('Content-Disposition', `inline; filename="${att.filename}"`)
      .send(buf);
  });

  // DELETE /api/attachments/:id
  app.delete('/api/attachments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const att = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as { path: string } | undefined;
    if (!att) return reply.code(404).send({ error: 'not found' });

    db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
    try {
      await fs.rm(att.path, { force: true });
    } catch {
      // ignore
    }

    return reply.code(204).send();
  });
}
