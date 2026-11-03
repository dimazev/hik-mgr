import fs from 'node:fs';
import path from 'node:path';
import { deleteDownloadTaskRows, listFinishedTaskIds } from './db/downloadTasks';
import { env } from './env';

function taskDir(taskId: number): string {
  return path.join(env.downloadsDir, `task-${taskId}`);
}

function dirSize(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

/** SQLite's CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" (UTC); the app's own writes are ISO strings. */
function parseTime(value: string): number {
  return Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

/**
 * Deletes a task: its rows AND everything it downloaded / converted (the whole task-<id> folder). The caller must
 * make sure the task is not running. Returns the bytes freed on disk.
 */
export function deleteTaskAndFiles(taskId: number): number {
  const dir = taskDir(taskId);
  const freedBytes = dirSize(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  deleteDownloadTaskRows(taskId);
  return freedBytes;
}

/** Deletes every finished task (completed / failed / cancelled / interrupted) not updated in the last `olderThanDays` days; 0 = all of them. */
export function deleteFinishedTasksOlderThan(olderThanDays: number, isActive: (taskId: number) => boolean): { deleted: number; freedBytes: number } {
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  let deleted = 0;
  let freedBytes = 0;
  for (const t of listFinishedTaskIds()) {
    if (isActive(t.id)) continue;
    const updated = parseTime(t.updatedAt);
    if (olderThanDays > 0 && !(updated < cutoff)) continue;
    freedBytes += deleteTaskAndFiles(t.id);
    deleted++;
  }
  return { deleted, freedBytes };
}
