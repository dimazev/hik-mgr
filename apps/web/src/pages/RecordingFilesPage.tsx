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
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { dayTimeText, fileTimes, formatWallClock, recordingName, type DownloadTaskFileInput } from '@hik-mgr/shared';
import { api } from '../api/client';
import { useLocale } from '../i18n/LocaleContext';

function sanitizeForFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'camera';
}

/**
 * The device only gives us a playbackURI, not a human file name — this
 * synthesizes one from the channel name + recording start time so the
 * list (and the eventual downloaded file, via the task's stored filename)
 * reads like "front-door_2026-08-13T13-00-05.mp4" instead of an opaque URI.
 */
function friendlyFileName(channelName: string | null | undefined, startTime: string | undefined, index: number): string {
  const start = startTime ? startTime.replace(/:/g, '-') : `file-${index}`;
  return `${sanitizeForFilename(channelName || 'camera')}_${start}.mp4`;
}

function formatDateTime(iso: string, locale: string): string {
  return formatWallClock(iso, locale);
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
  const { t, locale } = useLocale();
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
  // Indexes (in the list below) the user un-ticked - everything starts selected, so a new search needs no reset.
  const [deselected, setDeselected] = useState<Set<number>>(new Set());

  const q = useQuery({
    queryKey: ['recordings-files', deviceId, start, end, channelsParam],
    queryFn: () => api.files(deviceId, { start, end, channels }),
    enabled: Number.isFinite(deviceId) && !!start && !!end,
  });

  const files = q.data?.files ?? [];
  const selectedIdx = files.map((_, i) => i).filter((i) => !deselected.has(i));
  const selectedFiles = selectedIdx.map((i) => files[i]);
  const channelNames = new Set(selectedFiles.map((f) => f.deviceChannelName ?? t('common.unknownChannel')));

  const toggleFile = (i: number) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const toggleAll = () => setDeselected(selectedIdx.length === files.length ? new Set(files.map((_, i) => i)) : new Set());

  const createTaskMutation = useMutation({
    mutationFn: (payload: DownloadTaskFileInput[]) => api.createDownloadTask(deviceId, payload),
    onSuccess: () => navigate('/tasks'),
  });

  const handleConfirmDownload = () => {
    setConfirmOpen(false);
    const payload: DownloadTaskFileInput[] = selectedIdx.map((i) => {
      const f = files[i];
      return {
      channelId: Math.floor(Number(f.trackID) / 100),
      channelName: f.deviceChannelName || t('common.unknownChannel'),
      playbackURI: f.playbackURI,
      filename: friendlyFileName(f.deviceChannelName, f.startTime, i),
      startTime: f.startTime ?? null,
      endTime: f.endTime ?? null,
      sizeBytes: f.sizeBytes ?? null,
      };
    });
    createTaskMutation.mutate(payload);
  };

  return (
    <Stack spacing={2}>
      <Box>
        <Link component={RouterLink} to={`/devices/${deviceId}`} underline="hover">
          {t('recordingFiles.backToDevice')}
        </Link>
      </Box>
      <Typography variant="h5">{t('recordingFiles.title')}</Typography>

      {start && end ? (
        <Typography variant="body2" color="text.secondary">
          {formatDateTime(start, locale)} – {formatDateTime(end, locale)}
        </Typography>
      ) : (
        <Alert severity="warning">{t('recordingFiles.missingRange')}</Alert>
      )}

      {q.isLoading && (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            {t('recordingFiles.loading')}
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
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={files.length > 0 && selectedIdx.length === files.length}
                      indeterminate={selectedIdx.length > 0 && selectedIdx.length < files.length}
                      onChange={toggleAll}
                      disabled={files.length === 0}
                      inputProps={{ 'aria-label': t('recordingFiles.selectAllAria') }}
                    />
                  </TableCell>
                  <TableCell>{t('recordings.colChannel')}</TableCell>
                  <TableCell>{t('recordingFiles.colFileName')}</TableCell>
                  <TableCell>{t('recordings.start')}</TableCell>
                  <TableCell>{t('recordings.end')}</TableCell>
                  <TableCell>{t('recordingFiles.colSize')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {files.map((f, i) => (
                  <TableRow key={`${f.playbackURI}-${i}`} hover selected={!deselected.has(i)}>
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={!deselected.has(i)}
                        onChange={() => toggleFile(i)}
                        inputProps={{ 'aria-label': t('recordingFiles.selectFileAria') }}
                      />
                    </TableCell>
                    <TableCell>{f.deviceChannelName ?? '—'}</TableCell>
                    <TableCell>{`${recordingName({ label: f.deviceChannelName, ...fileTimes(f.playbackURI, f.startTime, f.endTime) })}.mp4`}</TableCell>
                    <TableCell>{dayTimeText(fileTimes(f.playbackURI, f.startTime, f.endTime).startTime)}</TableCell>
                    <TableCell>{dayTimeText(fileTimes(f.playbackURI, f.startTime, f.endTime).endTime)}</TableCell>
                    <TableCell>{f.sizeBytes ?? '—'}</TableCell>
                  </TableRow>
                ))}
                {files.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography color="text.secondary">{t('recordingFiles.noneInRange')}</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {files.length > 0 && (
            <Stack alignItems="center" spacing={0.5} sx={{ pt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                {t('recordingFiles.selectedOf', { selected: selectedIdx.length, total: files.length })}
              </Typography>
              <Button
                variant="contained"
                size="large"
                startIcon={<FileDownloadIcon />}
                onClick={() => setConfirmOpen(true)}
                disabled={createTaskMutation.isPending || selectedIdx.length === 0}
              >
                {createTaskMutation.isPending ? t('recordingFiles.starting') : t('recordingFiles.downloadCount', { count: selectedIdx.length })}
              </Button>
            </Stack>
          )}

          {createTaskMutation.isError && <Alert severity="error">{(createTaskMutation.error as Error).message}</Alert>}
        </>
      )}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>
          {t(selectedIdx.length === 1 ? 'recordingFiles.confirmTitleOne' : 'recordingFiles.confirmTitleOther', { count: selectedIdx.length })}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('recordingFiles.confirmBody', {
              count: selectedIdx.length,
              fileWord: t(selectedIdx.length === 1 ? 'common.file' : 'common.files'),
              channelCount: channelNames.size,
              channelWord: t(channelNames.size === 1 ? 'common.channel' : 'common.channels'),
            })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>{t('devices.cancel')}</Button>
          <Button variant="contained" onClick={handleConfirmDownload} disabled={createTaskMutation.isPending}>
            {t('recordingFiles.download')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
