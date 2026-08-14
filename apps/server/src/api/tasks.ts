import path from 'node:path';
import fs from 'node:fs';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { devices } from '../db/schema';
import { decryptSecret } from '../crypto';
import { getDownloadTask, listDownloadTasks, updateTaskStatus } from '../db/downloadTasks';
import { runDownloadTask, requestCancelTask, isTaskActive } from '../downloadWorker';
import { convertedFilename } from '../fileNaming';
import { env } from '../env';
import type { DeviceConn } from '../hik/isapi';

// Global (not device-scoped) — the Tasks page shows every download task
// across every device, so this is its own router rather than nested under
// /api/devices/:id like everything else. Task *creation* still happens
// device-scoped, at POST /api/devices/:id/download-tasks (api/devices.ts),
// since that's where we have the device's connection details up front;
// resume re-derives the same connection details from the task's stored
// deviceId instead.
const router = Router();

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

router.get('/', (_req: Request, res: Response) => {
  res.json(listDownloadTasks());
});

router.get('/:taskId', (req: Request, res: Response) => {
  const taskId = Number(req.params.taskId);
  if (!Number.isFinite(taskId)) {
    res.status(400).json({ error: 'Invalid task id' });
    return;
  }
  const task = getDownloadTask(taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json(task);
});

// Stops a task as soon as possible — mid-file if it's actively
// downloading one (requestCancelTask aborts that HTTP stream directly),
// otherwise just marks it cancelled if it hasn't been picked up yet.
// Already-finished tasks can't be cancelled (nothing to stop).
router.post(
  '/:taskId/cancel',
  asyncHandler(async (req, res) => {
    const taskId = Number(req.params.taskId);
    const task = getDownloadTask(taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    if (task.status === 'completed' || task.status === 'cancelled') {
      res.status(400).json({ error: `Task is already ${task.status}` });
      return;
    }

    const wasActive = requestCancelTask(taskId);
    if (!wasActive) {
      // No worker in this process is touching it right now (e.g. still
      // 'pending', or 'interrupted'/'failed' from a previous run) —
      // nothing to abort, just mark it cancelled directly.
      updateTaskStatus(taskId, 'cancelled');
    }
    res.json({ ok: true });
  })
);

// Re-runs the task: skips any file whose download is already 'done' (and
// resumes a partially-downloaded one on disk via downloadRecording's Range
// support) and any file whose conversion subtask is already 'done'. Covers
// every reason there'd be outstanding work — a download that failed
// partway, was cancelled, was interrupted by a server restart, or a
// conversion that failed/was interrupted even though every file
// downloaded fine (task.status can read 'completed' in that case, since
// that status only tracks downloads — see downloadWorker.ts).
router.post(
  '/:taskId/resume',
  asyncHandler(async (req, res) => {
    const taskId = Number(req.params.taskId);
    const task = getDownloadTask(taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    if (task.status === 'running' || task.status === 'pending' || isTaskActive(taskId)) {
      res.status(400).json({ error: 'Task is already in progress' });
      return;
    }
    const hasOutstandingWork = task.files.some((f) => f.status !== 'done' || f.convertStatus !== 'done');
    if (!hasOutstandingWork) {
      res.status(400).json({ error: 'Nothing to resume — every file is downloaded and converted' });
      return;
    }

    const deviceRow = db.select().from(devices).where(eq(devices.id, task.deviceId)).get();
    if (!deviceRow) {
      res.status(404).json({ error: 'The device this task belongs to no longer exists' });
      return;
    }

    const conn: DeviceConn = {
      protocol: deviceRow.protocol as 'http' | 'https',
      host: deviceRow.host,
      port: deviceRow.port,
      username: deviceRow.username,
      password: decryptSecret(deviceRow.passwordEnc),
    };

    runDownloadTask(taskId, conn).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`Download task ${taskId} crashed on resume:`, err);
      updateTaskStatus(taskId, 'failed');
    });

    res.json({ ok: true });
  })
);

// Serves the ffmpeg-converted copy of one task file as a real browser
// download — this is the only file this app streams straight to the
// browser for these tasks; the *raw* downloaded file stays server-side in
// data/downloads/. Only available once that file's conversion subtask has
// actually finished.
router.get(
  '/:taskId/files/:fileId/download',
  asyncHandler(async (req, res) => {
    const taskId = Number(req.params.taskId);
    const fileId = Number(req.params.fileId);
    const task = getDownloadTask(taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const file = task.files.find((f) => f.id === fileId);
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    if (file.convertStatus !== 'done') {
      res.status(400).json({ error: `Converted file is not ready yet (${file.convertStatus})` });
      return;
    }

    const taskDir = path.join(env.downloadsDir, `task-${taskId}`);
    const outName = convertedFilename(file.filename);
    const convertedPath = path.join(taskDir, outName);
    if (!fs.existsSync(convertedPath)) {
      res.status(404).json({ error: 'Converted file is missing on disk' });
      return;
    }

    res.download(convertedPath, outName);
  })
);

export default router;
