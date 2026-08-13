import { useState } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import { api } from '../api/client';

function TabPanel({ value, index, children }: { value: number; index: number; children: React.ReactNode }) {
  if (value !== index) return null;
  return <Box sx={{ py: 2 }}>{children}</Box>;
}

function StatusTab({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['status', id], queryFn: () => api.status(id) });
  if (q.isLoading) return <CircularProgress size={24} />;
  if (q.isError) return <Alert severity="error">{(q.error as Error).message}</Alert>;
  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Status
        </Typography>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>
          {JSON.stringify(q.data?.status, null, 2)}
        </pre>
      </Paper>
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Device info
        </Typography>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>
          {JSON.stringify(q.data?.info, null, 2)}
        </pre>
      </Paper>
    </Stack>
  );
}

function ChannelsTab({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['channels', id], queryFn: () => api.channels(id) });
  if (q.isLoading) return <CircularProgress size={24} />;
  if (q.isError) return <Alert severity="error">{(q.error as Error).message}</Alert>;
  return (
    <TableContainer component={Paper}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>ID</TableCell>
            <TableCell>Name</TableCell>
            <TableCell>IP</TableCell>
            <TableCell>Online</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(q.data?.channels ?? []).map((c) => (
            <TableRow key={c.id}>
              <TableCell>{c.id}</TableCell>
              <TableCell>{c.name}</TableCell>
              <TableCell>{c.ip ?? '—'}</TableCell>
              <TableCell>{c.online === null || c.online === undefined ? '—' : String(c.online)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function RecordingsTab({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['files', id], queryFn: () => api.files(id) });
  if (q.isLoading) return <CircularProgress size={24} />;
  if (q.isError) return <Alert severity="error">{(q.error as Error).message}</Alert>;
  return (
    <TableContainer component={Paper}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Channel</TableCell>
            <TableCell>Start</TableCell>
            <TableCell>End</TableCell>
            <TableCell>Size</TableCell>
            <TableCell align="right">Download</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(q.data?.files ?? []).map((f, i) => (
            <TableRow key={`${f.playbackURI}-${i}`}>
              <TableCell>{f.deviceChannelName ?? '—'}</TableCell>
              <TableCell>{f.startTime ?? '—'}</TableCell>
              <TableCell>{f.endTime ?? '—'}</TableCell>
              <TableCell>{f.sizeBytes ?? '—'}</TableCell>
              <TableCell align="right">
                <Link href={api.downloadUrl(id, f.playbackURI)} target="_blank" rel="noreferrer">
                  Download
                </Link>
              </TableCell>
            </TableRow>
          ))}
          {(q.data?.files ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>
                <Typography color="text.secondary">No recordings found in range.</Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function SnapshotsTab({ id }: { id: number }) {
  const channelsQuery = useQuery({ queryKey: ['channels', id], queryFn: () => api.channels(id) });
  const channels = channelsQuery.data?.channels ?? [];
  const tracks = channels.length > 0 ? channels.map((c) => Number(c.id) * 100 + 1) : [101];

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 2 }}>
      {tracks.map((track) => (
        <Paper key={track} sx={{ p: 1 }}>
          <Typography variant="caption" display="block" gutterBottom>
            Track {track}
          </Typography>
          <Box
            component="img"
            src={api.snapshotUrl(id, track)}
            alt={`Snapshot track ${track}`}
            sx={{ width: '100%', display: 'block', bgcolor: 'grey.200' }}
          />
        </Paper>
      ))}
    </Box>
  );
}

export default function DeviceDetailPage() {
  const { id } = useParams();
  const deviceId = Number(id);
  const [tab, setTab] = useState(0);

  return (
    <Stack spacing={2}>
      <Box>
        <Link component={RouterLink} to="/" underline="hover">
          ← Back to devices
        </Link>
      </Box>
      <Typography variant="h5">Device #{deviceId}</Typography>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)}>
        <Tab label="Status" />
        <Tab label="Channels" />
        <Tab label="Recordings" />
        <Tab label="Snapshots" />
      </Tabs>
      <TabPanel value={tab} index={0}>
        <StatusTab id={deviceId} />
      </TabPanel>
      <TabPanel value={tab} index={1}>
        <ChannelsTab id={deviceId} />
      </TabPanel>
      <TabPanel value={tab} index={2}>
        <RecordingsTab id={deviceId} />
      </TabPanel>
      <TabPanel value={tab} index={3}>
        <SnapshotsTab id={deviceId} />
      </TabPanel>
    </Stack>
  );
}
