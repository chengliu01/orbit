import { promises as fs } from 'fs';
import { isAbsolute, join, resolve } from 'path';
import { config } from '../config.js';

export function todoFolderPath(date: string, todoId: string): string {
  return join(config.WORKSPACE_ROOT, date, `todo_${todoId}`);
}

export function agentFolderPath(date: string, todoId: string, agentId: string): string {
  return join(todoFolderPath(date, todoId), 'agents', agentId);
}

export function resolveWorkspacePath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) return '';

  const home = process.env.HOME ?? '';
  if (trimmed === '~') return home || trimmed;
  if (trimmed.startsWith('~/')) return home ? join(home, trimmed.slice(2)) : trimmed;
  return isAbsolute(trimmed) ? trimmed : resolve(trimmed);
}

export async function createTodoFolder(date: string, todoId: string): Promise<void> {
  const base = todoFolderPath(date, todoId);
  await fs.mkdir(join(base, 'agents'), { recursive: true });
}

export async function deleteTodoFolder(date: string, todoId: string): Promise<void> {
  const base = todoFolderPath(date, todoId);
  await fs.rm(base, { recursive: true, force: true });
}

export async function createAgentFolder(date: string, todoId: string, agentId: string): Promise<void> {
  const base = agentFolderPath(date, todoId, agentId);
  await fs.mkdir(join(base, 'attachments'), { recursive: true });
}

export async function writeTodoJson(date: string, todoId: string, data: object): Promise<void> {
  const base = todoFolderPath(date, todoId);
  await fs.writeFile(join(base, '.todo.json'), JSON.stringify(data, null, 2), 'utf-8');
}

export async function listWorkspaceFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string, base: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.name.startsWith('.') || entry.name === 'WORKSPACE.md' || entry.name === 'agents' || entry.name === 'node_modules') continue;
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), rel);
      } else {
        files.push(rel);
      }
    }
  }
  await walk(dirPath, '');
  return files;
}
