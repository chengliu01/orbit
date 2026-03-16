import { getDb } from '../db/client.js';
import { config } from '../config.js';
export async function workspaceRoutes(app) {
    // GET /api/workspace
    app.get('/api/workspace', async () => {
        return { root: config.WORKSPACE_ROOT };
    });
    // GET /api/workspace/dates
    app.get('/api/workspace/dates', async () => {
        const db = getDb();
        const rows = db.prepare(`
      SELECT DISTINCT date FROM todos ORDER BY date DESC
    `).all();
        const today = new Date().toISOString().slice(0, 10);
        return rows.map(r => {
            const d = new Date(r.date + 'T00:00:00');
            const diff = Math.floor((new Date(today).getTime() - d.getTime()) / 86400000);
            let label = r.date;
            if (diff === 0)
                label = `Today, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
            else if (diff === 1)
                label = `Yesterday, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
            else
                label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: diff > 365 ? 'numeric' : undefined });
            const db2 = getDb();
            const total = db2.prepare('SELECT COUNT(*) as cnt FROM todos WHERE date = ? AND parent_id IS NULL').get(r.date).cnt;
            const done = db2.prepare("SELECT COUNT(*) as cnt FROM todos WHERE date = ? AND parent_id IS NULL AND status = 'done'").get(r.date).cnt;
            return { date: r.date, label, total, done };
        });
    });
}
