import { useParams, useSearchParams, Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import { api } from '../api/client';

function sanitizeForFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'channel';
}

/**
 * The device only gives us a playbackURI, not a human file name — this
 * synthesizes one from the channel name + recording start time so the
 * list (and the downloaded file itself, via ?filename= on the download
 * link) reads like "front-door_2026-08-13T13-00-05.mp4" instead of an
 * opaque URI.
 */
function friendlyFileName(channelName: string | null | undefined, startTime: string | undefined, index: number): string {
  const start = startTime ? startTime.replace(/:/g, '-') : `file-${index}`;
  return `${sanitizeForFilename(channelName || 'channel')}_${start}.mp4`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * A dedicated page (not a tab) for the actual file list produced by a
 * RecordingsTab search — reached via a real route with the range in the
 * query string, so it's a normal back/forward/bookmarkable browser page
 * rather than transient in-tab state.
 */
export default function RecordingFilesPage() {
  const { id } = useParams();
  const deviceId = Number(id);
  const [searchParams] = useSearchParams();
  const start = searchParams.get('start') ?? undefined;
  const end = searchParams.get('end') ?? undefined;
  // Carries over the channel selection made on the Recordings tab, so this
  // page only lists (and only makes downloadable) files from the channels
  // the user actually picked, not every channel on the device.
  const channelsParam = searchParams.get('channels') ?? undefined;
  const channels = channelsParam
    ? channelsParam
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n))
    : undefined;

  const q = useQuery({
    queryKey: ['recordings-files', deviceId, start, end, channelsParam],
    queryFn: () => api.files(deviceId, { start, end, channels }),
    enabled: Number.isFinite(deviceId) && !!start && !!end,
  });

  const files = q.data?.files ?? [];

  return (
    <Stack spacing={2}>
      <Box>
        <Link component={RouterLink} to={`/devices/${deviceId}`} underline="hover">
          ← Back to device
        </Link>
      </Box>
      <Typography variant="h5">Recording files</Typography>

      {start && end ? (
        <Typography variant="body2" color="text.secondary">
          {formatDateTime(start)} – {formatDateTime(end)}
        </Typography>
      ) : (
        <Alert severity="warning">Missing start/end time — go back to the Recordings tab and search again.</Alert>
      )}

      {q.isLoading && (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            Loading files…
          </Typography>
        </Stack>
      )}

      {q.isError && <Alert severity="error">{(q.error as Error).message}</Alert>}

      {q.isSuccess && (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Channel</TableCell>
                <TableCell>File name</TableCell>
                <TableCell>Start</TableCell>
                <TableCell>End</TableCell>
                <TableCell>Size</TableCell>
                <TableCell align="right">Download</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {files.map((f, i) => {
                const filename = friendlyFileName(f.deviceChannelName, f.startTime, i);
                return (
                  <TableRow key={`${f.playbackURI}-${i}`}>
                    <TableCell>{f.deviceChannelName ?? '—'}</TableCell>
                    <TableCell>{filename}</TableCell>
                    <TableCell>{f.startTime ?? '—'}</TableCell>
                    <TableCell>{f.endTime ?? '—'}</TableCell>
                    <TableCell>{f.sizeBytes ?? '—'}</TableCell>
                    <TableCell align="right">
                      <Link href={api.downloadUrl(deviceId, f.playbackURI, filename)} target="_blank" rel="noreferrer">
                        Download
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
              {files.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography color="text.secondary">No recordings found in range.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );
}
