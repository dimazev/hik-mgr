import { eq } from 'drizzle-orm';
import type {
  DownloadTask,
  DownloadTaskDetail,
  DownloadTaskFileInput,
  DownloadTaskFileStatus,
  DownloadTaskStatus,
} from '@hik-mgr/shared';
import { db } from './client';
import { devices, downloadTaskFiles, downloadTasks, type DownloadTaskFileRow, type DownloadTaskRow } from './schema';

function toPublicTask(row: DownloadTaskRow, deviceName: string): DownloadTask {
  return {
    id: row.id,
    deviceId: row.deviceId,
    deviceName,
    status: row.status as DownloadTaskStatus,
    totalFiles: row.totalFiles,
    completedFiles: row.completedFiles,
    failedFiles: row.failedFiles,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPublicFile(row: DownloadTaskFileRow) {
  return {
    id: row.id,
    channelId: row.channelId,
    channelName: row.channelName,
    playbackURI: row.playbackURI,
    filename: row.filename,
    startTime: row.startTime,
    endTime: row.endTime,
    sizeBytes: row.sizeBytes,
    status: row.status as DownloadTaskFileStatus,
    downloadedBytes: row.downloadedBytes,
    error: row.error,
  };
}

/**
 * Creates a task row plus one row per requested file (all starting
 * 'pending') in a single transaction, and returns the new task's id. The
 * caller (POST /:id/download-tasks) is responsible for kicking off
 * downloadWorker.runDownloadTask afterward — this function only persists
 * the task, it doesn't start downloading anything.
 */
export function createDownloadTask(deviceId: number, files: DownloadTaskFileInput[]): number {
  return db.transaction((tx) => {
    const result = tx.insert(downloadTasks).values({ deviceId, totalFiles: files.length }).run();
    const taskId = Number(result.lastInsertRowid);
    for (const f of files) {
      tx.insert(downloadTaskFiles)
        .values({
          taskId,
          channelId: f.channelId,
          channelName: f.channelName,
          playbackURI: f.playbackURI,
          filename: f.filename,
          startTime: f.startTime ?? null,
          endTime: f.endTime ?? null,
          sizeBytes: f.sizeBytes ?? null,
        })
        .run();
    }
    return taskId;
  });
}

export function listDownloadTasks(): DownloadTask[] {
  const rows = db
    .select({ task: downloadTasks, deviceName: devices.name })
    .from(downloadTasks)
    .leftJoin(devices, eq(downloadTasks.deviceId, devices.id))
    .all();

  return rows
    .map((r) => toPublicTask(r.task, r.deviceName ?? `Device #${r.task.deviceId}`))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id - a.id));
}

export function getDownloadTask(taskId: number): DownloadTaskDetail | undefined {
  const row = db.select().from(downloadTasks).where(eq(downloadTasks.id, taskId)).get();
  if (!row) return undefined;

  const deviceRow = db.select().from(devices).where(eq(devices.id, row.deviceId)).get();
  const fileRows = db.select().from(downloadTaskFiles).where(eq(downloadTaskFiles.taskId, taskId)).all();

  return {
    ...toPublicTask(row, deviceRow?.name ?? `Device #${row.deviceId}`),
    files: fileRows.map(toPublicFile),
  };
}

export function updateTaskStatus(taskId: number, status: DownloadTaskStatus): void {
  db.update(downloadTasks)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(downloadTasks.id, taskId))
    .run();
}

export function updateTaskFileStatus(
  fileId: number,
  status: DownloadTaskFileStatus,
  extra: { downloadedBytes?: number; error?: string | null } = {}
): void {
  db.update(downloadTaskFiles)
    .set({ status, ...extra })
    .where(eq(downloadTaskFiles.id, fileId))
    .run();
}

/** Bumps a task's completed/failed counters by the given deltas (usually 1 of one, 0 of the other). */
export function incrementTaskCounts(taskId: number, delta: { completed?: number; failed?: number }): void {
  const row = db.select().from(downloadTasks).where(eq(downloadTasks.id, taskId)).get();
  if (!row) return;
  db.update(downloadTasks)
    .set({
      completedFiles: row.completedFiles + (delta.completed ?? 0),
      failedFiles: row.failedFiles + (delta.failed ?? 0),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(downloadTasks.id, taskId))
    .run();
}
