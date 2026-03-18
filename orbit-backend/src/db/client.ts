import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(config.DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

export function runMigrations(): void {
  const db = getDb();
  const sql = readFileSync(join(__dirname, 'migrations/001_init.sql'), 'utf-8');
  db.exec(sql);
  const agentColumns = db.prepare(`PRAGMA table_info(agents)`).all() as Array<{ name: string }>;
  if (!agentColumns.some((column) => column.name === 'reasoning_effort')) {
    db.exec(`ALTER TABLE agents ADD COLUMN reasoning_effort TEXT`);
  }
  if (!agentColumns.some((column) => column.name === 'tokens_used')) {
    db.exec(`ALTER TABLE agents ADD COLUMN tokens_used INTEGER NOT NULL DEFAULT 0`);
  }
  if (!agentColumns.some((column) => column.name === 'tokens_total')) {
    db.exec(`ALTER TABLE agents ADD COLUMN tokens_total INTEGER NOT NULL DEFAULT 0`);
  }
  console.log('[db] migrations applied');
}
