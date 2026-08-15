import { useState } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import type { SxProps, Theme } from '@mui/material/styles';
import { api } from '../api/client';
import { useLocale } from '../i18n/LocaleContext';
import { SnapshotImage } from '../components/SnapshotImage';

const STREAM_BOX_SX: SxProps<Theme> = {
  width: '100%',
  maxWidth: 1100,
  aspectRatio: '16 / 9',
  borderRadius: 1,
};

/**
 * The actual live view — a continuous MJPEG feed from the device
 * (`GET /api/devices/:id/stream`, see api/devices.ts), which every
 * mainstream browser decodes natively when it's an <img>'s src: no
 * WebRTC/HLS setup and no polling loop needed, unlike the once-a-second
 * snapshot refresh used elsewhere in the app (see SnapshotImage).
 *
 * Not every Hikvision device/firmware exposes the ISAPI httpPreview
 * endpoint this relies on, so a failed/broken stream falls back to that
 * same once-a-second snapshot polling instead of just showing a dead page
 * — degraded (a photo refreshing every second) beats broken.
 */
function LiveView({
  deviceId,
  track,
  snapshotTrack,
  alt,
}: {
  deviceId: number;
  track: number;
  /** Main-stream track, used only for the snapshot fallback below — snapshots aren't codec-restricted like the live feed is, and the main stream gives a sharper fallback photo than the sub-stream would. */
  snapshotTrack: number;
  alt: string;
}) {
  const { t } = useLocale();
  const [status, setStatus] = useState<'loading' | 'playing' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [useSnapshotFallback, setUseSnapshotFallback] = useState(false);

  if (useSnapshotFallback) {
    return (
      <Stack spacing={1} sx={STREAM_BOX_SX}>
        <Alert severity="warning">{t('cameraView.streamUnavailable')}</Alert>
        <SnapshotImage deviceId={deviceId} track={snapshotTrack} alt={alt} live showRefresh={false} sx={{ ...STREAM_BOX_SX, maxWidth: 'none', flex: 1 }} />
      </Stack>
    );
  }

  return (
    <Box sx={{ position: 'relative', overflow: 'hidden', bgcolor: 'grey.900', ...STREAM_BOX_SX }}>
      {/* `key={attempt}` forces a fresh <img> element (and so a fresh HTTP
          request) on retry — just changing `src` isn't reliably enough to
          get a browser to reopen a multipart stream it already gave up on. */}
      <Box
        key={attempt}
        component="img"
        src={api.streamUrl(deviceId, track)}
        alt={alt}
        onLoad={() => setStatus('playing')}
        onError={() => setStatus('error')}
        sx={{ width: '100%', height: '100%', objectFit: 'contain', display: status === 'error' ? 'none' : 'block' }}
      />
      {status !== 'playing' && (
        <Box
          sx={{
            position: status === 'error' ? 'static' : 'absolute',
            inset: 0,
            height: status === 'error' ? '100%' : undefined,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1.5,
          }}
        >
          {status === 'loading' && <CircularProgress size={28} sx={{ color: 'common.white' }} />}
          {status === 'error' && (
            <>
              <Typography variant="body2" sx={{ color: 'common.white', textAlign: 'center', px: 3, maxWidth: 480 }}>
                {t('cameraView.streamError')}
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  sx={{ color: 'common.white', borderColor: 'grey.500' }}
                  onClick={() => {
                    setStatus('loading');
                    setAttempt((n) => n + 1);
                  }}
                >
                  {t('cameraView.retry')}
                </Button>
                <Button size="small" variant="outlined" sx={{ color: 'common.white', borderColor: 'grey.500' }} onClick={() => setUseSnapshotFallback(true)}>
                  {t('cameraView.useSnapshots')}
                </Button>
              </Stack>
            </>
          )}
        </Box>
      )}
      {status === 'playing' && (
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
    </Box>
  );
}

/**
 * Dedicated full-page view for one camera, reached by tapping its snapshot
 * on the Channels tab (grid or list view) — a real route (not a modal) so
 * it's back-button/bookmarkable, matching the pattern RecordingFilesPage
 * already established for "drill into one thing" views.
 *
 * Channel data (label, name, ip, online status) comes from the same
 * `['channels', deviceId]` query the Channels tab already populates, so
 * navigating here from that tab renders instantly from cache instead of
 * waiting on a second round trip just to find this one channel again.
 */
export default function CameraViewPage() {
  const { t } = useLocale();
  const { id, channelId } = useParams();
  const deviceId = Number(id);
  // Hikvision's httpPreview (the MJPEG-over-HTTP endpoint this live view
  // relies on — see LiveView/api.streamUrl) only ever works over the
  // SUB-stream, and only if that sub-stream's codec is configured as
  // MJPEG on the device — H.264/H.265 (the near-universal default) gets
  // rejected outright, commonly as a 403. `*100 + 2` is Hikvision's
  // sub-stream track-id convention; `*100 + 1` (the main stream) is used
  // for the snapshot fallback instead, which isn't codec-restricted the
  // same way and gives a sharper fallback photo.
  const liveTrack = Number(channelId) * 100 + 2;
  const mainTrack = Number(channelId) * 100 + 1;

  const q = useQuery({ queryKey: ['channels', deviceId], queryFn: () => api.channels(deviceId) });
  const channel = q.data?.channels.find((c) => Number(c.id) === Number(channelId));
  const displayName = channel ? channel.label || channel.name : `#${channelId}`;

  return (
    <Stack spacing={2}>
      <Box>
        <Link
          component={RouterLink}
          to={`/devices/${deviceId}`}
          underline="hover"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
        >
          <ArrowBackIcon fontSize="inherit" />
          {t('cameraView.backToDevice')}
        </Link>
      </Box>

      {q.isLoading && <CircularProgress size={24} />}
      {q.isError && <Alert severity="error">{(q.error as Error).message}</Alert>}

      {q.isSuccess && !channel && <Alert severity="warning">{t('cameraView.notFound')}</Alert>}

      {channel && (
        <>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="h5">{displayName}</Typography>
            {channel.online !== null && channel.online !== undefined && (
              <Chip
                size="small"
                label={channel.online ? t('channel.online') : t('channel.offline')}
                color={channel.online ? 'success' : 'default'}
              />
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t('channel.meta', { id: channel.id, name: channel.name })}
            {channel.ip ? ` · ${channel.ip}` : ''}
          </Typography>

          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <LiveView deviceId={deviceId} track={liveTrack} snapshotTrack={mainTrack} alt={`Live view of ${displayName}`} />
          </Box>
        </>
      )}
    </Stack>
  );
}
