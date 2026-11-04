import fs from 'node:fs';
import path from 'node:path';
import { deviceFileName, fileTimes, namedTimes } from '@hik-mgr/shared';
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
  /** the match item exactly as the camera sent it (every field) */
  raw?: unknown;
}

/**
 * The raw exchange with the camera for one page of a search: the XML request we sent (the window as the camera received it) and
 * the XML it answered, untouched. A reply bigger than 200 KB is cut and says so.
 */
export function logSearchExchange(opts: { trackID: number; position: number; requestXml: string; responseXml: string }): void {
  const MAX = 200_000;
  const cut = opts.responseXml.length > MAX;
  append({
    event: 'search-exchange',
    trackID: opts.trackID,
    position: opts.position,
    requestXml: opts.requestXml,
    responseXml: cut ? opts.responseXml.slice(0, MAX) : opts.responseXml,
    responseCutAt: cut ? MAX : undefined,
    responseLength: opts.responseXml.length,
  });
}

/** The extra question asked about the first / last recording of a search, and what the camera answered. */
export function logEdgeLookup(opts: {
  deviceId: number;
  channel: string;
  edge: 'start' | 'end';
  cameraFileName: string | null;
  reportedInSearch: string | undefined;
  asked: { startTime: string; endTime: string };
  found: { startTime?: string; endTime?: string; playbackURI?: string } | null;
  result: string | undefined;
}): void {
  append({ event: 'edge-lookup', ...opts });
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
      parsed: fileTimes(file.playbackURI, file.startTime, file.endTime, { startTime: (file as { realStartTime?: string }).realStartTime, endTime: (file as { realEndTime?: string }).realEndTime }),
      realStartTime: (file as { realStartTime?: string }).realStartTime,
      realEndTime: (file as { realEndTime?: string }).realEndTime,
      sizeBytes: file.sizeBytes,
      trackID: file.trackID,
      contentType: file.contentType,
      rawItem: file.raw,
    });
  }
}

/** The file name a download response announces (Content-Disposition), if any. */
export function dispositionFileName(headers: Record<string, unknown> | undefined): string | null {
  const raw = String(headers?.['content-disposition'] ?? '');
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(raw)?.[1];
  const plain = /filename="?([^";]+)"?/i.exec(raw)?.[1];
  const name = star ?? plain;
  if (!name) return null;
  try {
    return decodeURIComponent(name.trim());
  } catch {
    return name.trim();
  }
}

/**
 * A file that was downloaded: everything the camera told us about it and where the stored start came from, so a wrong time
 * can be traced - the playback address, the name in it, the name the download itself announced, every time found in them.
 */
export function logDownloaded(opts: {
  taskId: number;
  fileId: number;
  playbackURI: string;
  downloadFileName: string | null;
  responseHeaders: Record<string, unknown> | undefined;
  startFrom: string;
  startTime: string | null;
  endTime: string | null;
  seconds: number | null;
  bytes: number;
}): void {
  const { responseHeaders, ...rest } = opts;
  append({
    event: 'downloaded',
    ...rest,
    cameraFileName: deviceFileName(opts.playbackURI),
    timesInCameraFileName: namedTimes(deviceFileName(opts.playbackURI)),
    timesInDownloadFileName: namedTimes(opts.downloadFileName),
    responseHeaders,
  });
}
