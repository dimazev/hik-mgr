import type {
  Device,
  DeviceInput,
  Channel,
  RecordingFile,
  RecordingHistorySummary,
  DownloadTask,
  DownloadTaskDetail,
  DownloadTaskFileInput,
} from '@hik-mgr/shared';

// Fired whenever any request comes back 401 (session missing/expired) so
// App.tsx can drop back to the login page without every page needing its
// own "am I still logged in?" plumbing — see the listener in App.tsx.
const AUTH_EXPIRED_EVENT = 'hik-mgr:auth-expired';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (res.status === 401) {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      typeof body?.error === 'string' ? body.error : body?.error ? JSON.stringify(body.error) : `Request failed: ${res.status}`;
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listDevices: () => request<Device[]>('/api/devices'),
  createDevice: (input: DeviceInput) =>
    request<Device>('/api/devices', { method: 'POST', body: JSON.stringify(input) }),
  updateDevice: (id: number, input: Partial<DeviceInput>) =>
    request<Device>(`/api/devices/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteDevice: (id: number) => request<void>(`/api/devices/${id}`, { method: 'DELETE' }),
  status: (id: number) => request<{ status: unknown; info: unknown }>(`/api/devices/${id}/status`),
  channels: (id: number) => request<{ source: string; channels: Channel[] }>(`/api/devices/${id}/channels`),
  updateChannelLabel: (deviceId: number, channelId: number, label: string) =>
    request<{ channelId: number; label: string | null }>(`/api/devices/${deviceId}/channels/${channelId}/label`, {
      method: 'PUT',
      body: JSON.stringify({ label }),
    }),
  // Cached summary (earliest recording + file count) — a cheap cache read
  // unless `refresh` is set, in which case the server does a fresh (slow)
  // scan of the device's recording index before returning.
  recordingHistory: (deviceId: number, channelId: number, refresh = false) =>
    request<RecordingHistorySummary>(
      `/api/devices/${deviceId}/channels/${channelId}/recording-history${refresh ? '?refresh=1' : ''}`
    ),
  files: (id: number, params: { track?: number; start?: string; end?: string; max?: number; channels?: number[] } = {}) => {
    const qs = new URLSearchParams();
    if (params.track) qs.set('track', String(params.track));
    if (params.start) qs.set('start', params.start);
    if (params.end) qs.set('end', params.end);
    if (params.max) qs.set('max', String(params.max));
    if (params.channels && params.channels.length > 0) qs.set('channels', params.channels.join(','));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ numOfMatches: number; files: RecordingFile[] }>(`/api/devices/${id}/files${suffix}`);
  },
  downloadUrl: (id: number, playbackURI: string, filename?: string) => {
    const qs = new URLSearchParams({ uri: playbackURI });
    if (filename) qs.set('filename', filename);
    return `/api/devices/${id}/download?${qs.toString()}`;
  },
  // Queues a background, file-by-file download task instead of streaming a
  // single recording straight to the browser — see the Recordings tab /
  // recording files page's single "Download" button, and TasksPage for
  // tracking progress afterward.
  createDownloadTask: (deviceId: number, files: DownloadTaskFileInput[]) =>
    request<{ taskId: number }>(`/api/devices/${deviceId}/download-tasks`, {
      method: 'POST',
      body: JSON.stringify({ files }),
    }),
  listDownloadTasks: () => request<DownloadTask[]>('/api/tasks'),
  getDownloadTask: (taskId: number) => request<DownloadTaskDetail>(`/api/tasks/${taskId}`),
  cancelTask: (taskId: number) => request<{ ok: true }>(`/api/tasks/${taskId}/cancel`, { method: 'POST' }),
  resumeTask: (taskId: number) => request<{ ok: true }>(`/api/tasks/${taskId}/resume`, { method: 'POST' }),
  // Only valid once a file's conversion subtask is 'done' — streams the
  // ffmpeg-converted copy as a real browser download (the raw downloaded
  // file itself stays server-side).
  convertedFileDownloadUrl: (taskId: number, fileId: number) => `/api/tasks/${taskId}/files/${fileId}/download`,
  snapshotUrl: (id: number, track?: number) => {
    const qs = new URLSearchParams({ t: String(Date.now()) });
    if (track) qs.set('track', String(track));
    return `/api/devices/${id}/snapshot?${qs.toString()}`;
  },
  // A continuous MJPEG feed — meant to be used directly as an <img> src
  // (see CameraViewPage), not fetched via `request()` like everything else
  // here. No cache-busting query param needed (unlike snapshotUrl): this
  // is one long-lived streaming request, not a series of one-shot fetches
  // a browser might cache.
  streamUrl: (id: number, track?: number) => {
    const qs = new URLSearchParams();
    if (track) qs.set('track', String(track));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return `/api/devices/${id}/stream${suffix}`;
  },
  auth: {
    // Deliberately doesn't go through request() — a 401 here just means
    // "not logged in yet", the normal/expected state on first load, not
    // an error worth throwing or firing AUTH_EXPIRED_EVENT for (App.tsx's
    // listener would otherwise fire immediately on every fresh page load).
    me: async (): Promise<{ username: string } | null> => {
      const res = await fetch('/api/auth/me');
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return res.json();
    },
    login: (username: string, password: string) =>
      request<{ username: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  },
};
