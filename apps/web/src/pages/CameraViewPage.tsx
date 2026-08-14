import { useParams, Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { api } from '../api/client';
import { useLocale } from '../i18n/LocaleContext';
import { SnapshotImage } from '../components/SnapshotImage';

/**
 * Dedicated full-page view for one camera, reached by tapping its snapshot
 * on the Channels tab (grid or list view) — a real route (not a modal) so
 * it's back-button/bookmarkable, matching the pattern RecordingFilesPage
 * already established for "drill into one thing" views.
 *
 * Unlike the small thumbnails on the Channels tab (which load their
 * snapshot once, on purpose — see SnapshotImage), this page is the one
 * place that always polls for a fresh screenshot every second: it's the
 * only camera being watched here, so there's no "N cameras all polling at
 * once" cost to worry about.
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
  const track = Number(channelId) * 100 + 1;

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
            <SnapshotImage
              deviceId={deviceId}
              track={track}
              alt={`Snapshot of ${displayName}`}
              live
              showRefresh={false}
              sx={{
                width: '100%',
                maxWidth: 1100,
                aspectRatio: '16 / 9',
                borderRadius: 1,
              }}
            />
          </Box>
        </>
      )}
    </Stack>
  );
}
