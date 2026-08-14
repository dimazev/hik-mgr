import { Router, type Request, type Response } from 'express';
import { listDownloadTasks, getDownloadTask } from '../db/downloadTasks';

// Global (not device-scoped) — the Tasks page shows every download task
// across every device, so this is its own router rather than nested under
// /api/devices/:id like everything else. Task *creation* still happens
// device-scoped, at POST /api/devices/:id/download-tasks (api/devices.ts),
// since that's where we have the device's connection details.
const router = Router();

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

export default router;
