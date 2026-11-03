/**
 * Names shown to the user (and given to the downloaded file) for a recording or one part of it:
 *   <camera label>_<MM-DD>_<HH-mm>_<HH-mm>   e.g. Front-door_08-13_13-00_13-12
 * No year. The times are the device's own wall-clock times, used exactly as written - no timezone conversion.
 */

/** The wall-clock time written in a device timestamp, as milliseconds in a timezone-free (UTC) frame. */
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
