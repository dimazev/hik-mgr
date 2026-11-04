/**
 * Names shown to the user (and given to the downloaded file) for a recording or one part of it:
 *   <camera label>_<MM-DD>_<HH-mm>_<HH-mm>   e.g. Front-door_08-13_13-00_13-12
 * No year.
 *
 * Times are the CAMERA'S OWN CLOCK, exactly as written. A Hikvision device writes its local time with a trailing "Z"
 * ("2026-11-03T15:00:05Z"), and reads the times it is sent the same way - the "Z" does not mean UTC, so no time-zone
 * conversion is ever done here. Converting made a search for 15:00 return the 13:00 recordings.
 */

/** The clock time written in a timestamp, as milliseconds in a timezone-free (UTC) frame. The zone suffix is ignored. */
function wallClockMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
}

const two = (n: number) => String(n).padStart(2, '0');
const mmdd = (ms: number, sep: string) => `${two(new Date(ms).getUTCMonth() + 1)}${sep}${two(new Date(ms).getUTCDate())}`;
const hhmm = (ms: number, sep: string) => `${two(new Date(ms).getUTCHours())}${sep}${two(new Date(ms).getUTCMinutes())}`;

/** Camera label made safe for a file name (keeps any language, drops characters file systems refuse). */
export function safeLabel(label: string | null | undefined): string {
  const cleaned = (label ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '');
  return cleaned || 'camera';
}

/** [startMs, endMs] of one part of a recording, or null when the recording has no usable start. */
export function partRange(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  partSeconds: number[] | null | undefined,
  parts: number,
  part: number
): { startMs: number; endMs: number | null } | null {
  const start = wallClockMs(startTime);
  if (start === null) return null;
  const end = wallClockMs(endTime);
  if (parts <= 1) return { startMs: start, endMs: end };
  // each part's real length when it was measured; otherwise the recording cut into equal parts
  const lengths =
    partSeconds && partSeconds.length === parts
      ? partSeconds.map((s) => s * 1000)
      : end !== null
        ? Array.from({ length: parts }, () => (end - start) / parts)
        : null;
  if (!lengths) return { startMs: start, endMs: null };
  const before = lengths.slice(0, part - 1).reduce((a, b) => a + b, 0);
  const from = start + before;
  return { startMs: Math.round(from), endMs: Math.round(from + lengths[part - 1]) };
}

/** Short "13:00–13:12" (with the day when the part crosses midnight) for buttons and tables. */
export function partTimeText(range: { startMs: number; endMs: number | null }): string {
  const from = hhmm(range.startMs, ':');
  if (range.endMs === null) return from;
  const crossesDay = mmdd(range.startMs, '-') !== mmdd(range.endMs, '-');
  return `${from}–${crossesDay ? `${mmdd(range.endMs, '/')} ` : ''}${hhmm(range.endMs, ':')}`;
}

/** Month/day and time text for tables: "08/13 13:00" - no year. */
export function dayTimeText(iso: string | null | undefined): string {
  const ms = wallClockMs(iso);
  return ms === null ? (iso ?? '—') : `${mmdd(ms, '/')} ${hhmm(ms, ':')}`;
}

/** The name of a recording (or of one part of it): camera label, day, start time, end time. Without the .mp4. */
export function recordingName(opts: {
  label: string | null | undefined;
  startTime: string | null | undefined;
  endTime: string | null | undefined;
  partSeconds?: number[] | null;
  parts?: number;
  part?: number;
}): string {
  const label = safeLabel(opts.label);
  const range = partRange(opts.startTime, opts.endTime, opts.partSeconds, opts.parts ?? 1, opts.part ?? 1);
  if (!range) return opts.parts && opts.parts > 1 ? `${label}_part${opts.part ?? 1}` : label;
  const day = mmdd(range.startMs, '-');
  if (range.endMs === null) return `${label}_${day}_${hhmm(range.startMs, '-')}`;
  const endDay = mmdd(range.endMs, '-');
  return day === endDay
    ? `${label}_${day}_${hhmm(range.startMs, '-')}_${hhmm(range.endMs, '-')}`
    : `${label}_${day}_${hhmm(range.startMs, '-')}_${endDay}_${hhmm(range.endMs, '-')}`;
}

/** "20261031T221437Z" (the form in a playbackURI) as an ISO UTC timestamp. */
function compactToIso(compact: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/i.exec(compact);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

/** The file name the camera gave the recording (the `name=` of its playbackURI), or null. */
export function deviceFileName(playbackURI: string | null | undefined): string | null {
  const raw = /[?&]name=([^&]+)/i.exec(playbackURI ?? '')?.[1];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Timestamps written inside a camera file name, in order: "ch01_20261103143400_20261103150500" -> 14:34:00, 15:05:00.
 * Only the full YYYYMMDDhhmmss form is read (optionally with a T, _ or - between date and time).
 */
function namedTimes(name: string | null): string[] {
  if (!name) return [];
  const out: string[] = [];
  for (const m of name.matchAll(/(20\d{2})(\d{2})(\d{2})[T_-]?(\d{2})(\d{2})(\d{2})/g)) {
    const [, y, mo, d, h, mi, s] = m;
    if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31 || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) continue;
    out.push(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  }
  return out;
}

/**
 * The real start and end of a recording file. The camera's search result clips a recording to the window that was searched
 * (asked 15:00 -> the file that began at 14:34 is reported as beginning at 15:00), so the sources, best first:
 *  1. a start time written in the camera's own file name (`name=` in the playbackURI), when it is not later than the
 *     start in the address (a clipped start can only be later than the truth, so a later one means it is not a time);
 *  2. the `starttime=` / `endtime=` of the playbackURI
 *     (".../tracks/101?starttime=20261031T221437Z&endtime=20261031T224544Z&name=...");
 *  3. the search result's own timeSpan.
 * Always ISO.
 */
export function fileTimes(
  playbackURI: string | null | undefined,
  searchStart: string | null | undefined,
  searchEnd: string | null | undefined
): { startTime: string | null; endTime: string | null } {
  const start = /[?&]starttime=([0-9TZ]+)/i.exec(playbackURI ?? '')?.[1];
  const end = /[?&]endtime=([0-9TZ]+)/i.exec(playbackURI ?? '')?.[1];
  let startTime = (start && compactToIso(start)) || searchStart || null;
  const endTime = (end && compactToIso(end)) || searchEnd || null;
  const named = namedTimes(deviceFileName(playbackURI))[0];
  if (named && (!startTime || Date.parse(named) <= Date.parse(startTime))) startTime = named;
  return { startTime, endTime };
}

/** `startTime` plus `seconds`, as an ISO UTC timestamp. */
export function addSeconds(startTime: string, seconds: number): string | null {
  const t = Date.parse(startTime);
  return Number.isNaN(t) ? null : new Date(t + Math.round(seconds * 1000)).toISOString().replace(/\.\d{3}Z$/, 'Z');
}


/** "Nov 3, 15:00" - a camera timestamp for people, month and day without a year, never shifted by a time zone. */
export function formatWallClock(iso: string | null | undefined, locale: string, withTime = true): string {
  const ms = wallClockMs(iso);
  if (ms === null) return iso ?? '—';
  return new Date(ms).toLocaleString(locale, {
    timeZone: 'UTC', // the value is already the camera's clock; UTC here only stops the browser shifting it
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}
