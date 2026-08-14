import path from 'node:path';

/**
 * Shared between downloadWorker (naming the raw downloaded file),
 * videoConvert (naming the transcoded file), and api/tasks.ts's converted
 * file download route — all three need to land on the exact same on-disk
 * name for a given task file without passing paths back and forth, so
 * this is the single source of truth for that naming.
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 150) || 'file';
}

/** The transcoded/converted counterpart of a (sanitized) downloaded file's name. */
export function convertedFilename(originalFilename: string): string {
  const safe = sanitizeFilename(originalFilename);
  const ext = path.extname(safe) || '.mp4';
  const base = path.basename(safe, ext);
  return `${base}_converted${ext}`;
}
