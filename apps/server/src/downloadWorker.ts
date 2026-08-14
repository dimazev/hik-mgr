import path from 'node:path';
import fs from 'node:fs';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { downloadRecording, type DeviceConn, type DownloadProgress } from './hik/isapi';
import { convertVideo, type ConvertProgress } from './videoConvert';
import { sanitizeFilename, convertedFilename } from './fileNaming';
import {
  getDownloadTask,
  updateTaskStatus,
  updateTaskFileStatus,
  updateTaskFileProgress,
  updateTaskFileConvertStatus,
  updateTaskFileConvertProgress,
  incrementTaskCounts,
} from './db/downloadTasks';
import { env } from './env';

function log(taskId: number, message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[download-task ${taskId}] ${message}`);
}

function formatEta(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 1) return '<1 min';
  return `${mins} min${mins === 1 ? '' : 's'}`;
}

interface ActiveTask {
  cancelRequested: boolean;
  activeStream?: NodeJS.ReadableStream;
  activeConvertProcess?: ChildProcessWithoutNullStreams;
}

// Tracks tasks currently being worked on *in this process* — used both to
// stop a double-invocation (resume clicked twice, or resume racing a
// still-running task) and to let requestCancelTask reach into whatever's
// actively running (a download stream or an ffmpeg process) and actually
// abort it, not just stop before the next file/subtask.
const activeTasks = new Map<number, ActiveTask>();

/**
 * Signals a task to stop as soon as possible: if it's actively downloading
 * a file or converting one right now, that operation is aborted
 * immediately (stream destroyed / ffmpeg killed) rather than waiting for
 * it to finish, and the loop won't start another file. Returns true if a
 * running task was actually found and signalled; false means this process
 * has no worker for that task (e.g. it's 'pending' and hasn't been picked
 * up, or already finished/interrupted) — the route handler falls back to
 * just marking it 'cancelled' in the DB.
 */
export function requestCancelTask(taskId: number): boolean {
  const active = activeTasks.get(taskId);
  if (!active) return false;
  active.cancelRequested = true;
  active.activeStream?.destroy(new Error('Cancelled by user'));
  active.activeConvertProcess?.kill('SIGTERM');
  return true;
}

export function isTaskActive(taskId: number): boolean {
  return activeTasks.has(taskId);
}

function needsWork(file: { status: string; convertStatus: string }): boolean {
  return file.status !== 'done' || file.convertStatus !== 'done';
}

/**
 * Works through a download task's not-yet-finished files strictly one at a
 * time (never concurrently, and never overlapping a download with a
 * conversion) — matches how the device's own download endpoint is used
 * elsewhere in this app, and keeps "downloading file 3 of 12" a simple,
 * accurate thing to show on the Tasks page. Each file goes through two
 * subtasks in order: download, then (once downloaded) the fixed ffmpeg
 * transcode from videoConvert.ts — a file can be fully downloaded while
 * its conversion subtask is still pending, converting, or failed.
 *
 * Safe to call more than once for the same task (create, resume-after-
 * failure, resume-after-interruption, retry-after-cancel): a file whose
 * download is already 'done' isn't re-downloaded, a file whose conversion
 * is already 'done' isn't re-converted, and a partially-downloaded file on
 * disk is resumed via downloadRecording's own Range-based resume rather
 * than restarted from scratch. Fire-and-forgotten by the route handlers —
 * this function owns updating the task/file rows as it goes so
 * GET /api/tasks(/:id) always reflects current progress when polled, and
 * logs progress to the server console as it works.
 */
export async function runDownloadTask(taskId: number, conn: DeviceConn): Promise<void> {
  if (activeTasks.has(taskId)) {
    log(taskId, 'already being processed in this process, ignoring duplicate start/resume');
    return;
  }

  const task = getDownloadTask(taskId);
  if (!task) return;

  const active: ActiveTask = { cancelRequested: false };
  activeTasks.set(taskId, active);

  const outstanding = task.files.filter(needsWork);
  log(taskId, `starting — ${outstanding.length} of ${task.totalFiles} file(s) have work outstanding`);
  updateTaskStatus(taskId, 'running');

  const taskDir = path.join(env.downloadsDir, `task-${taskId}`);
  fs.mkdirSync(taskDir, { recursive: true });

  try {
    for (const file of outstanding) {
      if (active.cancelRequested) {
        log(taskId, 'cancelled — stopping before next file');
        break;
      }

      const destPath = path.join(taskDir, sanitizeFilename(file.filename));
      let downloadSucceeded = file.status === 'done';

      if (!downloadSucceeded) {
        updateTaskFileStatus(file.id, 'downloading', { etaSeconds: null });
        log(taskId, `downloading "${file.filename}" (channel ${file.channelName})`);

        // ETA is estimated from THIS attempt's own throughput (bytes
        // received since this attempt started, over wall-clock time since
        // then) rather than the file's overall progress — a resumed
        // download's transfer rate this time around is what predicts how
        // much longer it'll actually take, not some blend with a
        // previous, possibly much slower or interrupted, attempt.
        const attemptStartedAt = Date.now();

        // Throttle DB writes + log lines to roughly once/sec — onProgress
        // can fire many times a second for a fast local device, and
        // there's no value in a DB write that often.
        let lastReported = 0;
        const onProgress = (p: DownloadProgress) => {
          const now = Date.now();
          if (now - lastReported < 1000) return;
          lastReported = now;

          const elapsedSeconds = (now - attemptStartedAt) / 1000;
          const bytesThisAttempt = p.receivedBytes - p.resumedFrom;
          const bytesPerSecond = elapsedSeconds > 0 ? bytesThisAttempt / elapsedSeconds : 0;
          const remainingBytes = p.totalBytes !== null ? p.totalBytes - p.receivedBytes : null;
          const etaSeconds =
            bytesPerSecond > 0 && remainingBytes !== null ? Math.round(remainingBytes / bytesPerSecond) : null;

          updateTaskFileProgress(file.id, p.receivedBytes, p.totalBytes, etaSeconds);
          const pct = p.percent !== null ? `${p.percent.toFixed(0)}%` : `${Math.round(p.receivedBytes / 1024)} KB`;
          const etaText = etaSeconds !== null ? `, ETA ${formatEta(etaSeconds)}` : '';
          log(
            taskId,
            `  "${file.filename}": ${pct}${etaText}${p.resumedFrom ? ` (resumed from ${Math.round(p.resumedFrom / 1024)} KB)` : ''}`
          );
        };

        try {
          await downloadRecording(conn, file.playbackURI, destPath, onProgress, {
            onStreamStart: (stream) => {
              active.activeStream = stream;
            },
            onResumeDecision: ({ attempted, honored, existingBytes }) => {
              if (!attempted) return;
              if (honored) {
                log(taskId, `  "${file.filename}": device honored resume, continuing from ${Math.round(existingBytes / 1024)} KB`);
              } else {
                log(
                  taskId,
                  `  "${file.filename}": device did not honor resume (replied 200, not 206) — re-downloading the ` +
                    `full file from byte 0 instead of continuing from the ${Math.round(existingBytes / 1024)} KB already on disk`
                );
              }
            },
          });
          active.activeStream = undefined;

          const downloadedBytes = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0;
          updateTaskFileStatus(file.id, 'done', {
            downloadedBytes,
            totalBytes: downloadedBytes,
            etaSeconds: null,
            error: null,
          });
          incrementTaskCounts(taskId, { completed: 1 });
          log(taskId, `downloaded: "${file.filename}" (${Math.round(downloadedBytes / 1024)} KB)`);
          downloadSucceeded = true;
        } catch (err: any) {
          active.activeStream = undefined;
          const message = err?.message || 'Download failed';

          if (active.cancelRequested) {
            // The error is *because* we destroyed the stream to cancel —
            // leave the file 'pending' (not 'failed') so a later resume
            // retries it cleanly instead of reporting a spurious failure.
            updateTaskFileStatus(file.id, 'pending', { etaSeconds: null, error: null });
            log(taskId, `cancelled mid-download: "${file.filename}"`);
            break;
          }

          updateTaskFileStatus(file.id, 'failed', { etaSeconds: null, error: message });
          incrementTaskCounts(taskId, { failed: 1 });
          log(taskId, `download failed: "${file.filename}" — ${message}`);
        }
      }

      // Conversion only ever runs against a successfully downloaded file —
      // a download failure this round means there's nothing on disk yet to
      // convert, so skip straight to the next file.
      if (!downloadSucceeded || active.cancelRequested) continue;

      updateTaskFileConvertStatus(file.id, 'converting', { convertError: null });
      updateTaskFileConvertProgress(file.id, null);
      const convertedPath = path.join(taskDir, convertedFilename(file.filename));
      log(taskId, `converting "${file.filename}" (scale 1280x720, crf 26)`);

      let lastConvertReported = 0;
      const onConvertProgress = (p: ConvertProgress) => {
        const now = Date.now();
        if (now - lastConvertReported < 1000) return;
        lastConvertReported = now;
        const rounded = p.percent !== null ? Math.round(p.percent) : null;
        updateTaskFileConvertProgress(file.id, rounded);
        log(taskId, `  converting "${file.filename}": ${rounded !== null ? `${rounded}%` : `${Math.round((p.elapsedSeconds ?? 0))}s elapsed`}`);
      };

      try {
        await convertVideo(destPath, convertedPath, onConvertProgress, {
          onProcessStart: (proc) => {
            active.activeConvertProcess = proc;
          },
        });
        active.activeConvertProcess = undefined;
        updateTaskFileConvertStatus(file.id, 'done', { convertError: null });
        updateTaskFileConvertProgress(file.id, 100);
        log(taskId, `converted: "${file.filename}"`);
      } catch (err: any) {
        active.activeConvertProcess = undefined;
        const message = err?.message || 'Conversion failed';

        if (active.cancelRequested) {
          updateTaskFileConvertStatus(file.id, 'pending', { convertError: null });
          log(taskId, `cancelled mid-conversion: "${file.filename}"`);
          break;
        }

        // Deliberately doesn't touch the task's completed/failed counters
        // — those track the download itself, which already succeeded.
        // ffmpeg missing on the server (ENOENT) ends up here too, with a
        // clear message rather than crashing the whole task.
        updateTaskFileConvertStatus(file.id, 'failed', { convertError: message });
        log(taskId, `conversion failed: "${file.filename}" — ${message}`);
      }
    }
  } finally {
    activeTasks.delete(taskId);
  }

  const finalTask = getDownloadTask(taskId);
  const stillOutstanding = finalTask?.files.some((f) => f.status !== 'done') ?? false;

  let finalStatus: 'completed' | 'cancelled' | 'failed';
  if (active.cancelRequested) {
    finalStatus = 'cancelled';
  } else if (!stillOutstanding) {
    finalStatus = 'completed';
  } else {
    finalStatus = 'failed';
  }

  updateTaskStatus(taskId, finalStatus);
  log(
    taskId,
    `finished: ${finalStatus} (${finalTask?.completedFiles ?? 0} downloaded, ${finalTask?.failedFiles ?? 0} download-failed, ${task.totalFiles} total)`
  );
}
