import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import Collapse from '@mui/material/Collapse';
import LinearProgress from '@mui/material/LinearProgress';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import type { DownloadTask, DownloadTaskFileStatus, DownloadTaskStatus } from '@hik-mgr/shared';
import { api } from '../api/client';

const TASK_STATUS_COLOR: Record<DownloadTaskStatus, 'default' | 'primary' | 'success' | 'error' | 'warning'> = {
  pending: 'default',
  running: 'primary',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
};

const FILE_STATUS_COLOR: Record<DownloadTaskFileStatus, 'default' | 'primary' | 'success' | 'error'> = {
  pending: 'default',
  downloading: 'primary',
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

/**
 * One row in the task table, expandable to show the file-by-file progress
 * (channel, generated filename, status) that downloadWorker.ts is writing
 * to download_task_files as it works through the task on the server.
 * Detail is only fetched once expanded, and only kept polling while the
 * task is still pending/running — a finished task's detail doesn't change.
 */
function TaskRow({ task }: { task: DownloadTask }) {
  const [expanded, setExpanded] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['download-task', task.id],
    queryFn: () => api.getDownloadTask(task.id),
    enabled: expanded,
    refetchInterval: expanded && isActive(task.status) ? 2000 : false,
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
          <Chip size="small" label={task.status} color={TASK_STATUS_COLOR[task.status]} />
        </TableCell>
        <TableCell>
          {progressDone} / {task.totalFiles}
          {task.failedFiles > 0 && (
            <Typography component="span" variant="caption" color="error" sx={{ ml: 0.5 }}>
              ({task.failedFiles} failed)
            </Typography>
          )}
        </TableCell>
        <TableCell align="right">
          <IconButton size="small" aria-label={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={6} sx={{ py: 0, borderBottom: expanded ? undefined : 0 }}>
          <Collapse in={expanded} timeout="auto" unmountOnExit>
            <Box sx={{ py: 1.5 }}>
              {task.totalFiles > 0 && <LinearProgress variant="determinate" value={progressPct} sx={{ mb: 1.5 }} />}
              {detailQuery.isLoading && <CircularProgress size={16} />}
              {detailQuery.isError && <Alert severity="error">{(detailQuery.error as Error).message}</Alert>}
              {detailQuery.data && (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Channel</TableCell>
                      <TableCell>File name</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Downloaded</TableCell>
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
                        <TableCell>{f.downloadedBytes > 0 ? `${Math.round(f.downloadedBytes / 1024)} KB` : '—'}</TableCell>
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
