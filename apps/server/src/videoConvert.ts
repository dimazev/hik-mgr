import os from 'node:os';
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
 * Runs the fixed "good quality, smaller file" transcode against one
 * downloaded recording: scale to 720p, libx264 crf 26, strip audio,
 * faststart for web playback. Originally requested as:
 *   ffmpeg -i <in> -vf "scale=1280:720" -c:v libx264 -crf 26 -preset slow
 *          -an -movflags +faststart <out>
 * `-preset slow` is libx264's slowest, most CPU-intensive software-encode
 * setting — noticeable server-wide CPU usage while a task's conversion
 * subtask is running traced back to this. Switched to `-preset fast`:
 * meaningfully lighter on CPU, same `-crf 26` (so still constant-quality,
 * just a somewhat larger file for the same quality — a fine tradeoff for
 * a background batch job, unlike a one-off encode where `slow` earns its
 * cost). The spawned process is also niced down (see os.setPriority below)
 * so a conversion doesn't compete with the rest of the app for CPU even
 * while it's happening.
 *
 * Progress is parsed best-effort from ffmpeg's stderr (`Duration:` once at
 * the start, `time=` throughout) the same way downloadRecording reports
 * download progress — if a future ffmpeg version changes that output
 * format, progress just stays null while the conversion still completes
 * and resolves/rejects normally.
 */
export function convertVideo(
  inputPath: string,
  outputPath: string,
  onProgress?: (p: ConvertProgress) => void,
  opts: { onProcessStart?: (proc: ChildProcessWithoutNullStreams) => void } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i',
      inputPath,
      '-vf',
      'scale=1280:720',
      '-c:v',
      'libx264',
      '-crf',
      '26',
      '-preset',
      'fast',
      '-an',
      '-movflags',
      '+faststart',
      outputPath,
    ];

    const proc = spawn('ffmpeg', args);
    // Lower scheduling priority (higher niceness) so a conversion — which
    // can run for a while on a slower device/CPU — doesn't starve the
    // rest of the app (API requests, other downloads) of CPU time. Not
    // every platform/permission level allows this; it's a nice-to-have,
    // not required for correctness, so a failure here is swallowed.
    try {
      if (proc.pid) os.setPriority(proc.pid, 10);
    } catch {
      // Ignored — ffmpeg just runs at normal priority instead.
    }
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

    // Most commonly ENOENT — ffmpeg isn't installed / not on PATH. Surfaced
    // to the caller as a rejected promise either way.
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
