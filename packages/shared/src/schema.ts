import { z } from 'zod';

/**
 * Input schema for creating/updating a managed Hikvision device.
 * `password` is only ever accepted here (write side) — it's encrypted at
 * rest server-side and never returned by the API (see the `Device`
 * interface below, which deliberately has no password field).
 */
export const deviceInputSchema = z.object({
  name: z.string().min(1, 'name is required').max(200),
  host: z.string().min(1, 'host is required').max(255),
  port: z.coerce.number().int().min(1).max(65535).default(80),
  protocol: z.enum(['http', 'https']).default('http'),
  username: z.string().min(1).max(100).default('admin'),
  password: z.string().min(1, 'password is required').max(500),
});

export type DeviceInput = z.infer<typeof deviceInputSchema>;

/** Same as deviceInputSchema but every field optional, for PATCH/PUT updates. */
export const deviceUpdateSchema = deviceInputSchema.partial();
export type DeviceUpdateInput = z.infer<typeof deviceUpdateSchema>;

/** Device as returned by the API — never includes the password. */
export interface Device {
  id: number;
  name: string;
  host: string;
  port: number;
  protocol: 'http' | 'https';
  username: string;
  createdAt: string;
}

export interface Channel {
  id: number;
  /** Name as reported by the device — not editable, this app can't rename it on the device itself. */
  name: string;
  ip?: string | null;
  online?: boolean | null;
  /** User-set override, stored locally (see channel_labels table). Null if never set — fall back to `name` for display. */
  label?: string | null;
}

/** Body for PUT /api/devices/:id/channels/:channelId/label */
export const channelLabelInputSchema = z.object({
  // Empty string clears the custom label (falls back to the device's own
  // channel name again) rather than storing an empty label forever.
  label: z.string().max(200),
});
export type ChannelLabelInput = z.infer<typeof channelLabelInputSchema>;

export interface RecordingFile {
  trackID: number;
  startTime?: string;
  endTime?: string;
  playbackURI: string;
  contentType?: string;
  sizeBytes?: number;
  deviceChannelName?: string | null;
}

export interface DeviceStatus {
  raw: unknown;
}

/**
 * Cached summary of a channel's recording history — how far back its
 * recordings go and how many files were found — computed by scanning the
 * device (which can be slow) and cached in recording_history so subsequent
 * loads are instant. See GET /:id/channels/:channelId/recording-history.
 */
export interface RecordingHistorySummary {
  channelId: number;
  /** Earliest recording start time found, or null if the channel has no recordings. */
  earliestStart: string | null;
  /** Number of recording files found (capped by the scan's maxResults — see `truncated`). */
  fileCount: number;
  /** True if the scan hit its result cap and there may be more/older recordings than counted. */
  truncated: boolean;
  /** When this summary was last computed. */
  updatedAt: string;
}
