import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { deviceInputSchema, deviceUpdateSchema, type Device } from '@hik-mgr/shared';
import { db } from '../db/client';
import { devices, type DeviceRow } from '../db/schema';
import { encryptSecret, decryptSecret } from '../crypto';
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
    const row = getDeviceRow(Number(req.params.id));
    if (!row) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    const result = await listChannels(toConn(row));
    res.json(result);
  })
);

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

    if (track) {
      const result = await searchRecordings(conn, { trackID: track, startTime, endTime, maxResults });
      res.json(result);
      return;
    }

    // No specific track requested — search every channel this device
    // reports, same "search all devices/channels by default" behavior as
    // hik-connect's list-files command, tagging each match with the
    // channel name it came from.
    let channelList: { id: number; name: string }[] = [];
    try {
      const { channels } = await listChannels(conn);
      channelList = channels.map((c) => ({ id: Number(c.id), name: c.name }));
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
    res.setHeader('Content-Disposition', `attachment; filename="recording-${row.id}-${Date.now()}.mp4"`);
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
