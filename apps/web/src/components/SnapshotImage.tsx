import { useState, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import type { SxProps, Theme } from '@mui/material/styles';
import RefreshIcon from '@mui/icons-material/Refresh';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { api } from '../api/client';
import { useLocale } from '../i18n/LocaleContext';

const SNAPSHOT_MAX_ATTEMPTS = 3;
const SNAPSHOT_RETRY_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches a channel's snapshot as a blob (rather than pointing an <img> at
 * the URL directly) so a failed fetch can be told apart from a successful
 * one: `url` is only ever updated on success, so if a refresh fails (device
 * offline, timeout, etc.) the last successfully loaded snapshot stays on
 * screen instead of the browser swapping in a broken-image icon — `error`
 * is set alongside it so callers can show that the image is stale.
 *
 * A single request failure (e.g. a transient 500 while the device is busy)
 * is retried up to SNAPSHOT_MAX_ATTEMPTS times before giving up and
 * surfacing `error`.
 *
 * `live` opts this one snapshot into a 1s auto-refresh loop (see the effect
 * below) — used by the dedicated camera view page, which is the only place
 * that should be hammering the device with a snapshot request every
 * second. Everywhere else (the Channels tab's thumbnails) passes
 * `live={false}` and loads its snapshot only once (or on manual refresh).
 */
function useSnapshot(deviceId: number, track: number, live: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const currentUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      let lastError: unknown = null;

      for (let attemptNum = 1; attemptNum <= SNAPSHOT_MAX_ATTEMPTS; attemptNum++) {
        if (cancelled) return;
        try {
          const res = await fetch(api.snapshotUrl(deviceId, track));
          if (!res.ok) throw new Error(`Snapshot request failed (${res.status})`);
          const blob = await res.blob();
          if (cancelled) return;
          const next = URL.createObjectURL(blob);
          if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current);
          currentUrlRef.current = next;
          setUrl(next);
          setError(null);
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          if (attemptNum < SNAPSHOT_MAX_ATTEMPTS) {
            await delay(SNAPSHOT_RETRY_DELAY_MS);
          }
        }
      }

      if (cancelled) return;
      if (lastError) {
        // Deliberately not touching `url` here — keep whatever loaded last.
        setError(lastError instanceof Error ? lastError.message : 'Failed to load snapshot');
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, track, attempt]);

  // Revoke the last object URL on unmount so it doesn't leak.
  useEffect(() => {
    return () => {
      if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current);
    };
  }, []);

  // While live, re-trigger the fetch effect above once a second by bumping
  // `attempt` — same request/retry/object-URL-swap path as a manual
  // refresh, just on a timer. Stops immediately when `live` goes false.
  useEffect(() => {
    if (!live) return;
    const interval = setInterval(() => setAttempt((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [live]);

  return { url, error, loading, refresh: () => setAttempt((n) => n + 1) };
}

export function SnapshotImage({
  deviceId,
  track,
  alt,
  sx,
  showRefresh = true,
  live = false,
  onClick,
}: {
  deviceId: number;
  track: number;
  alt: string;
  sx?: SxProps<Theme>;
  showRefresh?: boolean;
  /** True to auto-refresh this snapshot every second (and show the LIVE badge) — see useSnapshot. */
  live?: boolean;
  /** Omit to make this snapshot unclickable. */
  onClick?: () => void;
}) {
  const { url, error, loading, refresh } = useSnapshot(deviceId, track, live);
  const { t } = useLocale();

  const clickable = !!onClick;

  return (
    <Tooltip title={clickable ? t('snapshot.openAria') : ''} disableHoverListener={!clickable}>
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          bgcolor: 'grey.200',
          cursor: clickable ? 'pointer' : undefined,
          outline: live ? '2px solid' : 'none',
          outlineColor: 'error.main',
          outlineOffset: '-2px',
          ...sx,
        }}
        onClick={onClick}
      >
        {url ? (
          <Box component="img" src={url} alt={alt} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {loading ? (
              <CircularProgress size={18} />
            ) : (
              <Typography variant="caption" color="text.secondary">
                {t('snapshot.noSnapshot')}
              </Typography>
            )}
          </Box>
        )}
        {error && (
          <Tooltip title={t('snapshot.errorTooltip', { error })}>
            <WarningAmberIcon
              fontSize="small"
              color="warning"
              sx={{ position: 'absolute', top: 4, left: 4, bgcolor: 'background.paper', borderRadius: '50%', p: 0.25 }}
            />
          </Tooltip>
        )}
        {live && (
          <Chip
            size="small"
            color="error"
            label={t('snapshot.live')}
            sx={{
              position: 'absolute',
              bottom: 4,
              left: 4,
              height: 18,
              '& .MuiChip-label': { px: 0.75, fontSize: 10, fontWeight: 600 },
            }}
          />
        )}
        {showRefresh && (
          <IconButton
            aria-label={t('snapshot.refreshAria')}
            size="small"
            onClick={(e) => {
              // Manual refresh shouldn't also trigger the box's own onClick
              // (e.g. navigating to the camera view page) — it sits inside
              // that same clickable box.
              e.stopPropagation();
              refresh();
            }}
            disabled={loading}
            sx={{
              position: 'absolute',
              top: 4,
              right: 4,
              bgcolor: 'background.paper',
              '&:hover': { bgcolor: 'background.paper' },
            }}
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
        )}
      </Box>
    </Tooltip>
  );
}
