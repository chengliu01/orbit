import chokidar from 'chokidar';
import { relative } from 'path';
import { broadcastAll } from '../ws/handler.js';

const watchers = new Map<string, ReturnType<typeof chokidar.watch>>();

export function watchTodoWorkspace(todoId: string, workspacePath: string): void {
  if (watchers.has(todoId)) return;

  const watcher = chokidar.watch(workspacePath, {
    ignored: [
      '**/WORKSPACE.md',
      '**/.todo.json',
      '**/agents/**',
      '**/node_modules/**',
    ],
    ignoreInitial: true,
    depth: 5,
  });

  watcher.on('add', (filePath) => {
    broadcastAll('workspace:file', {
      todoId,
      event: 'add',
      path: relative(workspacePath, filePath),
    });
  });

  watcher.on('change', (filePath) => {
    broadcastAll('workspace:file', {
      todoId,
      event: 'change',
      path: relative(workspacePath, filePath),
    });
  });

  watcher.on('unlink', (filePath) => {
    broadcastAll('workspace:file', {
      todoId,
      event: 'unlink',
      path: relative(workspacePath, filePath),
    });
  });

  watchers.set(todoId, watcher);
}

export async function stopWatcher(todoId: string): Promise<void> {
  const w = watchers.get(todoId);
  if (w) {
    await w.close();
    watchers.delete(todoId);
  }
}
