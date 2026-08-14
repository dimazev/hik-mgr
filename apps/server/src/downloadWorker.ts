import path from 'node:path';
import fs from 'node:fs';
import { downloadRecording, type DeviceConn } from './hik/isapi';
import { getDownloadTask, updateTaskStatus, updateTaskFileStatus, incrementTaskCounts } from './db/downloadTasks';
import { env } from './env';

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 150) || 'file';
}

/**
 * Works through a download task's files strictly one at a time (never
 * concurrently) — matches how the device's own download endpoint is used
 * elsewhere in this app, and keeps "downloading file 3 of 12" a simple,
 * accurate thing to show on the Tasks page rather than N simultaneous
 * progress bars. Meant to be fired-and-forgotten right after the task row
 * is created (see POST /:id/download-tasks) — this function owns updating
 * the task/file rows as it goes so GET /api/tasks(/​:id) always reflects
 * current progress when polled.
 */
export async function runDownloadTask(taskId: number, conn: DeviceConn): Promise<void> {
  const task = getDownloadTask(taskId);
  if (!task) return;

  updateTaskStatus(taskId, 'running');

  const taskDir = path.join(env.downloadsDir, `task-${taskId}`);
  fs.mkdirSync(taskDir, { recursive: true });

  for (const file of task.files) {
    updateTaskFileStatus(file.id, 'downloading');
    const destPath = path.join(taskDir, sanitizeFilename(file.filename));

    try {
      await downloadRecording(conn, file.playbackURI, destPath);
      const downloadedBytes = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0;
      updateTaskFileStatus(file.id, 'done', { downloadedBytes, error: null });
      incrementTaskCounts(taskId, { completed: 1 });
    } catch (err: any) {
      updateTaskFileStatus(file.id, 'failed', { error: err?.message || 'Download failed' });
      incrementTaskCounts(taskId, { failed: 1 });
    }
  }

  const finalTask = getDownloadTask(taskId);
  const allFailed = !!finalTask && finalTask.completedFiles === 0 && finalTask.failedFiles > 0;
  updateTaskStatus(taskId, allFailed ? 'failed' : 'completed');
}
