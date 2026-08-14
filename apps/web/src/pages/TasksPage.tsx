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
import Collapse from '@mui/material/Collapse';
import LinearProgress from '@mui/material/LinearProgress';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CancelIcon from '@mui/icons-material/Cancel';
import ReplayIcon from '@mui/icons-material/Replay';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import type {
  DownloadTask,
  DownloadTaskFile,
  DownloadTaskFileConvertStatus,
  DownloadTaskFileStatus,
  DownloadTaskStatus,
} from '@hik-mgr/shared';
import { api } from '../api/client';

const TASK_STATUS_COLOR: Record<DownloadTaskStatus, 'default' | 'primary' | 'success' | 'error' | 'warning'> = {
  pending: 'default',
  running: 'primary',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
  interrupted: 'warning',
};

const TASK_STATUS_LABEL: Record<DownloadTaskStatus, string> = {
  pending: 'pending',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  interrupted: 'interrupted (server restarted)',
};

const FILE_STATUS_COLOR: Record<DownloadTaskFileStatus, 'default' | 'primary' | 'success' | 'error'> = {
  pending: 'default',
  downloading: 'primary',
  done: 'success',
  failed: 'error',
};

const CONVERT_STATUS_COLOR: Record<DownloadTaskFileConvertStatus, 'default' | 'primary' | 'success' | 'error'> = {
  pending: 'default',
  converting: 'primary',
  done: 'success',
  failed: 'error',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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

/** Live per-file progress bar + byte count while a file is actively downloading. */
function FileProgress({ file }: { file: DownloadTaskFile }) {
  if (file.status !== 'downloading') {
    return <>{file.downloadedBytes > 0 ? formatBytes(file.downloadedBytes) : '—'}</>;
  }
  const pct = file.totalBytes ? Math.min(100, (file.downloadedBytes / file.totalBytes) * 100) : null;
  return (
    <Box sx={{ minWidth: 120 }}>
      <LinearProgress variant={pct === null ? 'indeterminate' : 'determinate'} value={pct ?? undefined} sx={{ mb: 0.5 }} />
      <Typography variant="caption" color="text.secondary">
        {formatBytes(file.downloadedBytes)}
        {file.totalBytes ? ` / ${formatBytes(file.totalBytes)}` : ''}
        {pct !== null ? ` (${pct.toFixed(0)}%)` : ''}
      </Typography>
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
  if (file.status !== 'done') {
    return (
      <Typography variant="caption" color="text.secondary">
        Waiting for download
      </Typography>
    );
  }

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Chip size="small" label={file.convertStatus} color={CONVERT_STATUS_COLOR[file.convertStatus]} />
        {file.convertStatus === 'done' && (
          <Button
            size="small"
            component="a"
            href={api.convertedFileDownloadUrl(taskId, file.id)}
            target="_blank"
            rel="noreferrer"
            startIcon={<FileDownloadIcon fontSize="small" />}
          >
            Download
          </Button>
        )}
      </Stack>
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
      if (isActive(task.status)) return 1500;
      const files = query.state.data?.files ?? [];
      const converting = files.some((f) => f.convertStatus === 'converting');
      return converting ? 1500 : false;
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

  const progressDone = task.completedFiles + task.failedFiles;
  const progressPct = task.totalFiles > 0 ? (progressDone / task.totalFiles) * 100 : 0;

  return (
    <>
      <TableRow hover sx={{ cursor: 'pointer' }} onClick={() => setExpanded((e) => !e)}>
        <TableCell>{task.id}</TableCell>
        <TableCell>{task.deviceName}</TableCell>
        <TableCell>{formatDateTime(task.createdAt)}</TableCell>
        <TableCell>
          <Chip size="small" label={TASK_STATUS_LABEL[task.status]} color={TASK_STATUS_COLOR[task.status]} />
        </TableCell>
        <TableCell>
          {progressDone} / {task.totalFiles}
          {task.failedFiles > 0 && (
            <Typography component="span" variant="caption" color="error" sx={{ ml: 0.5 }}>
              ({task.failedFiles} failed)
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
                Cancel
              </Button>
            )}
            {isResumable(task.status) && (
              <Button
                size="small"
                startIcon={<ReplayIcon fontSize="small" />}
                onClick={() => resumeMutation.mutate()}
                disabled={resumeMutation.isPending}
              >
                Resume
              </Button>
            )}
            <IconButton size="small" aria-label={expanded ? 'Collapse' : 'Expand'} onClick={() => setExpanded((e) => !e)}>
              {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </IconButton>
          </Stack>
        </TableCell>
      </TableRow>
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
                      <TableCell>Channel</TableCell>
                      <TableCell>File name</TableCell>
                      <TableCell>Download</TableCell>
                      <TableCell>Progress</TableCell>
                      <TableCell>Convert (720p)</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {detailQuery.data.files.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell>{f.channelName}</TableCell>
                        <TableCell>{f.filename}</TableCell>
                        <TableCell>
                          <Chip size="small" label={f.status} color={FILE_STATUS_COLOR[f.status]} />
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
  const q = useQuery({
    queryKey: ['download-tasks'],
    queryFn: api.listDownloadTasks,
    refetchInterval: (query) => {
      const tasks = query.state.data ?? [];
      return tasks.some((t) => isActive(t.status)) ? 3000 : false;
    },
  });

  const tasks = q.data ?? [];

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Download tasks</Typography>

      {q.isLoading && (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            Loading tasks…
          </Typography>
        </Stack>
      )}

      {q.isError && <Alert severity="error">{(q.error as Error).message}</Alert>}

      {q.isSuccess && (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>Device</TableCell>
                <TableCell>Created</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Progress</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
              {tasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography color="text.secondary">No download tasks yet.</Typography>
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
