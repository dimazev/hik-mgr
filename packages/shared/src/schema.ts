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

export type DownloadTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type DownloadTaskFileStatus = 'pending' | 'downloading' | 'done' | 'failed';

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
  downloadedBytes: number;
  error: string | null;
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
