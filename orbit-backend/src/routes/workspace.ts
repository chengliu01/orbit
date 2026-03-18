import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/client.js';
import { config } from '../config.js';
import { execFile } from 'child_process';

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/workspace
  app.get('/api/workspace', async () => {
    return { root: config.WORKSPACE_ROOT };
  });

  // GET /api/workspace/dates
  app.get('/api/workspace/dates', async () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT DISTINCT date FROM todos ORDER BY date DESC
    `).all() as { date: string }[];

    const today = new Date().toISOString().slice(0, 10);

    return rows.map(r => {
      const d = new Date(r.date + 'T00:00:00');
      const diff = Math.floor((new Date(today).getTime() - d.getTime()) / 86400000);
      let label = r.date;
      if (diff === 0) label = `Today, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      else if (diff === 1) label = `Yesterday, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      else label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: diff > 365 ? 'numeric' : undefined });

      const db2 = getDb();
      const total = (db2.prepare('SELECT COUNT(*) as cnt FROM todos WHERE date = ? AND parent_id IS NULL').get(r.date) as { cnt: number }).cnt;
      const done = (db2.prepare("SELECT COUNT(*) as cnt FROM todos WHERE date = ? AND parent_id IS NULL AND status = 'done'").get(r.date) as { cnt: number }).cnt;

      return { date: r.date, label, total, done };
    });
  });

  // GET /api/workspace/pick-directory  — opens a native macOS folder picker
  app.get('/api/workspace/pick-directory', async (_req, reply) => {
    const script = `
      tell application "System Events"
        activate
      end tell
      set chosenFolder to choose folder with prompt "Select workspace folder"
      return POSIX path of chosenFolder
    `;
    return new Promise((resolve) => {
      execFile('osascript', ['-e', script], { timeout: 60000 }, (err, stdout) => {
        if (err) {
          // user cancelled or osascript unavailable
          reply.code(204).send();
          resolve(undefined);
          return;
        }
        resolve({ path: stdout.trim() });
      });
    });
  });
}
