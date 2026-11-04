import fs from 'node:fs';
import path from 'node:path';
import { deviceFileName, fileTimes } from '@hik-mgr/shared';
import { env } from './env';

/**
 * A plain log of what the camera itself reported, one JSON object per line, in <data folder>/logs/camera-files.log:
 * every recording a search returned - with the camera's original file name, the full playback address and the time span
 * exactly as received. Nothing is dropped from the log, and nothing is padded or filtered in the search either.
 * Meant for tracing a wrong time: grep the file name, compare "reported" with "parsed".
 */

const LOG_DIR = path.join(path.dirname(env.dbPath), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'camera-files.log');
const MAX_BYTES = 20 * 1024 * 1024; // past this the file is renamed to camera-files.log.1 (one old copy is kept)

function append(entry: Record<string, unknown>): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_BYTES) fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    fs.appendFileSync(LOG_FILE, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch (err) {
    // the log must never break a search or a download
    // eslint-disable-next-line no-console
    console.error('camera log write failed:', err);
  }
}

export interface ReportedFile {
  trackID?: unknown;
  startTime?: string;
  endTime?: string;
  playbackURI?: string;
  contentType?: unknown;
  sizeBytes?: unknown;
}

/** One search: what was asked (and sent to the camera as is) and EVERY file it returned. */
export function logSearch(opts: {
  deviceId: number;
  channel: string;
  asked: { start?: string; end?: string };
  files: ReportedFile[];
}): void {
  append({ event: 'search-begin', deviceId: opts.deviceId, channel: opts.channel, asked: opts.asked, returned: opts.files.length });
  for (const file of opts.files) {
    append({
      event: 'search-file',
      deviceId: opts.deviceId,
      channel: opts.channel,
      cameraFileName: deviceFileName(file.playbackURI),
      playbackURI: file.playbackURI,
      reported: { startTime: file.startTime, endTime: file.endTime },
      parsed: fileTimes(file.playbackURI, file.startTime, file.endTime),
      sizeBytes: file.sizeBytes,
      trackID: file.trackID,
      contentType: file.contentType,
    });
  }
}

/** A file that was downloaded: the original name and address again, the times stored, the length actually received. */
export function logDownloaded(opts: {
  taskId: number;
  fileId: number;
  playbackURI: string;
  startTime: string | null;
  endTime: string | null;
  seconds: number | null;
  bytes: number;
}): void {
  append({ event: 'downloaded', ...opts, cameraFileName: deviceFileName(opts.playbackURI) });
}
