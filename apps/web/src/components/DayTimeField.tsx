import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useLocale } from '../i18n/LocaleContext';

const two = (n: number) => String(n).padStart(2, '0');
const DAY_MS = 24 * 3600 * 1000;

/** The recordings are in the past: a date is the current year, or last year when that would still be in the future. */
function resolveYear(month: number, day: number): number {
  const now = new Date();
  const year = now.getFullYear();
  return new Date(year, month - 1, day, 12).getTime() > now.getTime() + DAY_MS ? year - 1 : year;
}

function validDate(month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(2000, month, 0).getDate();
}

/**
 * Day and month typed fast, no year: "3/11", "03.11", "0311", "311". Digits only without a separator are split the
 * way that makes a real date. Just a day ("5") means the most recent 5th, this month or last.
 */
export function parseDate(text: string): { month: number; day: number } | null {
  const t = text.trim();
  if (!t) return null;
  const sep = /^(\d{1,2})\D+(\d{1,2})$/.exec(t);
  if (sep) {
    const day = Number(sep[1]);
    const month = Number(sep[2]);
    return validDate(month, day) ? { month, day } : null;
  }
  if (!/^\d{1,4}$/.test(t)) return null;
  if (t.length <= 2) {
    const day = Number(t);
    const now = new Date();
    for (let back = 0; back < 3; back++) {
      const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const month = d.getMonth() + 1;
      if (validDate(month, day) && new Date(d.getFullYear(), month - 1, day, 12).getTime() <= now.getTime() + DAY_MS) return { month, day };
    }
    return null;
  }
  const splits = t.length === 4 ? [2] : [1, 2];
  for (const at of splits) {
    const day = Number(t.slice(0, at));
    const month = Number(t.slice(at));
    if (validDate(month, day)) return { month, day };
  }
  return null;
}

/** "1500", "15:00", "915", "9", "15.30" -> "HH:mm". */
export function parseTime(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const sep = /^(\d{1,2})\D+(\d{1,2})$/.exec(t);
  let h: number;
  let m: number;
  if (sep) {
    h = Number(sep[1]);
    m = Number(sep[2]);
  } else if (/^\d{1,4}$/.test(t)) {
    if (t.length <= 2) {
      h = Number(t);
      m = 0;
    } else {
      h = Number(t.slice(0, t.length - 2));
      m = Number(t.slice(-2));
    }
  } else {
    return null;
  }
  return h < 24 && m < 60 ? `${two(h)}:${two(m)}` : null;
}

const formatDate = (d: { month: number; day: number }) => `${two(d.day)}/${two(d.month)}`;

function parseValue(value: string): { date: string; time: string } | null {
  const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(value);
  return m ? { date: formatDate({ month: Number(m[1]), day: Number(m[2]) }), time: m[3] } : null;
}

/**
 * A date (day + month, no year) and a time, both typed with the keyboard: "3/11" or "0311", "1500". Tab moves between
 * them, Arrow up/down steps the day (or the time: 15 min, Shift = 1 min), Enter searches. "Today" / "Yesterday" are one
 * click. Reads and writes the same "YYYY-MM-DDTHH:mm" text a datetime-local input does (empty until both are valid).
 */
export function DayTimeField({ label, value, onChange, onEnter }: { label: string; value: string; onChange: (value: string) => void; onEnter?: () => void }) {
  const { t, locale } = useLocale();
  const [dateText, setDateText] = useState('');
  const [timeText, setTimeText] = useState('');
  const lastEmitted = useRef('');

  // follow the value when the page sets it from outside (the end field copies the start)
  useEffect(() => {
    if (value === lastEmitted.current) return;
    const parts = parseValue(value);
    if (!parts) return;
    setDateText(parts.date);
    setTimeText(parts.time);
  }, [value]);

  const emit = (dText: string, tText: string) => {
    const d = parseDate(dText);
    const tm = parseTime(tText);
    const next = d && tm ? `${resolveYear(d.month, d.day)}-${two(d.month)}-${two(d.day)}T${tm}` : '';
    lastEmitted.current = next;
    onChange(next);
  };

  const date = parseDate(dateText);
  const time = parseTime(timeText);
  const weekday = date ? new Date(resolveYear(date.month, date.day), date.month - 1, date.day).toLocaleDateString(locale, { weekday: 'long' }) : undefined;

  const setDay = (d: Date) => {
    const text = formatDate({ month: d.getMonth() + 1, day: d.getDate() });
    setDateText(text);
    emit(text, timeText);
  };

  const stepDate = (e: KeyboardEvent, delta: number) => {
    e.preventDefault();
    const base = date ? new Date(resolveYear(date.month, date.day), date.month - 1, date.day) : new Date();
    const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta);
    if (next.getTime() > Date.now() + DAY_MS) return; // nothing is recorded in the future
    setDay(next);
  };

  const stepTime = (e: KeyboardEvent, minutes: number) => {
    e.preventDefault();
    const [h, m] = (time ?? '00:00').split(':').map(Number);
    const total = (h * 60 + m + minutes + 24 * 60) % (24 * 60);
    const text = `${two(Math.floor(total / 60))}:${two(total % 60)}`;
    setTimeText(text);
    emit(dateText, text);
  };

  return (
    <Stack spacing={0.5}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TextField
          size="small"
          value={dateText}
          placeholder="DD/MM"
          error={dateText.trim() !== '' && !date}
          helperText={weekday ?? ' '}
          onChange={(e) => {
            setDateText(e.target.value);
            emit(e.target.value, timeText);
          }}
          onBlur={() => date && setDateText(formatDate(date))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') stepDate(e, 1);
            else if (e.key === 'ArrowDown') stepDate(e, -1);
            else if (e.key === 'Enter') onEnter?.();
          }}
          sx={{ width: 110 }}
          slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': label } }}
        />
        <TextField
          size="small"
          value={timeText}
          placeholder="HH:MM"
          error={timeText.trim() !== '' && !time}
          helperText=" "
          onChange={(e) => {
            setTimeText(e.target.value);
            emit(dateText, e.target.value);
          }}
          onBlur={() => time && setTimeText(time)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') stepTime(e, e.shiftKey ? 1 : 15);
            else if (e.key === 'ArrowDown') stepTime(e, e.shiftKey ? -1 : -15);
            else if (e.key === 'Enter') onEnter?.();
          }}
          sx={{ width: 92 }}
          slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': `${label} ${t('recordings.timeSuffix')}` } }}
        />
        <Stack direction="row" spacing={0.5} sx={{ pt: 0.5 }}>
          <Button size="small" onClick={() => setDay(new Date())}>
            {t('recordings.today')}
          </Button>
          <Button size="small" onClick={() => setDay(new Date(Date.now() - DAY_MS))}>
            {t('recordings.yesterday')}
          </Button>
        </Stack>
      </Stack>
    </Stack>
  );
}
