import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useLocale } from '../i18n/LocaleContext';

const two = (n: number) => String(n).padStart(2, '0');

/**
 * The year is never asked for: recordings are in the past, so it is the current year, or last year when that date
 * would still be in the future (e.g. picking December in January).
 */
function withYear(month: number, day: number, time: string): string {
  const now = new Date();
  const [h, m] = time.split(':').map(Number);
  let year = now.getFullYear();
  if (new Date(year, month - 1, day, h, m).getTime() > now.getTime() + 24 * 3600 * 1000) year -= 1;
  return `${year}-${two(month)}-${two(day)}T${two(h)}:${two(m)}`;
}

function parse(value: string): { month: string; day: string; time: string } | null {
  const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(value);
  return m ? { month: String(Number(m[1])), day: String(Number(m[2])), time: m[3] } : null;
}

/**
 * Month + day + time, without a year. Reads and writes the same "YYYY-MM-DDTHH:mm" text a datetime-local input does
 * (empty until all three are chosen), so the rest of the page does not change.
 */
export function DayTimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { locale } = useLocale();
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');

  // follow the value when the page sets it from outside (the end field copies the start)
  useEffect(() => {
    const parts = parse(value);
    if (!parts) return;
    setMonth(parts.month);
    setDay(parts.day);
    setTime(parts.time);
  }, [value]);

  const update = (next: { month?: string; day?: string; time?: string }) => {
    const mo = next.month ?? month;
    let d = next.day ?? day;
    const t = next.time ?? time;
    // no 31st of February: keep the day inside the month
    if (mo && d) {
      const last = new Date(2000, Number(mo), 0).getDate();
      if (Number(d) > last) d = String(last);
    }
    setMonth(mo);
    setDay(d);
    setTime(t);
    onChange(mo && d && t ? withYear(Number(mo), Number(d), t) : '');
  };

  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Stack direction="row" spacing={1}>
        <TextField select size="small" value={month} onChange={(e) => update({ month: e.target.value })} sx={{ minWidth: 100 }} slotProps={{ select: { displayEmpty: true } }}>
          <MenuItem value="" disabled>
            {locale === 'he' ? 'חודש' : 'Month'}
          </MenuItem>
          {Array.from({ length: 12 }, (_, i) => (
            <MenuItem key={i + 1} value={String(i + 1)}>
              {new Date(2000, i, 1).toLocaleString(locale, { month: 'long' })}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" value={day} onChange={(e) => update({ day: e.target.value })} sx={{ minWidth: 76 }} slotProps={{ select: { displayEmpty: true } }}>
          <MenuItem value="" disabled>
            {locale === 'he' ? 'יום' : 'Day'}
          </MenuItem>
          {Array.from({ length: 31 }, (_, i) => (
            <MenuItem key={i + 1} value={String(i + 1)}>
              {i + 1}
            </MenuItem>
          ))}
        </TextField>
        <TextField type="time" size="small" value={time} onChange={(e) => update({ time: e.target.value })} />
      </Stack>
    </Box>
  );
}
