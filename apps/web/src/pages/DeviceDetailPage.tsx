import { useState, useEffect } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import SaveIcon from '@mui/icons-material/Save';
import SearchIcon from '@mui/icons-material/Search';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import ViewListIcon from '@mui/icons-material/ViewList';
import type { Channel } from '@hik-mgr/shared';
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

/**
 * Shared editable-label state + save mutation, used by both the grid card
 * and the list row below so the two views don't duplicate this logic.
 */
function useChannelLabelEditor(deviceId: number, channel: Channel) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(channel.label ?? '');

  // Resync local edit state whenever the saved label changes underneath us
  // (our own successful save, or a refetch picking up someone else's
  // change) — cheap since it's just a string compare, and keeps the field
  // from drifting out of sync with what's actually stored.
  useEffect(() => {
    setLabel(channel.label ?? '');
  }, [channel.label]);

  const dirty = label.trim() !== (channel.label ?? '').trim();

  const saveMutation = useMutation({
    mutationFn: () => api.updateChannelLabel(deviceId, Number(channel.id), label),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['channels', deviceId] }),
  });

  return {
    label,
    setLabel,
    dirty,
    save: () => saveMutation.mutate(),
    isSaving: saveMutation.isPending,
    error: saveMutation.isError ? (saveMutation.error as Error).message : null,
  };
}

function ChannelCard({ deviceId, channel }: { deviceId: number; channel: Channel }) {
  const { label, setLabel, dirty, save, isSaving, error } = useChannelLabelEditor(deviceId, channel);
  const track = Number(channel.id) * 100 + 1;
  const displayName = channel.label || channel.name;

  return (
    <Paper sx={{ p: 1.5 }}>
      <Box
        component="img"
        src={api.snapshotUrl(deviceId, track)}
        alt={`Snapshot of ${displayName}`}
        sx={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', bgcolor: 'grey.200', borderRadius: 1, mb: 1.5 }}
      />
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TextField
          label="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && dirty && !isSaving) save();
          }}
          placeholder={channel.name}
          size="small"
          fullWidth
        />
        <IconButton aria-label="Save label" color="primary" disabled={!dirty || isSaving} onClick={save}>
          <SaveIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
        Channel {channel.id} · device name: {channel.name}
        {channel.ip ? ` · ${channel.ip}` : ''}
      </Typography>
      {channel.online !== null && channel.online !== undefined && (
        <Chip
          size="small"
          label={channel.online ? 'Online' : 'Offline'}
          color={channel.online ? 'success' : 'default'}
          sx={{ mt: 1 }}
        />
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
    </Paper>
  );
}

function ChannelListRow({ deviceId, channel }: { deviceId: number; channel: Channel }) {
  const { label, setLabel, dirty, save, isSaving, error } = useChannelLabelEditor(deviceId, channel);
  const track = Number(channel.id) * 100 + 1;
  const displayName = channel.label || channel.name;

  return (
    <TableRow>
      <TableCell sx={{ width: 88 }}>
        <Box
          component="img"
          src={api.snapshotUrl(deviceId, track)}
          alt={`Snapshot of ${displayName}`}
          sx={{ width: 72, height: 54, objectFit: 'cover', borderRadius: 1, display: 'block', bgcolor: 'grey.200' }}
        />
      </TableCell>
      <TableCell sx={{ width: 56 }}>{channel.id}</TableCell>
      <TableCell sx={{ minWidth: 220 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && dirty && !isSaving) save();
            }}
            placeholder={channel.name}
            size="small"
            variant="standard"
            fullWidth
          />
          <IconButton aria-label="Save label" size="small" color="primary" disabled={!dirty || isSaving} onClick={save}>
            <SaveIcon fontSize="small" />
          </IconButton>
        </Stack>
        {error && (
          <Typography variant="caption" color="error" display="block">
            {error}
          </Typography>
        )}
      </TableCell>
      <TableCell>{channel.name}</TableCell>
      <TableCell>{channel.ip ?? '—'}</TableCell>
      <TableCell>
        {channel.online === null || channel.online === undefined ? (
          '—'
        ) : (
          <Chip size="small" label={channel.online ? 'Online' : 'Offline'} color={channel.online ? 'success' : 'default'} />
        )}
      </TableCell>
    </TableRow>
  );
}

function ChannelsTab({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['channels', id], queryFn: () => api.channels(id) });
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [search, setSearch] = useState('');

  if (q.isLoading) return <CircularProgress size={24} />;
  if (q.isError) return <Alert severity="error">{(q.error as Error).message}</Alert>;

  const allChannels = q.data?.channels ?? [];
  const term = search.trim().toLowerCase();
  // Searches the effective display name (custom label if set, else the
  // device's own channel name) — labels are the point, but falling back to
  // name means a channel that was never labeled is still findable.
  const channels = term ? allChannels.filter((c) => (c.label || c.name || '').toLowerCase().includes(term)) : allChannels;

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <TextField
          size="small"
          placeholder="Search by label…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ minWidth: 240 }}
        />
        <ToggleButtonGroup value={view} exclusive size="small" onChange={(_e, v) => v && setView(v)}>
          <ToggleButton value="grid" aria-label="Grid view">
            <ViewModuleIcon fontSize="small" />
          </ToggleButton>
          <ToggleButton value="list" aria-label="List view">
            <ViewListIcon fontSize="small" />
          </ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="body2" color="text.secondary">
          {channels.length} of {allChannels.length} channel{allChannels.length === 1 ? '' : 's'}
        </Typography>
      </Stack>

      {allChannels.length === 0 && <Typography color="text.secondary">No channels reported by this device.</Typography>}

      {allChannels.length > 0 && channels.length === 0 && (
        <Typography color="text.secondary">No channels match "{search}".</Typography>
      )}

      {channels.length > 0 && view === 'grid' && (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 2 }}>
          {channels.map((c) => (
            <ChannelCard key={c.id} deviceId={id} channel={c} />
          ))}
        </Box>
      )}

      {channels.length > 0 && view === 'list' && (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Snapshot</TableCell>
                <TableCell>ID</TableCell>
                <TableCell>Label</TableCell>
                <TableCell>Device name</TableCell>
                <TableCell>IP</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {channels.map((c) => (
                <ChannelListRow key={c.id} deviceId={id} channel={c} />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
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
    </Stack>
  );
}
