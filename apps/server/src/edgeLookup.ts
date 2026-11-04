import { deviceFileName, recordingTimes } from '@hik-mgr/shared';
import { logEdgeLookup } from './cameraLog';
import { env } from './env';
import { searchRecordings, type DeviceConn } from './hik/isapi';

/**
 * The camera clips the first and last recording of a search to the searched window: asked 15:00, the recording that really
 * began at 14:46:47 is reported as beginning at 15:00:00, with no field anywhere holding the true start (its file name is just a
 * number). So for exactly those two files this asks the camera once more with the window starting earlier (or ending later)
 * - the same recording then comes back with its real start (or end) - and records it as realStartTime / realEndTime.
 *
 * Nothing is added to the results and nothing is removed; only the times of the edge files are corrected.
 */

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const TOLERANCE_MS = 2000;

interface EdgeFile {
  playbackURI?: string;
  startTime?: string;
  endTime?: string;
  realStartTime?: string;
  realEndTime?: string;
}

export async function refineEdges<T extends EdgeFile>(opts: {
  conn: DeviceConn;
  deviceId: number;
  channel: string;
  trackID: number;
  files: T[];
  askedStart: string | undefined;
  askedEnd: string | undefined;
}): Promise<void> {
  const { conn, deviceId, channel, trackID, files } = opts;
  const askedFrom = Date.parse(opts.askedStart ?? '');
  const askedTo = Date.parse(opts.askedEnd ?? '');
  if (env.edgeLookupMinutes <= 0 || files.length === 0 || Number.isNaN(askedFrom) || Number.isNaN(askedTo)) return;
  const pad = env.edgeLookupMinutes * 60_000;

  const times = files.map((f) => ({ f, ...recordingTimes(f) }));
  const first = times.reduce((a, b) => (Date.parse(b.startTime ?? '') < Date.parse(a.startTime ?? '') ? b : a));
  const last = times.reduce((a, b) => (Date.parse(b.endTime ?? '') > Date.parse(a.endTime ?? '') ? b : a));

  // start edge: the earliest file begins exactly where the window begins -> probably clipped
  if (first.startTime && Math.abs(Date.parse(first.startTime) - askedFrom) <= TOLERANCE_MS) {
    const win = { startTime: iso(askedFrom - pad), endTime: iso(askedFrom + 1000) };
    await ask('start', first.f, win, (found) => {
      if (found.startTime && Date.parse(found.startTime) < askedFrom - TOLERANCE_MS) first.f.realStartTime = found.startTime;
    });
  }
  // end edge: the latest file ends exactly where the window ends -> probably clipped
  if (last.endTime && Math.abs(Date.parse(last.endTime) - askedTo) <= TOLERANCE_MS) {
    const win = { startTime: iso(askedTo - 1000), endTime: iso(askedTo + pad) };
    await ask('end', last.f, win, (found) => {
      if (found.endTime && Date.parse(found.endTime) > askedTo + TOLERANCE_MS) last.f.realEndTime = found.endTime;
    });
  }

  async function ask(edge: 'start' | 'end', file: T, win: { startTime: string; endTime: string }, apply: (found: EdgeFile) => void): Promise<void> {
    const name = deviceFileName(file.playbackURI);
    let found: EdgeFile | null = null;
    let result: string;
    try {
      const res = await searchRecordings(conn, { trackID, startTime: win.startTime, endTime: win.endTime, maxResults: 50 });
      // the same recording is recognised by the camera's own file name
      found = (name ? res.files.find((x) => deviceFileName(x.playbackURI) === name) : undefined) ?? null;
      if (found) {
        apply(found);
        result = 'found';
      } else {
        result = `recording ${name ?? '(no name)'} not in the answer (${res.files.length} files)`;
      }
    } catch (err) {
      result = `lookup failed: ${(err as Error)?.message ?? err}`;
    }
    logEdgeLookup({
      deviceId,
      channel,
      edge,
      cameraFileName: name,
      reportedInSearch: edge === 'start' ? file.startTime : file.endTime,
      asked: win,
      found: found ? { startTime: found.startTime, endTime: found.endTime, playbackURI: found.playbackURI } : null,
      result,
    });
  }
}
