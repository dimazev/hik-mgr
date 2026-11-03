import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { env } from './env';

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

/** Length (seconds) of each part of a converted video. */
export function segmentSeconds(): number {
  return env.convertSegmentSeconds;
}

/**
 * Runs the fixed "good quality, smaller file" transcode against one downloaded recording and cuts the result into
 * time parts, so each part is small enough to send over WhatsApp: scale to 720p, libx264 crf 26, yuv420p (what
 * phones play), no audio, faststart. The quality is the same as before the split existed - the video is only cut
 * every segmentSeconds(), with a forced keyframe at each cut so every part plays on its own.
 *
 * Writes <outputDir>/<outputPattern> where the pattern has a %03d part number (1-based), e.g. front_converted_001.mp4.
 *
 * `-preset fast` rather than `slow`: much lighter on CPU for a background batch job, at the cost of a slightly
 * larger file at the same quality. The spawned process is also niced down (see os.setPriority below) so a
 * conversion doesn't compete with the rest of the app for CPU.
 *
 * Progress is parsed best-effort from ffmpeg's stderr (`Duration:` once at the start, `time=` throughout) the
 * same way downloadRecording reports download progress - if a future ffmpeg version changes that output format,
 * progress just stays null while the conversion still completes and resolves/rejects normally.
 */
export function convertVideo(
  inputPath: string,
  outputDir: string,
  outputPattern: string,
  onProgress?: (p: ConvertProgress) => void,
  opts: { onProcessStart?: (proc: ChildProcessWithoutNullStreams) => void } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const seconds = segmentSeconds();
    const args = [
      '-y',
      '-i',
      inputPath,
      '-vf',
      'scale=1280:720',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '26',
      '-preset',
      'fast',
      '-an',
      '-force_key_frames',
      `expr:gte(t,n_forced*${seconds})`,
      '-f',
      'segment',
      '-segment_time',
      String(seconds),
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
