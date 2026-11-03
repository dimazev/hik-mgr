import fs from 'node:fs';
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

function convertedBase(originalFilename: string): string {
  const safe = sanitizeFilename(originalFilename);
  return path.basename(safe, path.extname(safe) || '.mp4');
}

/** ffmpeg segment-muxer pattern for the parts of one converted file: <base>_converted_001.mp4, _002, ... */
export function convertedPartPattern(originalFilename: string): string {
  return `${convertedBase(originalFilename)}_converted_%03d.mp4`;
}

/** File name of part `part` (1-based) of a converted file. */
export function convertedPartFilename(originalFilename: string, part: number): string {
  return `${convertedBase(originalFilename)}_converted_${String(part).padStart(3, '0')}.mp4`;
}

/** The parts of a converted file that exist in `dir`, in order (empty when there are none). */
export function listConvertedParts(dir: string, originalFilename: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const re = new RegExp(`^${convertedBase(originalFilename).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_converted_\\d{3}\\.mp4$`);
  return fs.readdirSync(dir).filter((name) => re.test(name)).sort();
}

/**
 * The single-file name converted videos had before they were split into parts. Tasks converted back then
 * (convertParts = null) still have it on disk.
 */
export function convertedFilename(originalFilename: string): string {
  const safe = sanitizeFilename(originalFilename);
  const ext = path.extname(safe) || '.mp4';
  const base = path.basename(safe, ext);
  return `${base}_converted${ext}`;
}
