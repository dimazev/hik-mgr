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

/**
 * Opens a live MJPEG stream from the device — `multipart/x-mixed-replace`
 * over plain HTTP, a JPEG-per-frame format every mainstream browser
 * natively decodes when it's the `src` of a plain `<img>` tag (no
 * WebRTC/HLS/ffmpeg transcoding needed on our side, unlike an RTSP feed).
 * Same digest-auth-then-stream-the-response shape as
 * streamRecordingToResponse above; the caller is responsible for piping
 * `stream` to the HTTP response and for destroying it when the client
 * disconnects (see GET /:id/stream in api/devices.ts) — an MJPEG stream
 * never ends on its own, so nothing here closes it for you.
 */
/**
 * Reads a small Node Readable stream fully into a string, capped so a huge
 * or never-ending body can't hang a log line or blow up memory. Only meant
 * for small error-response bodies (a few hundred bytes of XML/JSON), never
 * for actual frame data.
 */
function drainStreamToString(stream: Readable, maxBytes = 2000): Promise<string> {
  return new Promise((resolve) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    const finish = () => resolve(Buffer.concat(chunks).toString('utf8'));
    stream.on('data', (chunk: Buffer) => {
      if (bytes >= maxBytes) return;
      chunks.push(chunk);
      bytes += chunk.length;
      if (bytes >= maxBytes) stream.destroy();
    });
    stream.on('end', finish);
    stream.on('close', finish);
    stream.on('error', finish);
  });
}

/**
 * Reads back the device's own config for this streaming channel — codec,
 * resolution, transport — before we even attempt httpPreview. Returns the
 * raw XML text too (not just the parsed fields) so the caller can patch and
 * PUT it back without having to reconstruct the device's full schema from
 * scratch. Best-effort: any failure here is swallowed and logged, never
 * allowed to block the real request.
 */
async function getChannelConfig(conn: DeviceConn, trackID: number): Promise<{ rawXml: string; codec: string | undefined } | null> {
  const url = `${baseUrl(conn)}/ISAPI/Streaming/channels/${trackID}`;
  try {
    const client = digestClient(conn);
    const res = await client.request({ method: 'GET', url });
    const rawXml = String(res.data);
    const cfg = xmlParser.parse(rawXml)?.StreamingChannel;
    if (!cfg) {
      console.log(`[stream] channel config for ${url}: response had no <StreamingChannel> — raw: ${rawXml.trim().slice(0, 500)}`);
      return null;
    }
    console.log(
      `[stream] channel ${trackID} config — enabled=${cfg.enabled}, transport=${cfg.Transport?.rtspPortNo ? 'rtsp+http' : 'unknown'}, ` +
        `videoCodecType=${cfg.Video?.videoCodecType}, resolution=${cfg.Video?.videoResolutionWidth}x${cfg.Video?.videoResolutionHeight}, ` +
        `frameRate=${cfg.Video?.maxFrameRate}`
    );
    return { rawXml, codec: cfg.Video?.videoCodecType };
  } catch (err: any) {
    const status = err?.response?.status;
    console.warn(`[stream] could not read channel config for ${url} (non-fatal, continuing anyway): ${err?.message}${status ? ` (status ${status})` : ''}`);
    return null;
  }
}

/**
 * httpPreview only ever serves MJPEG, and three rounds of asking the user to
 * flip that setting in the device's own UI haven't landed — the logged
 * channel config keeps coming back H.264 on every retry. Rather than send
 * them hunting through NVR menus for a setting that may not even be exposed
 * there for a proxied IP camera, do it ourselves: PUT the same config XML
 * straight back with just <videoCodecType> swapped to MJPEG. This is the
 * exact change the device's own "Video Encoding" dropdown makes, just done
 * over ISAPI instead of the web UI — same effect, one less place for a
 * multi-hop NVR menu to not be the menu that actually controls this.
 *
 * Only touches the requested trackID (the sub-stream), never the main
 * stream used for recording, and only when the codec isn't already MJPEG.
 * If the device rejects the PUT (e.g. this model genuinely doesn't support
 * MJPEG on this channel), that's logged and httpPreview is attempted anyway
 * so the resulting error is the device's real, final answer.
 */
async function ensureMjpegSubstream(conn: DeviceConn, trackID: number): Promise<void> {
  const cfg = await getChannelConfig(conn, trackID);
  if (!cfg) return;
  if (cfg.codec === 'MJPEG') {
    console.log(`[stream] channel ${trackID} is already MJPEG — no config change needed`);
    return;
  }
  console.log(`[stream] channel ${trackID} codec is "${cfg.codec}", not MJPEG — attempting to switch it via ISAPI so httpPreview can work`);
  if (!/<videoCodecType>[^<]*<\/videoCodecType>/.test(cfg.rawXml)) {
    console.warn(`[stream] channel ${trackID} config XML has no <videoCodecType> element to patch — leaving as-is`);
    return;
  }
  const patchedXml = cfg.rawXml.replace(/<videoCodecType>[^<]*<\/videoCodecType>/, '<videoCodecType>MJPEG</videoCodecType>');
  const url = `${baseUrl(conn)}/ISAPI/Streaming/channels/${trackID}`;
  try {
    const client = digestClient(conn);
    const res = await client.request({
      method: 'PUT',
      url,
      data: patchedXml,
      headers: { 'Content-Type': 'application/xml' },
    });
    console.log(`[stream] PUT ${url} to switch channel ${trackID} to MJPEG — device responded status=${res.status}`);
    // A 200 on the PUT only means the device accepted the request — some
    // Hikvision firmwares silently ignore fields they don't actually support
    // rather than rejecting them, so re-read the config to confirm the
    // codec actually changed before trusting it did.
    const verify = await getChannelConfig(conn, trackID);
    if (verify) {
      console.log(
        verify.codec === 'MJPEG'
          ? `[stream] verified: channel ${trackID} codec is now MJPEG`
          : `[stream] channel ${trackID} PUT returned 200 but codec is STILL "${verify.codec}" — the device silently ignored the change; this channel likely can't be switched to MJPEG at all`
      );
    }
  } catch (err: any) {
    const status = err?.response?.status;
    const rawBody = err?.response?.data;
    const body = rawBody && typeof rawBody.on === 'function' ? await drainStreamToString(rawBody) : rawBody;
    console.warn(
      `[stream] PUT ${url} to switch channel ${trackID} to MJPEG failed: ${err?.message}` +
        (status ? ` (device responded ${status}${body ? `: ${String(body).trim().slice(0, 500)}` : ''})` : '') +
        ' — this device/channel likely does not support MJPEG on this stream; continuing with httpPreview anyway to get its real error'
    );
  }
}

export async function streamMjpeg(conn: DeviceConn, trackID: number): Promise<{ stream: Readable; headers: Record<string, unknown> }> {
  const url = `${baseUrl(conn)}/ISAPI/Streaming/channels/${trackID}/httpPreview`;
  // Logged before the request, not just on failure — digest auth means
  // this is actually two HTTP round trips (an initial 401 challenge, then
  // the authenticated retry) before any frame data arrives, so "it's
  // taking a while" and "it never responded" look identical without a
  // timestamp on the outgoing request to compare against.
  // eslint-disable-next-line no-console
  console.log(`[stream] requesting MJPEG from device: ${url} (host=${conn.host}:${conn.port}, trackID=${trackID})`);
  await ensureMjpegSubstream(conn, trackID);
  const client = digestClient(conn);
  try {
    const response = await client.request({
      method: 'GET',
      url,
      responseType: 'stream',
    });
    // eslint-disable-next-line no-console
    console.log(
      `[stream] device responded for ${url}: status=${response.status}, content-type=${response.headers?.['content-type']}`
    );
    return { stream: response.data, headers: response.headers };
  } catch (err: any) {
    // Digest auth failures, connection refused/timeout, and "this
    // firmware doesn't have httpPreview" (404) all surface here. Because
    // the request used responseType: 'stream', a NON-2xx response body
    // (Hikvision returns a small XML doc describing exactly what went
    // wrong, e.g. <statusString>/<subStatusCode>) arrives as an unread
    // stream too, not a parsed string — logging `err.response.data`
    // directly just prints "[object Object]", which is why earlier
    // versions of this log line weren't actually showing the reason. Drain
    // it here so the device's own explanation ends up in the log instead
    // of a generic status code.
    const status = err?.response?.status;
    const rawBody = err?.response?.data;
    const body = rawBody && typeof rawBody.on === 'function' ? await drainStreamToString(rawBody) : rawBody;
    // eslint-disable-next-line no-console
    console.error(
      `[stream] request failed for ${url}: ${err?.message}` +
        (status ? ` (device responded ${status}${body ? `: ${String(body).trim().slice(0, 500)}` : ' with an empty body'})` : '') +
        // A 403 with subStatusCode "invalidOperation" is Hikvision's
        // generic "not allowed right now" — it does NOT specifically mean
        // "wrong codec" (that theory came first and turned out wrong for
        // at least one real device). Two known, unrelated causes produce
        // this exact error:
        //  1. The sub-stream's Video Encoding isn't set to MJPEG
        //     (Configuration > Video/Audio on the device) — httpPreview
        //     only ever serves MJPEG.
        //  2. "Stream Encryption" is turned on under Platform Access /
        //     Hik-Connect settings — a security feature that blocks direct
        //     ISAPI preview streaming like this entirely, independent of
        //     codec. Devices reachable through a DDNS/P2P-style hostname
        //     (kozow.com, hik-connect, etc.) commonly have this on by
        //     default. Disabling it (Configuration > Network > Platform
        //     Access > uncheck "Enable Stream Encryption") is the known
        //     fix when the codec is already MJPEG and it still 403s.
        (status === 403
          ? ` [subStatusCode invalidOperation, if not explained above: check (1) sub-stream Video Encoding = MJPEG under Configuration > Video/Audio, and (2) "Enable Stream Encryption" is OFF under Configuration > Network > Platform Access / Hik-Connect]`
          : '')
    );
    throw err;
  }
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function escapeXml(str: string): string {
  return String(str).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' } as Record<string, string>)[c]);
}
