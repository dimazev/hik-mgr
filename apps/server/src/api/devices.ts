import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { deviceInputSchema, deviceUpdateSchema, channelLabelInputSchema, createDownloadTaskSchema, type Device } from '@hik-mgr/shared';
import { db } from '../db/client';
import { devices, type DeviceRow } from '../db/schema';
import { encryptSecret, decryptSecret } from '../crypto';
import { getLabelsForDevice, setChannelLabel } from '../db/channelLabels';
import { getRecordingHistory, saveRecordingHistory } from '../db/recordingHistory';
import { createDownloadTask, updateTaskStatus } from '../db/downloadTasks';
import { runDownloadTask } from '../downloadWorker';
import {
  getDeviceStatus,
  getDeviceInfo,
  listDevices as listChannels,
  searchRecordings,
  streamRecordingToResponse,
  captureSnapshot,
  type DeviceConn,
} from '../hik/isapi';

const router = Router();

function toPublicDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    protocol: row.protocol as 'http' | 'https',
    username: row.username,
    createdAt: row.createdAt,
  };
}

function toConn(row: DeviceRow): DeviceConn {
  return {
    protocol: row.protocol as 'http' | 'https',
    host: row.host,
    port: row.port,
    username: row.username,
    password: decryptSecret(row.passwordEnc),
  };
}

function getDeviceRow(id: number): DeviceRow | undefined {
  return db.select().from(devices).where(eq(devices.id, id)).get();
}

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

// --- CRUD -------------------------------------------------------------

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = db.select().from(devices).all();
    res.json(rows.map(toPublicDevice));
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = deviceInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const input = parsed.data;
    const result = db
      .insert(devices)
      .values({
        name: input.name,
        host: input.host,
        port: input.port,
        protocol: input.protocol,
        username: input.username,
        passwordEnc: encryptSecret(input.password),
      })
      .run();

    const row = getDeviceRow(Number(result.lastInsertRowid));
    if (!row) {
      res.status(500).json({ error: 'Device was created but could not be re-read' });
      return;
    }
    res.status(201).json(toPublicDevice(row));
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = getDeviceRow(id);
    if (!existing) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    const parsed = deviceUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const input = parsed.data;
    db.update(devices)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.host !== undefined ? { host: input.host } : {}),
        ...(input.port !== undefined ? { port: input.port } : {}),
        ...(input.protocol !== undefined ? { protocol: input.protocol } : {}),
        ...(input.username !== undefined ? { username: input.username } : {}),
        ...(input.password !== undefined ? { passwordEnc: encryptSecret(input.password) } : {}),
      })
      .where(eq(devices.id, id))
      .run();

    const row = getDeviceRow(id);
    res.json(toPublicDevice(row!));
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    db.delete(devices).where(eq(devices.id, id)).run();
    res.status(204).end();
  })
);

// --- Device operations --------------------------------------------------

router.get(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const row = getDeviceRow(Number(req.params.id));
    if (!row) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    const conn = toConn(row);
    const [status, info] = await Promise.all([
      getDeviceStatus(conn).catch((e: Error) => ({ error: e.message })),
      getDeviceInfo(conn).catch((e: Error) => ({ error: e.message })),
    ]);
    res.json({ status, info });
  })
);

router.get(
  '/:id/channels',
  asyncHandler(async (req, res) => {
    const deviceId = Number(req.params.id);
    const row = getDeviceRow(deviceId);
    if (!row) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    const result = await listChannels(toConn(row));
    // The channel list itself always comes live from the device (nothing
    // about it is cached) — only the custom label per channel is stored
    // locally, merged in here by channel id.
    const labels = getLabelsForDevice(deviceId);
    res.json({
      ...result,
      channels: result.channels.map((ch) => ({
        ...ch,
        label: labels.get(Number(ch.id)) ?? null,
      })),
    });
  })
);

router.put(
  '/:id/channels/:channelId/label',
  asyncHandler(async (req, res) => {
    const deviceId = Number(req.params.id);
    const channelId = Number(req.params.channelId);
    const row = getDeviceRow(deviceId);
    if (!row) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    if (!Number.isFinite(channelId)) {
      res.status(400).json({ error: 'Invalid channel id' });
      return;
    }
    const parsed = channelLabelInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    setChannelLabel(deviceId, channelId, parsed.data.label);
    res.json({ channelId, label: parsed.data.label.trim() || null });
  })
);

// How far back to look and how many results to scan when computing a
// channel's recording-history summary (earliest recording + file count).
// This is a one-off scan of the device's whole search index, which is why
// the result is cached (see db/recordingHistory.ts) instead of redone on
// every page load — only ?refresh=1 forces a fresh scan.
const RECORDING_HISTORY_EPOCH = '2000-01-01T00:00:00Z';
const RECORDING_HISTORY_MAX_RESULTS = 5000;

router.get(
  '/:id/channels/:channelId/recording-history',
  asyncHandler(async (req, res) => {
    const deviceId = Number(req.params.id);
    const channelId = Number(req.params.channelId);
    const row = getDeviceRow(deviceId);
    if (!row) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    if (!Number.isFinite(channelId)) {
      res.status(400).json({ error: 'Invalid channel id' });
      return;
    }

    const forceRefresh = req.query.refresh === '1';
    if (!forceRefresh) {
      const cached = getRecordingHistory(deviceId, channelId);
      if (cached) {
        res.json(cached);
        return;
      }
      // Never scanned yet, and this request isn't an explicit "go scan it"
      // — the scan below hits the device's whole recording index (slow),
      // so it only ever runs for a channel the caller specifically asked
      // for (refresh=1), not as a side effect of merely loading this page.
      // Without this early return, opening a device with many channels
      // would fire one full-index scan per channel, all at once.
      res.json({ channelId, earliestStart: null, fileCount: null, truncated: false, updatedAt: null, scanned: false });
      return;
    }

    const trackID = channelId * 100 + 1;
    const result = await searchRecordings(toConn(row), {
      trackID,
      startTime: RECORDING_HISTORY_EPOCH,
      endTime: new Date().toISOString(),
      maxResults: RECORDING_HISTORY_MAX_RESULTS,
    });

    let earliestStart: string | null = null;
    for (const f of result.files) {
      if (f.startTime && (!earliestStart || f.startTime < earliestStart)) earliestStart = f.startTime;
    }

    const summary = {
      channelId,
      earliestStart,
      fileCount: result.numOfMatches,
      truncated: result.truncated,
      updatedAt: new Date().toISOString(),
      scanned: true,
    };

    saveRecordingHistory(deviceId, summary);
    res.json(summary);
  })
);

// Searches by exact [start, end) timespan. The device's own CMSearch
// (searchRecordingsPage) returns every recording that *overlaps* the
// requested timespan, not just ones fully contained by it — so a search
// for e.g. 13:00–14:00 also finds a file that started at 12:55 and is
// still recording at 13:00, i.e. a file "which includes this frame" at
// the boundary is found rather than skipped. No extra filtering needed
// here for that.
router.get(
  '/:id/files',
  asyncHandler(async (req, res) => {
    const row = getDeviceRow(Number(req.params.id));
    if (!row) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    const conn = toConn(row);
    const track = req.query.track ? Number(req.query.track) : undefined;
    const startTime = typeof req.query.start === 'string' ? req.query.start : undefined;
    const endTime = typeof req.query.end === 'string' ? req.query.end : undefined;
    const maxResults = req.query.max ? Number(req.query.max) : undefined;
    // Optional comma-separated list of channel ids to restrict the search
    // to (e.g. from the Recordings tab's channel picker) — lets a caller
    // that only wants a few channels skip scanning the rest of the device
    // entirely, rather than fetching everything and filtering client-side.
    const channelFilter =
      typeof req.query.channels === 'string' && req.query.channels.trim() !== ''
        ? new Set(
            req.query.channels
              .split(',')
              .map((s) => Number(s.trim()))
              .filter((n) => Number.isFinite(n))
          )
        : undefined;

    if (track) {
      const result = await searchRecordings(conn, { trackID: track, startTime, endTime, maxResults });
      res.json(result);
      return;
    }

    // No specific track requested — search every channel this device
    // reports (or, if channelFilter is set, only the requested ones), same
    // "search all devices/channels by default" behavior as hik-connect's
    // list-files command, tagging each match with the channel name it
    // came from. Prefer the user's custom label (same one shown/edited on
    // the Channels tab) over the device's own raw channel name, so this
    // list reads the same way everywhere in the app — falls back to the
    // device name for channels that were never labeled.
    const labels = getLabelsForDevice(deviceId);
    let channelList: { id: number; name: string }[] = [];
    try {
      const { channels } = await listChannels(conn);
      channelList = channels
        .map((c) => ({ id: Number(c.id), name: labels.get(Number(c.id)) || c.name }))
        .filter((c) => !channelFilter || channelFilter.has(c.id));
    } catch {
      // No separate channel list available — fall back to the single
      // default track (101), same convention as hik-connect.
      channelList = [];
    }

    if (channelList.length === 0) {
      const result = await searchRecordings(conn, { trackID: 101, startTime, endTime, maxResults });
      res.json({ ...result, files: result.files.map((f) => ({ ...f, deviceChannelName: null })) });
      return;
    }

    const merged: any[] = [];
    for (const ch of channelList) {
      const trackID = ch.id * 100 + 1;
      const result = await searchRecordings(conn, { trackID, startTime, endTime, maxResults });
      merged.push(...result.files.map((f) => ({ ...f, deviceChannelName: ch.name })));
    }
    res.json({ numOfMatches: merged.length, files: merged });
  })
);

// Queues a background download task instead of streaming straight to the
// browser — the recording files page's single "Download" button posts the
// whole (confirmed) file list here. Responds as soon as the task row is
// persisted; runDownloadTask keeps working through it file-by-file in the
// background, updating the DB as it goes (see downloadWorker.ts) so
// GET /api/tasks/:taskId reflects live progress when the Tasks page polls it.
router.post(
  '/:id/download-tasks',
  asyncHandler(async (req, res) => {
    const deviceId = Number(req.params.id);
    const row = getDeviceRow(deviceId);
    if (!row) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    const parsed = createDownloadTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const taskId = createDownloadTask(deviceId, parsed.data.files);

    runDownloadTask(taskId, toConn(row)).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`Download task ${taskId} crashed:`, err);
      updateTaskStatus(taskId, 'failed');
    });

    res.status(201).json({ taskId });
  })
);

router.get(
  '/:id/download',
  asyncHandler(async (req, res) => {
    const row = getDeviceRow(Number(req.params.id));
    if (!row) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    const playbackURI = typeof req.query.uri === 'string' ? req.query.uri : undefined;
    if (!playbackURI) {
      res.status(400).json({ error: 'Missing ?uri= (playbackURI)' });
      return;
    }
    const { stream, headers } = await streamRecordingToResponse(toConn(row), playbackURI);
    // Callers (the recordings file list) can pass a friendly filename
    // (channel name + recording start time) — strip anything that isn't
    // safe in a Content-Disposition header / filesystem name before
    // trusting it, and fall back to the old generic name otherwise.
    const requestedName = typeof req.query.filename === 'string' ? req.query.filename : undefined;
    const safeName = requestedName ? requestedName.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 150) : undefined;
    const filename = safeName || `recording-${row.id}-${Date.now()}.mp4`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (headers['content-length']) res.setHeader('Content-Length', String(headers['content-length']));
    res.setHeader('Content-Type', 'video/mp4');
    stream.pipe(res);
  })
);

router.get(
  '/:id/snapshot',
  asyncHandler(async (req, res) => {
    const row = getDeviceRow(Number(req.params.id));
    if (!row) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    const trackID = req.query.track ? Number(req.query.track) : 101;
    const jpeg = await captureSnapshot(toConn(row), trackID);
    res.setHeader('Content-Type', 'image/jpeg');
    res.send(jpeg);
  })
);

export default router;
