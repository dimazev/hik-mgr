import { z } from 'zod';

/**
 * Input schema for creating/updating a managed Hikvision device.
 * `password` is only ever accepted here (write side) — it's encrypted at
 * rest server-side and never returned by the API (see the `Device`
 * interface below, which deliberately has no password field).
 */
export const deviceInputSchema = z.object({
  name: z.string().min(1, 'name is required').max(200),
  host: z.string().min(1, 'host is required').max(255),
  port: z.coerce.number().int().min(1).max(65535).default(80),
  protocol: z.enum(['http', 'https']).default('http'),
  username: z.string().min(1).max(100).default('admin'),
  password: z.string().min(1, 'password is required').max(500),
});

export type DeviceInput = z.infer<typeof deviceInputSchema>;

/** Same as deviceInputSchema but every field optional, for PATCH/PUT updates. */
export const deviceUpdateSchema = deviceInputSchema.partial();
export type DeviceUpdateInput = z.infer<typeof deviceUpdateSchema>;

/** Device as returned by the API — never includes the password. */
export interface Device {
  id: number;
  name: string;
  host: string;
  port: number;
  protocol: 'http' | 'https';
  username: string;
  createdAt: string;
}

export interface Channel {
  id: number;
  /** Name as reported by the device — not editable, this app can't rename it on the device itself. */
  name: string;
  ip?: string | null;
  online?: boolean | null;
  /** User-set override, stored locally (see channel_labels table). Null if never set — fall back to `name` for display. */
  label?: string | null;
}

/** Body for PUT /api/devices/:id/channels/:channelId/label */
export const channelLabelInputSchema = z.object({
  // Empty string clears the custom label (falls back to the device's own
  // channel name again) rather than storing an empty label forever.
  label: z.string().max(200),
});
export type ChannelLabelInput = z.infer<typeof channelLabelInputSchema>;

export interface RecordingFile {
  trackID: number;
  startTime?: string;
  endTime?: string;
  playbackURI: string;
  contentType?: string;
  sizeBytes?: number;
  deviceChannelName?: string | null;
}

export interface DeviceStatus {
  raw: unknown;
}

/**
 * Cached summary of a channel's recording history — how far back its
 * recordings go and how many files were found — computed by scanning the
 * device (which can be slow) and cached in recording_history so subsequent
 * loads are instant. See GET /:id/channels/:channelId/recording-history.
 */
export interface RecordingHistorySummary {
  channelId: number;
  /** Earliest recording start time found, or null if the channel has no recordings. */
  earliestStart: string | null;
  /** Number of recording files found (capped by the scan's maxResults — see `truncated`). */
  fileCount: number;
  /** True if the scan hit its result cap and there may be more/older recordings than counted. */
  truncated: boolean;
  /** When this summary was last computed. */
  updatedAt: string;
}

// --- Download tasks -------------------------------------------------------
//
// Tapping "Download" on the recording files list doesn't stream a file
// straight to the browser anymore — it queues a background task that the
// server works through one file at a time (see downloadWorker.ts),
// persists in download_tasks/download_task_files, and is tracked on the
// Tasks page rather than as a browser download.

// 'interrupted' is set on any task still marked 'running' when the server
// starts up — it was mid-download when the process died/restarted, so
// there's no worker actually working on it anymore even though the DB row
// says "running". Distinct from 'failed' so the Tasks page can say "the
// server restarted" rather than "a file failed", though both are resumable
// the same way (POST /api/tasks/:taskId/resume).
export type DownloadTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type DownloadTaskFileStatus = 'pending' | 'downloading' | 'done' | 'failed';

// Each file's conversion is a subtask of its download: it only starts
// once that file's `status` is 'done', runs the fixed ffmpeg transcode
// (see videoConvert.ts), and is tracked/resumed independently of the
// download itself — a file can be fully downloaded ('done') while its
// conversion is still 'pending', 'converting', or has 'failed' (e.g.
// ffmpeg isn't installed on the server). Conversion outcome deliberately
// doesn't affect the parent task's completedFiles/failedFiles counters,
// which track downloads only.
export type DownloadTaskFileConvertStatus = 'pending' | 'converting' | 'done' | 'failed';

/** One file to queue for download — supplied by the client when creating a task. */
export const downloadTaskFileInputSchema = z.object({
  channelId: z.coerce.number().int(),
  channelName: z.string().min(1).max(200),
  playbackURI: z.string().min(1),
  filename: z.string().min(1).max(255),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  sizeBytes: z.coerce.number().nullable().optional(),
});
export type DownloadTaskFileInput = z.infer<typeof downloadTaskFileInputSchema>;

/** Body for POST /api/devices/:id/download-tasks */
export const createDownloadTaskSchema = z.object({
  files: z.array(downloadTaskFileInputSchema).min(1, 'At least one file is required'),
});
export type CreateDownloadTaskInput = z.infer<typeof createDownloadTaskSchema>;

export interface DownloadTaskFile extends DownloadTaskFileInput {
  id: number;
  status: DownloadTaskFileStatus;
  /** Bytes written to disk so far — updated live while status is 'downloading', final size once 'done'. */
  downloadedBytes: number;
  /** Total size reported by the device for this file, if known yet (null until the response headers arrive). */
  totalBytes: number | null;
  /**
   * Estimated seconds remaining for the download, based on this attempt's
   * average throughput so far — null until there's enough data to
   * estimate (no total size known, or download not yet in progress).
   * Cleared back to null once the file is 'done'.
   */
  etaSeconds: number | null;
  error: string | null;
  /** The ffmpeg-conversion subtask for this file — see DownloadTaskFileConvertStatus above. */
  convertStatus: DownloadTaskFileConvertStatus;
  /** 0–100, updated live while convertStatus is 'converting'; null otherwise or if ffmpeg's output couldn't be parsed. */
  convertProgress: number | null;
  convertError: string | null;
}

export interface DownloadTask {
  id: number;
  deviceId: number;
  deviceName: string;
  status: DownloadTaskStatus;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  createdAt: string;
  updatedAt: string;
}

export interface DownloadTaskDetail extends DownloadTask {
  files: DownloadTaskFile[];
}
