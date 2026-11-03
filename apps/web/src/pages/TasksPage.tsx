import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
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
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Collapse from '@mui/material/Collapse';
import LinearProgress from '@mui/material/LinearProgress';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CancelIcon from '@mui/icons-material/Cancel';
import ReplayIcon from '@mui/icons-material/Replay';
import DeleteIcon from '@mui/icons-material/Delete';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { partRange, partTimeText, recordingName } from '@hik-mgr/shared';
import type {
  DownloadTask,
  DownloadTaskFile,
  DownloadTaskFileConvertStatus,
  DownloadTaskFileStatus,
  DownloadTaskStatus,
} from '@hik-mgr/shared';
import { api } from '../api/client';
import { useLocale } from '../i18n/LocaleContext';

const TASK_STATUS_COLOR: Record<DownloadTaskStatus, 'default' | 'primary' | 'success' | 'error' | 'warning'> = {
  pending: 'default',
  running: 'primary',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
  interrupted: 'warning',
};

// Labels are looked up through t() at render time (not a static map) so
// they follow the active locale — 'status.<key>' translation keys are
// shared with the file/convert status chips below, since 'pending',
// 'done', 'failed' etc. mean the same thing in all three contexts.
const TASK_STATUS_KEY: Record<DownloadTaskStatus, string> = {
  pending: 'status.pending',
  running: 'status.running',
  completed: 'status.completed',
  failed: 'status.failed',
  cancelled: 'status.cancelled',
  interrupted: 'status.interrupted',
};

const FILE_STATUS_COLOR: Record<DownloadTaskFileStatus, 'default' | 'primary' | 'success' | 'error'> = {
  pending: 'default',
  downloading: 'primary',
  done: 'success',
  failed: 'error',
};

const FILE_STATUS_KEY: Record<DownloadTaskFileStatus, string> = {
  pending: 'status.pending',
  downloading: 'status.downloading',
  done: 'status.done',
  failed: 'status.failed',
};

const CONVERT_STATUS_COLOR: Record<DownloadTaskFileConvertStatus, 'default' | 'primary' | 'success' | 'error'> = {
  pending: 'default',
  converting: 'primary',
  done: 'success',
  failed: 'error',
};

const CONVERT_STATUS_KEY: Record<DownloadTaskFileConvertStatus, string> = {
  pending: 'status.pending',
  converting: 'status.converting',
  done: 'status.done',
  failed: 'status.failed',
};

function formatDateTime(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function isActive(status: DownloadTaskStatus): boolean {
  return status === 'pending' || status === 'running';
}

function isResumable(status: DownloadTaskStatus): boolean {
  return status === 'failed' || status === 'cancelled' || status === 'interrupted';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Rounds to whole minutes — matches the granularity the server logs (formatEta in downloadWorker.ts). */
function formatEtaMinutes(seconds: number, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const mins = Math.round(seconds / 60);
  if (mins < 1) return t('tasks.etaLessThanMin');
  return t(mins === 1 ? 'tasks.etaMinutesOne' : 'tasks.etaMinutesOther', { mins });
}

/** Live per-file progress bar + byte count + estimated time remaining while a file is actively downloading. */
function FileProgress({ file }: { file: DownloadTaskFile }) {
  const { t } = useLocale();
  if (file.status !== 'downloading') {
    return <>{file.downloadedBytes > 0 ? formatBytes(file.downloadedBytes) : '—'}</>;
  }
  const pct = file.totalBytes ? Math.min(100, (file.downloadedBytes / file.totalBytes) * 100) : null;
  return (
    <Box sx={{ minWidth: 140 }}>
      <LinearProgress variant={pct === null ? 'indeterminate' : 'determinate'} value={pct ?? undefined} sx={{ mb: 0.5 }} />
      <Typography variant="caption" color="text.secondary" display="block">
        {formatBytes(file.downloadedBytes)}
        {file.totalBytes ? ` / ${formatBytes(file.totalBytes)}` : ''}
        {pct !== null ? ` (${pct.toFixed(0)}%)` : ''}
      </Typography>
      {file.etaSeconds !== null && (
        <Typography variant="caption" color="text.secondary" display="block">
          {formatEtaMinutes(file.etaSeconds, t)}
        </Typography>
      )}
    </Box>
  );
}

/**
 * The ffmpeg-conversion subtask for one file — only starts once that
 * file's download itself is 'done' (see downloadWorker.ts). Shows a live
 * progress bar while 'converting', and a real "Download" link (streaming
 * the converted copy straight from the server, unlike the raw downloaded
 * file which stays server-side) once it's 'done'.
 */
function ConvertSubtask({ taskId, file }: { taskId: number; file: DownloadTaskFile }) {
  const { t } = useLocale();
  if (file.status !== 'done') {
    return (
      <Typography variant="caption" color="text.secondary">
        {t('tasks.waitingForDownload')}
      </Typography>
    );
  }

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Chip size="small" label={t(CONVERT_STATUS_KEY[file.convertStatus])} color={CONVERT_STATUS_COLOR[file.convertStatus]} />
      </Stack>
      {file.convertStatus === 'done' && (
        // A converted video is cut into time parts (each small enough to send over WhatsApp); older tasks have one file.
        <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
          {Array.from({ length: file.convertParts ?? 1 }, (_, i) => i + 1).map((part) => (
            <Button
              key={part}
              size="small"
              component="a"
              href={api.convertedFileDownloadUrl(taskId, file.id, file.convertParts == null ? undefined : part)}
              target="_blank"
              rel="noreferrer"
              startIcon={<FileDownloadIcon fontSize="small" />}
            >
              {(() => {
                if (file.convertParts == null || file.convertParts === 1) return t('recordingFiles.download');
                // each part is labelled with the time it covers
                const range = partRange(file.startTime, file.endTime, file.convertPartSeconds, file.convertParts, part);
                return range ? partTimeText(range) : t('tasks.part', { n: part });
              })()}
            </Button>
          ))}
        </Stack>
      )}
      {file.convertStatus === 'converting' && (
        <Box sx={{ minWidth: 120 }}>
          <LinearProgress
            variant={file.convertProgress === null ? 'indeterminate' : 'determinate'}
            value={file.convertProgress ?? undefined}
          />
          {file.convertProgress !== null && (
            <Typography variant="caption" color="text.secondary">
              {file.convertProgress}%
            </Typography>
          )}
        </Box>
      )}
      {file.convertError && (
        <Typography variant="caption" color="error" display="block">
          {file.convertError}
        </Typography>
      )}
    </Stack>
  );
}

/**
 * One row in the task table, expandable to show the file-by-file progress
 * (channel, generated filename, status, live byte count) that
 * downloadWorker.ts is writing to download_task_files as it works through
 * the task on the server. Detail is only fetched once expanded, and only
 * kept polling while the task is still pending/running — a finished
 * task's detail doesn't change.
 */
function TaskRow({ task }: { task: DownloadTask }) {
  const { t, locale } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ['download-task', task.id],
    queryFn: () => api.getDownloadTask(task.id),
    enabled: expanded,
    // Keep polling while the task's own downloads are still active OR any
    // file's conversion subtask is still running — a task can already
    // read 'completed' (all downloads done) while conversions are still
    // in progress, since that status only tracks downloads.
    refetchInterval: (query) => {
      if (!expanded) return false;
      // 2.5s rather than the download/convert progress's own ~1s
      // reporting cadence — each tick is a synchronous SQLite read on the
      // server, and sub-second freshness here isn't noticeable in the UI
      // anyway, so there's no reason to poll faster than that.
      if (isActive(task.status)) return 2500;
      const files = query.state.data?.files ?? [];
      const converting = files.some((f) => f.convertStatus === 'converting');
      return converting ? 2500 : false;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.cancelTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['download-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['download-task', task.id] });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: () => api.resumeTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['download-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['download-task', task.id] });
    },
  });

  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: () => api.deleteTask(task.id),
    onSuccess: () => {
      setConfirmDelete(false);
      queryClient.invalidateQueries({ queryKey: ['download-tasks'] });
    },
  });

  const progressDone = task.completedFiles + task.failedFiles;
  const progressPct = task.totalFiles > 0 ? (progressDone / task.totalFiles) * 100 : 0;

  return (
    <>
      <TableRow hover sx={{ cursor: 'pointer' }} onClick={() => setExpanded((e) => !e)}>
        <TableCell>
          {task.channelNames.length === 0
            ? '—'
            : task.channelNames.length === 1
              ? task.channelNames[0]
              : t('tasks.multipleCameras', { count: task.channelNames.length })}
        </TableCell>
        <TableCell>{task.deviceName}</TableCell>
        <TableCell>{formatDateTime(task.createdAt, locale)}</TableCell>
        <TableCell>
          <Chip size="small" label={t(TASK_STATUS_KEY[task.status])} color={TASK_STATUS_COLOR[task.status]} />
        </TableCell>
        <TableCell>
          {progressDone} / {task.totalFiles}
          {task.failedFiles > 0 && (
            <Typography component="span" variant="caption" color="error" sx={{ ml: 0.5 }}>
              {t('tasks.failedSuffix', { count: task.failedFiles })}
            </Typography>
          )}
        </TableCell>
        <TableCell align="right" onClick={(e) => e.stopPropagation()}>
          <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
            {isActive(task.status) && (
              <Button
                size="small"
                color="error"
                startIcon={<CancelIcon fontSize="small" />}
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
              >
                {t('devices.cancel')}
              </Button>
            )}
            {isResumable(task.status) && (
              <Button
                size="small"
                startIcon={<ReplayIcon fontSize="small" />}
                onClick={() => resumeMutation.mutate()}
                disabled={resumeMutation.isPending}
              >
                {t('tasks.resume')}
              </Button>
            )}
            {!isActive(task.status) && (
              <Button size="small" color="error" startIcon={<DeleteIcon fontSize="small" />} onClick={() => setConfirmDelete(true)}>
                {t('tasks.delete')}
              </Button>
            )}
            <IconButton
              size="small"
              aria-label={expanded ? t('tasks.collapseAria') : t('tasks.expandAria')}
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </IconButton>
          </Stack>
        </TableCell>
      </TableRow>
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>{t('tasks.deleteTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('tasks.deleteBody')}</DialogContentText>
          {deleteMutation.isError && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {(deleteMutation.error as Error).message}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>{t('devices.cancel')}</Button>
          <Button color="error" variant="contained" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
            {t('tasks.delete')}
          </Button>
        </DialogActions>
      </Dialog>
      <TableRow>
        <TableCell colSpan={6} sx={{ py: 0, borderBottom: expanded ? undefined : 0 }}>
          <Collapse in={expanded} timeout="auto" unmountOnExit>
            <Box sx={{ py: 1.5 }}>
              {(cancelMutation.isError || resumeMutation.isError) && (
                <Alert severity="error" sx={{ mb: 1 }}>
                  {((cancelMutation.error || resumeMutation.error) as Error).message}
                </Alert>
              )}
              {task.totalFiles > 0 && <LinearProgress variant="determinate" value={progressPct} sx={{ mb: 1.5 }} />}
              {detailQuery.isLoading && <CircularProgress size={16} />}
              {detailQuery.isError && <Alert severity="error">{(detailQuery.error as Error).message}</Alert>}
              {detailQuery.data && (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('recordings.colChannel')}</TableCell>
                      <TableCell>{t('recordingFiles.colFileName')}</TableCell>
                      <TableCell>{t('recordingFiles.download')}</TableCell>
                      <TableCell>{t('tasks.colProgress')}</TableCell>
                      <TableCell>{t('tasks.colConvert')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {detailQuery.data.files.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell>{f.channelName}</TableCell>
                        <TableCell>{`${recordingName({ label: f.channelName, startTime: f.startTime, endTime: f.endTime })}.mp4`}</TableCell>
                        <TableCell>
                          <Chip size="small" label={t(FILE_STATUS_KEY[f.status])} color={FILE_STATUS_COLOR[f.status]} />
                          {f.error && (
                            <Typography variant="caption" color="error" display="block">
                              {f.error}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <FileProgress file={f} />
                        </TableCell>
                        <TableCell>
                          <ConvertSubtask taskId={task.id} file={f} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

export default function TasksPage() {
  const { t } = useLocale();
  const q = useQuery({
    queryKey: ['download-tasks'],
    queryFn: api.listDownloadTasks,
    refetchInterval: (query) => {
      const tasks = query.state.data ?? [];
      return tasks.some((task) => isActive(task.status)) ? 3000 : false;
    },
  });

  const tasks = q.data ?? [];

  const queryClient = useQueryClient();
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [olderThanDays, setOlderThanDays] = useState(7);
  const cleanupMutation = useMutation({
    mutationFn: () => api.cleanupTasks(olderThanDays),
    onSuccess: () => {
      setCleanupOpen(false);
      queryClient.invalidateQueries({ queryKey: ['download-tasks'] });
    },
  });

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">{t('tasks.title')}</Typography>
        <Button startIcon={<DeleteSweepIcon />} onClick={() => setCleanupOpen(true)} disabled={tasks.length === 0}>
          {t('tasks.deleteOld')}
        </Button>
      </Stack>

      {cleanupMutation.isSuccess && (
        <Alert severity="success" onClose={() => cleanupMutation.reset()}>
          {t('tasks.deletedResult', { count: cleanupMutation.data.deleted, size: formatBytes(cleanupMutation.data.freedBytes) })}
        </Alert>
      )}

      <Dialog open={cleanupOpen} onClose={() => setCleanupOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t('tasks.deleteOldTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>{t('tasks.deleteOldBody')}</DialogContentText>
          <TextField select fullWidth size="small" label={t('tasks.olderThan')} value={olderThanDays} onChange={(e) => setOlderThanDays(Number(e.target.value))}>
            <MenuItem value={0}>{t('tasks.optAllFinished')}</MenuItem>
            {[1, 7, 30].map((days) => (
              <MenuItem key={days} value={days}>
                {t('tasks.optDays', { days })}
              </MenuItem>
            ))}
          </TextField>
          {cleanupMutation.isError && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {(cleanupMutation.error as Error).message}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCleanupOpen(false)}>{t('devices.cancel')}</Button>
          <Button color="error" variant="contained" onClick={() => cleanupMutation.mutate()} disabled={cleanupMutation.isPending}>
            {t('tasks.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {q.isLoading && (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            {t('tasks.loading')}
          </Typography>
        </Stack>
      )}

      {q.isError && <Alert severity="error">{(q.error as Error).message}</Alert>}

      {q.isSuccess && (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('recordings.colChannel')}</TableCell>
                <TableCell>{t('tasks.colDevice')}</TableCell>
                <TableCell>{t('tasks.colCreated')}</TableCell>
                <TableCell>{t('deviceDetail.tabStatus')}</TableCell>
                <TableCell>{t('tasks.colProgress')}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
              {tasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography color="text.secondary">{t('tasks.none')}</Typography>
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
