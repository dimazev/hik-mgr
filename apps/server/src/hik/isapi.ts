/**
 * Raw ISAPI calls, talking digest auth directly (axios + @mhoc/axios-digest-auth
 * + fast-xml-parser) rather than depending on @copcart/node-hikvision-api.
 *
 * This is a deliberate architectural choice: that library pulls in
 * `net-keepalive` -> `ffi-napi`/`ref-napi`, abandoned native addons that
 * don't build against newer Node versions (see hik-connect's README for the
 * full story). Rather than repeat that native-module/Docker risk here, this
 * ports the same proven raw-ISAPI logic from hik-connect's src/isapi.js
 * directly into TypeScript, with zero native dependencies beyond
 * better-sqlite3 (used only by the DB layer, not this module).
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import type { Readable } from 'node:stream';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import AxiosDigestAuth from '@mhoc/axios-digest-auth';
import { XMLParser } from 'fast-xml-parser';
import type { RecordingFile, Channel } from '@hik-mgr/shared';

export interface DeviceConn {
  protocol: 'http' | 'https';
  host: string;
  port: number;
  username: string;
  password: string;
}

const ALWAYS_ARRAY = new Set(['searchMatchItem', 'InputProxyChannel', 'InputProxyChannelStatus', 'VideoInputChannel']);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  isArray: (name) => ALWAYS_ARRAY.has(name),
});

function baseUrl({ protocol, host, port }: DeviceConn): string {
  return `${protocol}://${host}:${port}`;
}

function digestClient({ username, password }: DeviceConn) {
  return new AxiosDigestAuth({ username, password });
}

const SEARCH_PAGE_SIZE = 40;

export interface SearchOpts {
  trackID?: number;
  pageSize?: number;
  startTime?: string;
  endTime?: string;
  maxResults?: number;
  onPage?: (files: RecordingFile[], pageIndex: number) => void;
}

export async function getDeviceStatus(conn: DeviceConn): Promise<unknown> {
  const client = digestClient(conn);
  const res = await client.request({ method: 'GET', url: `${baseUrl(conn)}/ISAPI/System/status` });
  return xmlParser.parse(res.data);
}

export async function getDeviceInfo(conn: DeviceConn): Promise<unknown> {
  const client = digestClient(conn);
  const res = await client.request({ method: 'GET', url: `${baseUrl(conn)}/ISAPI/System/deviceInfo` });
  return xmlParser.parse(res.data);
}

async function searchRecordingsPage(
  conn: DeviceConn,
  search: SearchOpts,
  position: number
): Promise<{ responseStatus?: unknown; responseStatusStrg?: unknown; numOfMatches?: unknown; files: RecordingFile[] }> {
  const trackID = search.trackID ?? 101;
  const pageSize = search.pageSize ?? SEARCH_PAGE_SIZE;
  const startTime = search.startTime ?? isoDaysAgo(7);
  const endTime = search.endTime ?? new Date().toISOString();
  const searchID = crypto.randomUUID();

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<CMSearchDescription>
  <searchID>${searchID}</searchID>
  <trackList><trackID>${trackID}</trackID></trackList>
  <timeSpanList>
    <timeSpan>
      <startTime>${startTime}</startTime>
      <endTime>${endTime}</endTime>
    </timeSpan>
  </timeSpanList>
  <maxResults>${pageSize}</maxResults>
  <searchResultPostion>${position}</searchResultPostion>
</CMSearchDescription>`;

  const client = digestClient(conn);
  const response = await client.request({
    method: 'POST',
    url: `${baseUrl(conn)}/ISAPI/ContentMgmt/search`,
    headers: { 'Content-Type': 'application/xml' },
    data: body,
  });

  const parsed = xmlParser.parse(response.data);
  const result = parsed.CMSearchResult || {};
  const matches: any[] = result.matchList?.searchMatchItem || [];

  return {
    responseStatus: result.responseStatus,
    responseStatusStrg: result.responseStatusStrg,
    numOfMatches: result.numOfMatches,
    files: matches.map((item) => ({
      trackID: item.trackID,
      startTime: item.timeSpan?.startTime,
      endTime: item.timeSpan?.endTime,
      playbackURI: item.mediaSegmentDescriptor?.playbackURI,
      contentType: item.mediaSegmentDescriptor?.contentType,
      sizeBytes: item.mediaSegmentDescriptor?.size,
    })),
  };
}

export async function searchRecordings(
  conn: DeviceConn,
  search: SearchOpts = {}
): Promise<{ numOfMatches: number; pagesFetched: number; truncated: boolean; files: RecordingFile[] }> {
  const pageSize = search.pageSize ?? SEARCH_PAGE_SIZE;
  const maxResults = search.maxResults ?? 2000;
  const MAX_PAGES = 100;

  const files: RecordingFile[] = [];
  let position = 0;
  let pageIndex = 0;

  while (files.length < maxResults && pageIndex < MAX_PAGES) {
    const page = await searchRecordingsPage(conn, search, position);
    if (search.onPage) search.onPage(page.files, pageIndex);

    files.push(...page.files);
    pageIndex++;

    if (page.files.length < pageSize) break;
    position += pageSize;
  }

  return {
    numOfMatches: files.length,
    pagesFetched: pageIndex,
    truncated: pageIndex >= MAX_PAGES,
    files: files.slice(0, maxResults),
  };
}

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  resumedFrom: number;
}

/**
 * Streams a recording (given a playbackURI from searchRecordings) to a
 * file on disk. Resumable via HTTP Range, same logic as hik-connect: only
 * trusts the resume if the device actually replies 206, and detects a
 * quietly-truncated connection (stream ends without erroring but short of
 * the expected total) so the caller's retry logic can catch it.
 */
export async function downloadRecording(
  conn: DeviceConn,
  playbackURI: string,
  destPath: string,
  onProgress?: (p: DownloadProgress) => void,
  opts2: {
    resume?: boolean;
    // Called with the live response stream as soon as it's available, so
    // a caller (downloadWorker's cancel handling) can hang onto it and
    // call .destroy() to abort mid-file instead of only being able to
    // stop *between* files. Optional — nothing here depends on it being
    // used.
    onStreamStart?: (stream: Readable) => void;
    // Fired once, right after the device's response headers arrive, with
    // whether a resume was actually possible. `attempted` is true whenever
    // there were existing bytes on disk to try resuming from; `honored`
    // is only true if the device replied 206 to that Range request — a
    // 200 means it ignored Range and is sending the whole file from byte
    // 0 regardless (some Hikvision firmware doesn't support Range on this
    // particular download endpoint), so the "resume" silently becomes a
    // full re-download. Callers can use this to log/surface that instead
    // of it looking like a resume that mysteriously restarted from 0.
    onResumeDecision?: (info: { attempted: boolean; honored: boolean; existingBytes: number }) => void;
  } = {}
): Promise<string> {
  const resume = opts2.resume !== false;
  const existingBytes = resume && fs.existsSync(destPath) ? fs.statSync(destPath).size : 0;

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<downloadRequest>
  <playbackURI>${escapeXml(playbackURI)}</playbackURI>
</downloadRequest>`;

  const headers: Record<string, string> = { 'Content-Type': 'application/xml' };
  if (existingBytes > 0) {
    headers.Range = `bytes=${existingBytes}-`;
  }

  const client = digestClient(conn);
  const response = await client.request({
    method: 'POST',
    url: `${baseUrl(conn)}/ISAPI/ContentMgmt/download`,
    headers,
    data: body,
    responseType: 'stream',
  });

  const resumed = existingBytes > 0 && response.status === 206;
  const startByte = resumed ? existingBytes : 0;
  const totalBytes = resolveTotalBytes(response.headers, startByte);

  opts2.onResumeDecision?.({ attempted: existingBytes > 0, honored: resumed, existingBytes });
  opts2.onStreamStart?.(response.data);

  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(destPath, { flags: startByte > 0 ? 'r+' : 'w', start: startByte });
    let receivedBytes = startByte;

    const emitProgress = () =>
      onProgress?.({
        receivedBytes,
        totalBytes,
        percent: totalBytes ? Math.min(100, (receivedBytes / totalBytes) * 100) : null,
        resumedFrom: startByte,
      });

    // Byte counting on 'data' has to stay cheap — a fast LAN transfer can
    // fire this hundreds of times a second — so it's just an addition
    // here. The actual onProgress callback (which downloadWorker.ts turns
    // into a DB write + log line) runs on a fixed 1s timer instead of on
    // every chunk: nothing downstream needs sub-second granularity, and
    // calling it per-chunk was pure wasted CPU on top of the real work.
    response.data.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.length;
    });
    const progressTimer = onProgress ? setInterval(emitProgress, 1000) : undefined;

    response.data.pipe(out);
    // If the caller destroys the response stream to cancel mid-file (see
    // onStreamStart above), also close the write stream rather than
    // leaving its file handle dangling — .pipe() doesn't do that on its
    // own when the *source* errors/closes.
    response.data.on('error', (err: Error) => {
      if (progressTimer) clearInterval(progressTimer);
      out.destroy();
      reject(err);
    });
    out.on('error', (err) => {
      if (progressTimer) clearInterval(progressTimer);
      reject(err);
    });
    out.on('finish', () => {
      if (progressTimer) clearInterval(progressTimer);
      if (totalBytes && receivedBytes < totalBytes) {
        reject(new Error(`Connection closed early: got ${receivedBytes} of ${totalBytes} bytes.`));
        return;
      }
      // One last update at the true final byte count, so the UI doesn't
      // sit at whatever the last 1s timer tick happened to show.
      emitProgress();
      resolve();
    });
  });

  return destPath;
}

/**
 * Same as downloadRecording, but pipes straight to an HTTP response
 * instead of a file — used by the /download API route to proxy the
 * recording to the browser without buffering it server-side. No resume
 * support here (that's a client-to-server concern for a live HTTP
 * response, not something this MVP implements).
 */
export async function streamRecordingToResponse(
  conn: DeviceConn,
  playbackURI: string
): Promise<{ stream: Readable; headers: Record<string, unknown> }> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<downloadRequest>
  <playbackURI>${escapeXml(playbackURI)}</playbackURI>
</downloadRequest>`;

  const client = digestClient(conn);
  const response = await client.request({
    method: 'POST',
    url: `${baseUrl(conn)}/ISAPI/ContentMgmt/download`,
    headers: { 'Content-Type': 'application/xml' },
    data: body,
    responseType: 'stream',
  });

  return { stream: response.data, headers: response.headers };
}

function resolveTotalBytes(headers: any, startByte: number): number | null {
  const contentRange = headers?.['content-range'];
  const rangeMatch = contentRange && /\/(\d+)$/.exec(contentRange);
  if (rangeMatch) return Number(rangeMatch[1]);

  const contentLength = Number(headers?.['content-length']) || null;
  if (!contentLength) return null;
  return startByte > 0 ? contentLength + startByte : contentLength;
}

export async function listDevices(conn: DeviceConn): Promise<{ source: string; channels: Channel[] }> {
  try {
    return await listInputProxyChannels(conn);
  } catch (proxyErr: any) {
    try {
      return await listVideoInputChannels(conn);
    } catch (videoErr: any) {
      throw new Error(
        `Neither endpoint worked — InputProxy/channels: ${proxyErr.message}; Video/inputs/channels: ${videoErr.message}`
      );
    }
  }
}

async function listInputProxyChannels(conn: DeviceConn): Promise<{ source: string; channels: Channel[] }> {
  const client = digestClient(conn);
  const [channelsRes, statusRes] = await Promise.all([
    client.request({ method: 'GET', url: `${baseUrl(conn)}/ISAPI/ContentMgmt/InputProxy/channels` }),
    client
      .request({ method: 'GET', url: `${baseUrl(conn)}/ISAPI/ContentMgmt/InputProxy/channels/status` })
      .catch(() => null),
  ]);

  const channels: any[] = xmlParser.parse(channelsRes.data)?.InputProxyChannelList?.InputProxyChannel || [];
  const statuses: any[] = statusRes
    ? xmlParser.parse(statusRes.data)?.InputProxyChannelStatusList?.InputProxyChannelStatus || []
    : [];
  const statusById = new Map(statuses.map((s) => [String(s.id), s]));

  return {
    source: 'ContentMgmt/InputProxy/channels',
    channels: channels.map((ch) => ({
      id: ch.id,
      name: ch.name,
      ip: ch.sourceInputPortDescriptor?.ipAddress ?? null,
      online: statusById.get(String(ch.id))?.online ?? null,
    })),
  };
}

async function listVideoInputChannels(conn: DeviceConn): Promise<{ source: string; channels: Channel[] }> {
  const client = digestClient(conn);
  const res = await client.request({ method: 'GET', url: `${baseUrl(conn)}/ISAPI/System/Video/inputs/channels` });
  const channels: any[] = xmlParser.parse(res.data)?.VideoInputChannelList?.VideoInputChannel || [];

  return {
    source: 'System/Video/inputs/channels',
    channels: channels.map((ch) => ({ id: ch.id, name: ch.name, ip: null, online: null })),
  };
}

export async function captureSnapshot(conn: DeviceConn, trackID: number): Promise<Buffer> {
  const client = digestClient(conn);
  const response = await client.request({
    method: 'GET',
    url: `${baseUrl(conn)}/ISAPI/Streaming/channels/${trackID}/picture`,
    responseType: 'arraybuffer',
  });
  return Buffer.from(response.data);
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function escapeXml(str: string): string {
  return String(str).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' } as Record<string, string>)[c]);
}
