import type { Device, DeviceInput, Channel, RecordingFile } from '@hik-mgr/shared';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ? JSON.stringify(body.error) : `Request failed: ${res.status}`);
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
  files: (id: number, params: { track?: number; start?: string; end?: string; max?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.track) qs.set('track', String(params.track));
    if (params.start) qs.set('start', params.start);
    if (params.end) qs.set('end', params.end);
    if (params.max) qs.set('max', String(params.max));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ numOfMatches: number; files: RecordingFile[] }>(`/api/devices/${id}/files${suffix}`);
  },
  downloadUrl: (id: number, playbackURI: string) =>
    `/api/devices/${id}/download?uri=${encodeURIComponent(playbackURI)}`,
  snapshotUrl: (id: number, track?: number) => {
    const qs = new URLSearchParams({ t: String(Date.now()) });
    if (track) qs.set('track', String(track));
    return `/api/devices/${id}/snapshot?${qs.toString()}`;
  },
};
