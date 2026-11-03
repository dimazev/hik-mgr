import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface ConvertProgress {
  percent: number | null;
  elapsedSeconds: number | null;
  totalSeconds: number | null;
}

const DURATION_RE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;
const TIME_RE = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/;

function toSeconds(h: string, m: string, s: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/**
 * Lower scheduling priority (higher niceness) so a long ffmpeg run doesn't starve the rest of the app (API requests,
 * other downloads) of CPU time. Not every platform/permission level allows this; it's a nice-to-have, so a failure
 * is swallowed.
 */
function niceDown(proc: ChildProcessWithoutNullStreams): void {
  try {
    if (proc.pid) os.setPriority(proc.pid, 10);
  } catch {
    // Ignored - ffmpeg just runs at normal priority instead.
  }
}

/**
 * Runs the fixed "good quality, smaller file" transcode against one downloaded recording: scale to 720p, libx264
 * crf 26, strip audio, faststart for web playback. Originally requested as:
 *   ffmpeg -i <in> -vf "scale=1280:720" -c:v libx264 -crf 26 -preset slow
 *          -an -movflags +faststart <out>
 * `-preset slow` is libx264's slowest, most CPU-intensive software-encode setting - noticeable server-wide CPU
 * usage while a task's conversion subtask is running traced back to this. Switched to `-preset fast`: meaningfully
 * lighter on CPU, same `-crf 26` (so still constant-quality, just a somewhat larger file for the same quality - a
 * fine tradeoff for a background batch job, unlike a one-off encode where `slow` earns its cost). The spawned
 * process is also niced down so a conversion doesn't compete with the rest of the app for CPU.
 *
 * Progress is parsed best-effort from ffmpeg's stderr (`Duration:` once at the start, `time=` throughout) the same
 * way downloadRecording reports download progress - if a future ffmpeg version changes that output format, progress
 * just stays null while the conversion still completes and resolves/rejects normally.
 */
export function convertVideo(
  inputPath: string,
  outputPath: string,
  onProgress?: (p: ConvertProgress) => void,
  opts: { onProcessStart?: (proc: ChildProcessWithoutNullStreams) => void } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['-y', '-i', inputPath, '-vf', 'scale=1280:720', '-c:v', 'libx264', '-crf', '26', '-preset', 'fast', '-an', '-movflags', '+faststart', outputPath];

    const proc = spawn('ffmpeg', args);
    niceDown(proc);
    opts.onProcessStart?.(proc);

    let totalSeconds: number | null = null;
    let durationBuffer = '';

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();

      if (totalSeconds === null) {
        durationBuffer += text;
        const durMatch = DURATION_RE.exec(durationBuffer);
        if (durMatch) totalSeconds = toSeconds(durMatch[1], durMatch[2], durMatch[3]);
      }

      const timeMatch = TIME_RE.exec(text);
      if (timeMatch && onProgress) {
        const elapsedSeconds = toSeconds(timeMatch[1], timeMatch[2], timeMatch[3]);
        onProgress({
          elapsedSeconds,
          totalSeconds,
          percent: totalSeconds ? Math.min(100, (elapsedSeconds / totalSeconds) * 100) : null,
        });
      }
    });

    // Most commonly ENOENT - ffmpeg isn't installed / not on PATH. Surfaced to the caller as a rejected promise either way.
    proc.on('error', reject);
    proc.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(signal ? `ffmpeg was terminated (${signal})` : `ffmpeg exited with code ${code}`));
    });
  });
}

/** Length of a video file in seconds (read from ffmpeg's own banner, so no separate ffprobe is needed). */
export function probeDuration(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    // `ffmpeg -i <file>` with no output prints the banner (with Duration) and exits with an error - that is expected.
    const proc = spawn('ffmpeg', ['-hide_banner', '-i', filePath]);
    let out = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      const m = DURATION_RE.exec(out);
      resolve(m ? toSeconds(m[1], m[2], m[3]) : null);
    });
  });
}

/** How many equal parts a file of `sizeBytes` must be cut into so each stays under `maxBytes` (1 = no split needed). */
export function partsNeeded(sizeBytes: number, maxBytes: number): number {
  if (sizeBytes <= maxBytes) return 1;
  // 10% headroom: the cuts can only fall on keyframes, so the parts are not exactly equal
  return Math.ceil(sizeBytes / (maxBytes * 0.9));
}

/**
 * Cuts an already converted video into `parts` pieces of about equal length WITHOUT re-encoding (stream copy), so the
 * quality is untouched and it takes seconds. Cuts land on keyframes; each piece plays on its own. Writes
 * <outputDir>/<outputPattern>, where the pattern has a %03d part number (1-based).
 */
export function splitVideo(inputPath: string, outputDir: string, outputPattern: string, durationSeconds: number, parts: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // duration / parts, rounded up a hair so the last piece does not become an extra tiny part. ffmpeg measures the
    // cut points from the start (n x this), so a cut that lands late on a keyframe does not push the later ones.
    const segmentSeconds = Math.ceil((durationSeconds / parts) * 100) / 100;
    const args = [
      '-y',
      '-i',
      inputPath,
      '-c',
      'copy',
      '-f',
      'segment',
      '-segment_time',
      String(segmentSeconds),
      '-segment_start_number',
      '1',
      '-reset_timestamps',
      '1',
      '-segment_format',
      'mp4',
      '-segment_format_options',
      'movflags=+faststart',
      path.join(outputDir, outputPattern),
    ];
    const proc = spawn('ffmpeg', args);
    niceDown(proc);
    proc.on('error', reject);
    proc.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(signal ? `ffmpeg was terminated (${signal})` : `ffmpeg exited with code ${code} while splitting`));
    });
  });
}
