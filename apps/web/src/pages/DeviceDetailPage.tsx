import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link as RouterLink } from 'react-router-dom';
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
import Button from '@mui/material/Button';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import type { SxProps, Theme } from '@mui/material/styles';
import SaveIcon from '@mui/icons-material/Save';
import SearchIcon from '@mui/icons-material/Search';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import ViewListIcon from '@mui/icons-material/ViewList';
import RefreshIcon from '@mui/icons-material/Refresh';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import type { Channel } from '@hik-mgr/shared';
import { api } from '../api/client';
import { useLocale } from '../i18n/LocaleContext';

function formatSince(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Formats an ISO timestamp for display in the search summary line. */
function formatDateTime(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const SNAPSHOT_MAX_ATTEMPTS = 3;
const SNAPSHOT_RETRY_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches a channel's snapshot as a blob (rather than pointing an <img> at
 * the URL directly) so a failed fetch can be told apart from a successful
 * one: `url` is only ever updated on success, so if a refresh fails (device
 * offline, timeout, etc.) the last successfully loaded snapshot stays on
 * screen instead of the browser swapping in a broken-image icon — `error`
 * is set alongside it so callers can show that the image is stale.
 *
 * A single request failure (e.g. a transient 500 while the device is busy)
 * is retried up to SNAPSHOT_MAX_ATTEMPTS times before giving up and
 * surfacing `error`.
 *
 * `focused` opts this one snapshot into a 1s auto-refresh loop (see the
 * effect below) — every other, unfocused camera on the page keeps loading
 * its snapshot only once (or on manual refresh), so selecting one camera
 * to "watch live" doesn't multiply the device's snapshot load by however
 * many cameras happen to be on screen.
 */
function useSnapshot(deviceId: number, track: number, focused: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const currentUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      let lastError: unknown = null;

      for (let attemptNum = 1; attemptNum <= SNAPSHOT_MAX_ATTEMPTS; attemptNum++) {
        if (cancelled) return;
        try {
          const res = await fetch(api.snapshotUrl(deviceId, track));
          if (!res.ok) throw new Error(`Snapshot request failed (${res.status})`);
          const blob = await res.blob();
          if (cancelled) return;
          const next = URL.createObjectURL(blob);
          if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current);
          currentUrlRef.current = next;
          setUrl(next);
          setError(null);
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          if (attemptNum < SNAPSHOT_MAX_ATTEMPTS) {
            await delay(SNAPSHOT_RETRY_DELAY_MS);
          }
        }
      }

      if (cancelled) return;
      if (lastError) {
        // Deliberately not touching `url` here — keep whatever loaded last.
        setError(lastError instanceof Error ? lastError.message : 'Failed to load snapshot');
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, track, attempt]);

  // Revoke the last object URL on unmount so it doesn't leak.
  useEffect(() => {
    return () => {
      if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current);
    };
  }, []);

  // While focused, re-trigger the fetch effect above once a second by
  // bumping `attempt` — same request/retry/object-URL-swap path as a
  // manual refresh, just on a timer. Stops immediately when `focused`
  // goes false (camera deselected, or another camera becomes focused).
  useEffect(() => {
    if (!focused) return;
    const interval = setInterval(() => setAttempt((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [focused]);

  return { url, error, loading, refresh: () => setAttempt((n) => n + 1) };
}

function SnapshotImage({
  deviceId,
  track,
  alt,
  sx,
  showRefresh = true,
  focused = false,
  onToggleFocus,
}: {
  deviceId: number;
  track: number;
  alt: string;
  sx?: SxProps<Theme>;
  showRefresh?: boolean;
  /** True while this camera is the one selected to auto-refresh every second — see useSnapshot. */
  focused?: boolean;
  /** Omit to make this snapshot unselectable. */
  onToggleFocus?: () => void;
}) {
  const { url, error, loading, refresh } = useSnapshot(deviceId, track, focused);
  const { t } = useLocale();

  const clickable = !!onToggleFocus;

  return (
    <Tooltip title={clickable ? t(focused ? 'snapshot.unfocusAria' : 'snapshot.focusAria') : ''} disableHoverListener={!clickable}>
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          bgcolor: 'grey.200',
          cursor: clickable ? 'pointer' : undefined,
          outline: focused ? '2px solid' : 'none',
          outlineColor: 'error.main',
          outlineOffset: '-2px',
          ...sx,
        }}
        onClick={onToggleFocus}
      >
        {url ? (
          <Box component="img" src={url} alt={alt} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {loading ? (
              <CircularProgress size={18} />
            ) : (
              <Typography variant="caption" color="text.secondary">
                {t('snapshot.noSnapshot')}
              </Typography>
            )}
          </Box>
        )}
        {error && (
          <Tooltip title={t('snapshot.errorTooltip', { error })}>
            <WarningAmberIcon
              fontSize="small"
              color="warning"
              sx={{ position: 'absolute', top: 4, left: 4, bgcolor: 'background.paper', borderRadius: '50%', p: 0.25 }}
            />
          </Tooltip>
        )}
        {focused && (
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
        {showRefresh && (
          <IconButton
            aria-label={t('snapshot.refreshAria')}
            size="small"
            onClick={(e) => {
              // Manual refresh shouldn't also toggle focus — it sits inside
              // the same clickable box as the focus toggle above.
              e.stopPropagation();
              refresh();
            }}
            disabled={loading}
            sx={{
              position: 'absolute',
              top: 4,
              right: 4,
              bgcolor: 'background.paper',
              '&:hover': { bgcolor: 'background.paper' },
            }}
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
        )}
      </Box>
    </Tooltip>
  );
}

function TabPanel({ value, index, children }: { value: number; index: number; children: React.ReactNode }) {
  if (value !== index) return null;
  return <Box sx={{ py: 2 }}>{children}</Box>;
}

function StatusTab({ id }: { id: number }) {
  const { t } = useLocale();
  const q = useQuery({ queryKey: ['status', id], queryFn: () => api.status(id) });
  if (q.isLoading) return <CircularProgress size={24} />;
  if (q.isError) return <Alert severity="error">{(q.error as Error).message}</Alert>;
  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          {t('deviceDetail.tabStatus')}
        </Typography>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>
          {JSON.stringify(q.data?.status, null, 2)}
        </pre>
      </Paper>
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          {t('status.deviceInfo')}
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

/**
 * Recording-history summary for one channel — "since when" it has
 * recordings and how many files were found. Backed by the server's
 * recording_history cache table: the first load for a channel triggers a
 * (slow) scan of the device's whole recording index, which is then cached,
 * so every load after that is instant until the user hits refresh.
 */
function useRecordingHistory(deviceId: number, channelId: number) {
  const queryClient = useQueryClient();
  const queryKey = ['recording-history', deviceId, channelId];

  const query = useQuery({
    queryKey,
    queryFn: () => api.recordingHistory(deviceId, channelId),
  });

  const refreshMutation = useMutation({
    mutationFn: () => api.recordingHistory(deviceId, channelId, true),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  });

  return {
    summary: query.data,
    loading: query.isLoading || refreshMutation.isPending,
    error: query.isError
      ? (query.error as Error).message
      : refreshMutation.isError
        ? (refreshMutation.error as Error).message
        : null,
    refresh: () => refreshMutation.mutate(),
  };
}

function RecordingHistoryLine({ deviceId, channel }: { deviceId: number; channel: Channel }) {
  const { summary, loading, error, refresh } = useRecordingHistory(deviceId, Number(channel.id));
  const { t, locale } = useLocale();

  // A device-wide recording-index scan is slow, so the server never runs
  // one just because this line was rendered — it only returns a cached
  // result, or a `scanned: false` placeholder if this channel has never
  // been scanned. `refresh()` is what actually asks the server to scan
  // *this one channel* (?refresh=1) — nothing here ever triggers scanning
  // every channel at once just by opening the tab.
  const notScannedYet = summary && !summary.scanned;

  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 1 }}>
      <VideoLibraryIcon fontSize="small" color="action" />
      {loading ? (
        <>
          <CircularProgress size={12} />
          <Typography variant="caption" color="text.secondary">
            {t('recordingHistory.scanning')}
          </Typography>
        </>
      ) : error && !summary ? (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      ) : notScannedYet ? (
        <Typography variant="caption" color="text.secondary">
          {t('recordingHistory.notScanned')}
        </Typography>
      ) : summary ? (
        <Typography variant="caption" color="text.secondary">
          {summary.fileCount === 0
            ? t('recordingHistory.none')
            : t(summary.fileCount === 1 ? 'recordingHistory.summaryOne' : 'recordingHistory.summaryOther', {
                since: summary.earliestStart ? formatSince(summary.earliestStart, locale) : t('recordingHistory.unknown'),
                count: `${summary.fileCount}${summary.truncated ? '+' : ''}`,
              })}
        </Typography>
      ) : (
        <Typography variant="caption" color="text.secondary">
          {t('recordingHistory.unavailable')}
        </Typography>
      )}
      {notScannedYet ? (
        <Button size="small" onClick={refresh} disabled={loading} startIcon={<RefreshIcon sx={{ fontSize: 14 }} />}>
          {t('recordingHistory.scanButton')}
        </Button>
      ) : (
        <Tooltip title={t('recordingHistory.rescanTooltip')}>
          <IconButton aria-label={t('recordingHistory.refreshAria')} size="small" onClick={refresh} disabled={loading}>
            <RefreshIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  );
}

function ChannelCard({
  deviceId,
  channel,
  focused,
  onToggleFocus,
}: {
  deviceId: number;
  channel: Channel;
  focused: boolean;
  onToggleFocus: () => void;
}) {
  const { label, setLabel, dirty, save, isSaving, error } = useChannelLabelEditor(deviceId, channel);
  const { t } = useLocale();
  const track = Number(channel.id) * 100 + 1;
  const displayName = channel.label || channel.name;

  return (
    <Paper sx={{ p: 1.5 }}>
      <SnapshotImage
        deviceId={deviceId}
        track={track}
        alt={`Snapshot of ${displayName}`}
        sx={{ width: '100%', aspectRatio: '4 / 3', borderRadius: 1, mb: 1.5 }}
        focused={focused}
        onToggleFocus={onToggleFocus}
      />
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TextField
          label={t('channel.label')}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && dirty && !isSaving) save();
          }}
          placeholder={channel.name}
          size="small"
          fullWidth
        />
        <IconButton aria-label={t('channel.saveLabelAria')} color="primary" disabled={!dirty || isSaving} onClick={save}>
          <SaveIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
        {t('channel.meta', { id: channel.id, name: channel.name })}
        {channel.ip ? ` · ${channel.ip}` : ''}
      </Typography>
      {channel.online !== null && channel.online !== undefined && (
        <Chip
          size="small"
          label={channel.online ? t('channel.online') : t('channel.offline')}
          color={channel.online ? 'success' : 'default'}
          sx={{ mt: 1 }}
        />
      )}
      <RecordingHistoryLine deviceId={deviceId} channel={channel} />
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
    </Paper>
  );
}

function ChannelListRow({
  deviceId,
  channel,
  focused,
  onToggleFocus,
}: {
  deviceId: number;
  channel: Channel;
  focused: boolean;
  onToggleFocus: () => void;
}) {
  const { label, setLabel, dirty, save, isSaving, error } = useChannelLabelEditor(deviceId, channel);
  const { t } = useLocale();
  const track = Number(channel.id) * 100 + 1;
  const displayName = channel.label || channel.name;

  return (
    <TableRow>
      <TableCell sx={{ width: 88 }}>
        <SnapshotImage
          deviceId={deviceId}
          track={track}
          alt={`Snapshot of ${displayName}`}
          sx={{ width: 72, height: 54, borderRadius: 1 }}
          showRefresh={false}
          focused={focused}
          onToggleFocus={onToggleFocus}
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
          <IconButton aria-label={t('channel.saveLabelAria')} size="small" color="primary" disabled={!dirty || isSaving} onClick={save}>
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
          <Chip
            size="small"
            label={channel.online ? t('channel.online') : t('channel.offline')}
            color={channel.online ? 'success' : 'default'}
          />
        )}
      </TableCell>
      <TableCell sx={{ minWidth: 220 }}>
        <RecordingHistoryLine deviceId={deviceId} channel={channel} />
      </TableCell>
    </TableRow>
  );
}

function ChannelsTab({ id }: { id: number }) {
  const { t } = useLocale();
  const q = useQuery({ queryKey: ['channels', id], queryFn: () => api.channels(id) });
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [search, setSearch] = useState('');
  // Only one camera "in focus" (auto-refreshing its snapshot every second)
  // at a time — polling every camera on the tab that fast would hammer the
  // device for no benefit, since realistically only one is being watched.
  // Clicking the focused camera's own snapshot again clears the selection.
  const [focusedChannelId, setFocusedChannelId] = useState<number | null>(null);

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
          placeholder={t('channels.searchPlaceholder')}
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
          <ToggleButton value="grid" aria-label={t('channels.gridViewAria')}>
            <ViewModuleIcon fontSize="small" />
          </ToggleButton>
          <ToggleButton value="list" aria-label={t('channels.listViewAria')}>
            <ViewListIcon fontSize="small" />
          </ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="body2" color="text.secondary">
          {t(allChannels.length === 1 ? 'channels.countOne' : 'channels.countOther', {
            shown: channels.length,
            total: allChannels.length,
          })}
        </Typography>
      </Stack>

      {allChannels.length === 0 && <Typography color="text.secondary">{t('channels.none')}</Typography>}

      {allChannels.length > 0 && channels.length === 0 && (
        <Typography color="text.secondary">{t('channels.noMatch', { search })}</Typography>
      )}

      {channels.length > 0 && view === 'grid' && (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 2 }}>
          {channels.map((c) => (
            <ChannelCard
              key={c.id}
              deviceId={id}
              channel={c}
              focused={focusedChannelId === Number(c.id)}
              onToggleFocus={() => setFocusedChannelId((prev) => (prev === Number(c.id) ? null : Number(c.id)))}
            />
          ))}
        </Box>
      )}

      {channels.length > 0 && view === 'list' && (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('channels.colSnapshot')}</TableCell>
                <TableCell>{t('channels.colId')}</TableCell>
                <TableCell>{t('channel.label')}</TableCell>
                <TableCell>{t('channels.colDeviceName')}</TableCell>
                <TableCell>{t('channels.colIp')}</TableCell>
                <TableCell>{t('deviceDetail.tabStatus')}</TableCell>
                <TableCell>{t('deviceDetail.tabRecordings')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {channels.map((c) => (
                <ChannelListRow
                  key={c.id}
                  deviceId={id}
                  channel={c}
                  focused={focusedChannelId === Number(c.id)}
                  onToggleFocus={() => setFocusedChannelId((prev) => (prev === Number(c.id) ? null : Number(c.id)))}
                />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );
}

/**
 * Lets the user pick a start/end time, then shows how many recording files
 * were found per channel in that window. The device's search already
 * returns files that merely *overlap* the requested span (see the comment
 * on GET /:id/files server-side), so a boundary like 13:00 as either the
 * start or end still picks up a file that was recording through that
 * moment rather than one that happens to start/end exactly on it.
 *
 * "Download files" hands the same range off to a dedicated page
 * (RecordingFilesPage, a real route so it's back-button/bookmarkable) that
 * lists every matching file individually with its channel name and a
 * generated file name, each with its own download link.
 */
function RecordingsTab({ id }: { id: number }) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const [startInput, setStartInput] = useState('');
  const [endInput, setEndInput] = useState('');
  // No channel pre-selected — the user has to deliberately pick which
  // channels they want before a search is even allowed (see `canSearch`
  // below), rather than defaulting to "every channel" and possibly
  // scanning/downloading far more than intended.
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<number>>(new Set());
  const [range, setRange] = useState<{ start: string; end: string; channelIds: number[] } | null>(null);

  const channelsQuery = useQuery({ queryKey: ['channels', id], queryFn: () => api.channels(id) });
  const allChannels = channelsQuery.data?.channels ?? [];

  const toggleChannel = (channelId: number) => {
    setSelectedChannelIds((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
  };

  const toggleAllChannels = () => {
    setSelectedChannelIds((prev) =>
      (prev?.size ?? 0) === allChannels.length ? new Set() : new Set(allChannels.map((c) => Number(c.id)))
    );
  };

  const q = useQuery({
    queryKey: ['recordings-search', id, range],
    queryFn: () => api.files(id, { start: range!.start, end: range!.end, channels: range!.channelIds }),
    enabled: !!range,
  });

  const selectedCount = selectedChannelIds?.size ?? 0;
  const canSearch = startInput !== '' && endInput !== '' && selectedCount > 0;

  const handleSearch = () => {
    if (!canSearch || !selectedChannelIds) return;
    const start = new Date(startInput);
    const end = new Date(endInput);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    setRange({ start: start.toISOString(), end: end.toISOString(), channelIds: [...selectedChannelIds] });
  };

  const files = q.data?.files ?? [];
  const counts = new Map<string, number>();
  for (const f of files) {
    const key = f.deviceChannelName ?? t('common.unknownChannel');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const handleDownload = () => {
    if (!range) return;
    const qs = new URLSearchParams({ start: range.start, end: range.end, channels: range.channelIds.join(',') });
    navigate(`/devices/${id}/recordings/files?${qs.toString()}`);
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <TextField
          label={t('recordings.start')}
          type="datetime-local"
          size="small"
          value={startInput}
          onChange={(e) => setStartInput(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          label={t('recordings.end')}
          type="datetime-local"
          size="small"
          value={endInput}
          onChange={(e) => setEndInput(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Button variant="contained" size="small" onClick={handleSearch} disabled={!canSearch || q.isFetching}>
          {t('recordings.search')}
        </Button>
      </Stack>

      {allChannels.length > 0 && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="subtitle2">{t('recordings.channelsHeading')}</Typography>
            <Button size="small" onClick={toggleAllChannels}>
              {selectedCount === allChannels.length ? t('recordings.deselectAll') : t('recordings.selectAll')}
            </Button>
            <Typography variant="caption" color="text.secondary">
              {t('recordings.selectedCount', { selected: selectedCount, total: allChannels.length })}
            </Typography>
          </Stack>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {allChannels.map((c) => {
              const channelId = Number(c.id);
              const checked = selectedChannelIds?.has(channelId) ?? false;
              return (
                <Chip
                  key={channelId}
                  size="small"
                  clickable
                  label={c.label || c.name}
                  color={checked ? 'primary' : 'default'}
                  variant={checked ? 'filled' : 'outlined'}
                  onClick={() => toggleChannel(channelId)}
                />
              );
            })}
          </Box>
        </Paper>
      )}

      {q.isFetching && (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            {t('recordings.scanning')}
          </Typography>
        </Stack>
      )}

      {q.isError && <Alert severity="error">{(q.error as Error).message}</Alert>}

      {range && q.isSuccess && (
        <Stack spacing={1.5}>
          <Typography variant="subtitle2">
            {t(files.length === 1 ? 'recordings.foundOne' : 'recordings.foundOther', {
              count: files.length,
              start: formatDateTime(range.start, locale),
              end: formatDateTime(range.end, locale),
            })}
          </Typography>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('recordings.colChannel')}</TableCell>
                  <TableCell align="right">{t('recordings.colFiles')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {[...counts.entries()].map(([channel, count]) => (
                  <TableRow key={channel}>
                    <TableCell>{channel}</TableCell>
                    <TableCell align="right">{count}</TableCell>
                  </TableRow>
                ))}
                {counts.size === 0 && (
                  <TableRow>
                    <TableCell colSpan={2}>
                      <Typography color="text.secondary">{t('recordings.noneInPeriod')}</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <Box>
            <Button
              variant="outlined"
              size="small"
              startIcon={<FileDownloadIcon />}
              onClick={handleDownload}
              disabled={files.length === 0}
            >
              {t('recordings.downloadFiles', { count: files.length })}
            </Button>
          </Box>
        </Stack>
      )}
    </Stack>
  );
}

export default function DeviceDetailPage() {
  const { t } = useLocale();
  const { id } = useParams();
  const deviceId = Number(id);
  const [tab, setTab] = useState(0);

  return (
    <Stack spacing={2}>
      <Box>
        <Link component={RouterLink} to="/" underline="hover">
          {t('deviceDetail.backToDevices')}
        </Link>
      </Box>
      <Typography variant="h5">{t('deviceDetail.title', { id: deviceId })}</Typography>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)}>
        <Tab label={t('deviceDetail.tabStatus')} />
        <Tab label={t('deviceDetail.tabChannels')} />
        <Tab label={t('deviceDetail.tabRecordings')} />
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
