import { and, eq } from 'drizzle-orm';
import { db } from './client';
import { channelLabels } from './schema';

/** Returns a Map of channelId -> label for every custom label set on this device. */
export function getLabelsForDevice(deviceId: number): Map<number, string> {
  const rows = db.select().from(channelLabels).where(eq(channelLabels.deviceId, deviceId)).all();
  return new Map(rows.map((r) => [r.channelId, r.label]));
}

/**
 * Sets (or clears, if `label` is empty) the custom label for one channel.
 * Upserts on the (device_id, channel_id) unique constraint rather than a
 * separate exists-check-then-insert-or-update, so this is a single atomic
 * statement either way.
 */
export function setChannelLabel(deviceId: number, channelId: number, label: string): void {
  const trimmed = label.trim();

  if (trimmed === '') {
    db.delete(channelLabels)
      .where(and(eq(channelLabels.deviceId, deviceId), eq(channelLabels.channelId, channelId)))
      .run();
    return;
  }

  db.insert(channelLabels)
    .values({ deviceId, channelId, label: trimmed })
    .onConflictDoUpdate({
      target: [channelLabels.deviceId, channelLabels.channelId],
      set: { label: trimmed, updatedAt: new Date().toISOString() },
    })
    .run();
}
