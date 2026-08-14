import { useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link as RouterLink } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
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
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import type { DownloadTaskFileInput } from '@hik-mgr/shared';
import { api } from '../api/client';

function sanitizeForFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'channel';
}

/**
 * The device only gives us a playbackURI, not a human file name — this
 * synthesizes one from the channel name + recording start time so the
 * list (and the eventual downloaded file, via the task's stored filename)
 * reads like "front-door_2026-08-13T13-00-05.mp4" instead of an opaque URI.
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
 * RecordingsTab search — reached via a real route with the range (and
 * channel selection) in the query string, so it's a normal
 * back/forward/bookmarkable browser page rather than transient in-tab
 * state.
 *
 * There's deliberately no per-row download link anymore — a single
 * "Download" button at the bottom queues every listed file as one
 * background task (after a confirmation dialog), which the server then
 * works through file-by-file. Progress is tracked on the Tasks page
 * rather than as individual browser downloads.
 */
export default function RecordingFilesPage() {
  const { id } = useParams();
  const deviceId = Number(id);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const start = searchParams.get('start') ?? undefined;
  const end = searchParams.get('end') ?? undefined;
  // Carries over the channel selection made on the Recordings tab, so this
  // page only lists (and only queues for download) files from the channels
  // the user actually picked, not every channel on the device.
  const channelsParam = searchParams.get('channels') ?? undefined;
  const channels = channelsParam
    ? channelsParam
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n))
    : undefined;

  const [confirmOpen, setConfirmOpen] = useState(false);

  const q = useQuery({
    queryKey: ['recordings-files', deviceId, start, end, channelsParam],
    queryFn: () => api.files(deviceId, { start, end, channels }),
    enabled: Number.isFinite(deviceId) && !!start && !!end,
  });

  const files = q.data?.files ?? [];
  const channelNames = new Set(files.map((f) => f.deviceChannelName ?? 'Unknown channel'));

  const createTaskMutation = useMutation({
    mutationFn: (payload: DownloadTaskFileInput[]) => api.createDownloadTask(deviceId, payload),
    onSuccess: () => navigate('/tasks'),
  });

  const handleConfirmDownload = () => {
    setConfirmOpen(false);
    const payload: DownloadTaskFileInput[] = files.map((f, i) => ({
      channelId: Math.floor(Number(f.trackID) / 100),
      channelName: f.deviceChannelName || 'Unknown channel',
      playbackURI: f.playbackURI,
      filename: friendlyFileName(f.deviceChannelName, f.startTime, i),
      startTime: f.startTime ?? null,
      endTime: f.endTime ?? null,
      sizeBytes: f.sizeBytes ?? null,
    }));
    createTaskMutation.mutate(payload);
  };

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
        <>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Channel</TableCell>
                  <TableCell>File name</TableCell>
                  <TableCell>Start</TableCell>
                  <TableCell>End</TableCell>
                  <TableCell>Size</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {files.map((f, i) => (
                  <TableRow key={`${f.playbackURI}-${i}`}>
                    <TableCell>{f.deviceChannelName ?? '—'}</TableCell>
                    <TableCell>{friendlyFileName(f.deviceChannelName, f.startTime, i)}</TableCell>
                    <TableCell>{f.startTime ?? '—'}</TableCell>
                    <TableCell>{f.endTime ?? '—'}</TableCell>
                    <TableCell>{f.sizeBytes ?? '—'}</TableCell>
                  </TableRow>
                ))}
                {files.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography color="text.secondary">No recordings found in range.</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {files.length > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1 }}>
              <Button
                variant="contained"
                size="large"
                startIcon={<FileDownloadIcon />}
                onClick={() => setConfirmOpen(true)}
                disabled={createTaskMutation.isPending}
              >
                {createTaskMutation.isPending ? 'Starting…' : `Download (${files.length})`}
              </Button>
            </Box>
          )}

          {createTaskMutation.isError && <Alert severity="error">{(createTaskMutation.error as Error).message}</Alert>}
        </>
      )}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>
          Download {files.length} file{files.length === 1 ? '' : 's'}?
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            This queues {files.length} file{files.length === 1 ? '' : 's'} from {channelNames.size} channel
            {channelNames.size === 1 ? '' : 's'} as a background download task. The server downloads them one at a
            time — track progress on the Tasks page.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleConfirmDownload} disabled={createTaskMutation.isPending}>
            Download
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
