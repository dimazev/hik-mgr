import { sql } from 'drizzle-orm';
import { sqliteTable, integer, text, unique } from 'drizzle-orm/sqlite-core';

export const devices = sqliteTable('devices', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull().default(80),
  protocol: text('protocol', { enum: ['http', 'https'] }).notNull().default('http'),
  username: text('username').notNull().default('admin'),
  passwordEnc: text('password_enc').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type DeviceRow = typeof devices.$inferSelect;
export type NewDeviceRow = typeof devices.$inferInsert;

// A custom, user-editable label per (device, channel) — the ISAPI channel
// list is always fetched live from the device (never cached), but its
// channel *names* aren't something this app can rename on the device
// itself, so custom labels are stored here instead and merged onto the
// live channel list by id when returned from the API. No row here for a
// channel means "use whatever name the device reports" — see
// GET /:id/channels and PUT /:id/channels/:channelId/label in
// api/devices.ts.
export const channelLabels = sqliteTable(
  'channel_labels',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    deviceId: integer('device_id').notNull(),
    channelId: integer('channel_id').notNull(),
    label: text('label').notNull(),
    updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    deviceChannelUnique: unique().on(table.deviceId, table.channelId),
  })
);

export type ChannelLabelRow = typeof channelLabels.$inferSelect;

// Cached recording-history summary per (device, channel) — how far back
// recordings go and how many files were found. Scanning the device for
// this is slow (it has to page through its whole search index), so the
// result is cached here and only recomputed on an explicit refresh
// (?refresh=1 on GET /:id/channels/:channelId/recording-history) rather
// than on every page load.
export const recordingHistory = sqliteTable(
  'recording_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    deviceId: integer('device_id').notNull(),
    channelId: integer('channel_id').notNull(),
    earliestStart: text('earliest_start'),
    fileCount: integer('file_count').notNull().default(0),
    truncated: integer('truncated').notNull().default(0),
    updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    deviceChannelUnique: unique().on(table.deviceId, table.channelId),
  })
);

export type RecordingHistoryRow = typeof recordingHistory.$inferSelect;

// A "download files" tap on the recording files list creates one of these
// (plus its download_task_files rows) instead of streaming straight to the
// browser — see downloadWorker.ts, which works through a task's files one
// at a time and updates these rows as it goes so the Tasks page can poll
// progress.
export const downloadTasks = sqliteTable('download_tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deviceId: integer('device_id').notNull(),
  status: text('status', { enum: ['pending', 'running', 'completed', 'failed', 'cancelled'] })
    .notNull()
    .default('pending'),
  totalFiles: integer('total_files').notNull().default(0),
  completedFiles: integer('completed_files').notNull().default(0),
  failedFiles: integer('failed_files').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type DownloadTaskRow = typeof downloadTasks.$inferSelect;

export const downloadTaskFiles = sqliteTable('download_task_files', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: integer('task_id').notNull(),
  channelId: integer('channel_id').notNull(),
  channelName: text('channel_name').notNull(),
  playbackURI: text('playback_uri').notNull(),
  filename: text('filename').notNull(),
  startTime: text('start_time'),
  endTime: text('end_time'),
  sizeBytes: integer('size_bytes'),
  status: text('status', { enum: ['pending', 'downloading', 'done', 'failed'] })
    .notNull()
    .default('pending'),
  downloadedBytes: integer('downloaded_bytes').notNull().default(0),
  totalBytes: integer('total_bytes'),
  etaSeconds: integer('eta_seconds'),
  error: text('error'),
  // The ffmpeg-conversion subtask for this file — see the comment on
  // DownloadTaskFileConvertStatus in shared/src/schema.ts.
  convertStatus: text('convert_status', { enum: ['pending', 'converting', 'done', 'failed'] })
    .notNull()
    .default('pending'),
  convertProgress: integer('convert_progress'),
  convertError: text('convert_error'),
});

export type DownloadTaskFileRow = typeof downloadTaskFiles.$inferSelect;
