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
    scanned: true,
  };
}

/**
 * Upserts the cached recording-history summary for one channel. Same
 * upsert-on-unique-constraint pattern as setChannelLabel — single atomic
 * statement whether or not a row already exists.
 *
 * Takes the narrower "actually scanned" shape rather than the full
 * (nullable-friendly) RecordingHistorySummary — the DB columns for
 * fileCount/updatedAt are NOT NULL, and the only caller is the code path
 * that just finished a real scan, so those values are always present there.
 * The `scanned: false` placeholder (never-scanned-yet channels) is
 * constructed inline where it's used and never persisted.
 */
export function saveRecordingHistory(
  deviceId: number,
  summary: { channelId: number; earliestStart: string | null; fileCount: number; truncated: boolean; updatedAt: string }
): void {
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
