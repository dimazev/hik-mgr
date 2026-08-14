import { and, eq } from 'drizzle-orm';
import type { RecordingHistorySummary } from '@hik-mgr/shared';
import { db } from './client';
import { recordingHistory } from './schema';

/** Returns the cached recording-history summary for a channel, if one has been computed yet. */
export function getRecordingHistory(deviceId: number, channelId: number): RecordingHistorySummary | undefined {
  const row = db
    .select()
    .from(recordingHistory)
    .where(and(eq(recordingHistory.deviceId, deviceId), eq(recordingHistory.channelId, channelId)))
    .get();

  if (!row) return undefined;

  return {
    channelId: row.channelId,
    earliestStart: row.earliestStart,
    fileCount: row.fileCount,
    truncated: !!row.truncated,
    updatedAt: row.updatedAt,
  };
}

/**
 * Upserts the cached recording-history summary for one channel. Same
 * upsert-on-unique-constraint pattern as setChannelLabel — single atomic
 * statement whether or not a row already exists.
 */
export function saveRecordingHistory(deviceId: number, summary: RecordingHistorySummary): void {
  const updatedAt = summary.updatedAt;

  db.insert(recordingHistory)
    .values({
      deviceId,
      channelId: summary.channelId,
      earliestStart: summary.earliestStart,
      fileCount: summary.fileCount,
      truncated: summary.truncated ? 1 : 0,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [recordingHistory.deviceId, recordingHistory.channelId],
      set: {
        earliestStart: summary.earliestStart,
        fileCount: summary.fileCount,
        truncated: summary.truncated ? 1 : 0,
        updatedAt,
      },
    })
    .run();
}
