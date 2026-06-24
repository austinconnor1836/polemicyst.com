import { spawn } from 'child_process';
import path from 'path';
import type { SegmentationProvider, SegmentationResult } from './segmentation-provider';

/**
 * Adapter that drives the Python sidecar at
 * `workers/clip-metadata-worker/tools/segment_video.py`. The script uses
 * MediaPipe SelfieSegmentation + OpenCV to produce a single-channel mask mp4
 * which downstream FFmpeg `alphamerge` can use.
 *
 * Script path is resolved relative to the worker so it works both in dev
 * (running from repo root via `tsx`) and in the Docker container (where the
 * worker is copied to `/app/workers/clip-metadata-worker`). Override via
 * `SEGMENT_VIDEO_SCRIPT` env var if needed.
 */
export class MediaPipeSegmentationAdapter implements SegmentationProvider {
  readonly name = 'mediapipe';

  private resolveScriptPath(): string {
    if (process.env.SEGMENT_VIDEO_SCRIPT) {
      return process.env.SEGMENT_VIDEO_SCRIPT;
    }
    // In the worker container: /app/workers/clip-metadata-worker/tools/segment_video.py
    // In dev:                   <repo>/workers/clip-metadata-worker/tools/segment_video.py
    return path.resolve(process.cwd(), 'workers/clip-metadata-worker/tools/segment_video.py');
  }

  async segmentVideo(inputPath: string, outputPath: string): Promise<SegmentationResult> {
    const script = this.resolveScriptPath();
    const startMs = Date.now();
    const pythonBin = process.env.PYTHON_BIN || 'python3';

    return new Promise<SegmentationResult>((resolve, reject) => {
      const child = spawn(pythonBin, [script, '--input', inputPath, '--output', outputPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderrBuf = '';
      let framesProcessed = 0;

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        stderrBuf += text;
        // Parse progress jsonlines: `{"frames": <n>}` on each line we recognize.
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('{')) continue;
          try {
            const obj = JSON.parse(trimmed);
            if (typeof obj.frames === 'number') framesProcessed = obj.frames;
          } catch {
            // Non-JSON stderr line — fine, ignore.
          }
        }
      });

      child.on('error', (err) => {
        reject(new Error(`segment_video spawn failed: ${err.message}`));
      });

      child.on('close', (code) => {
        const durationMs = Date.now() - startMs;
        if (code === 0) {
          resolve({
            framesProcessed,
            durationMs,
            _cost: { provider: 'mediapipe', estimatedCostUsd: 0 },
          });
        } else {
          reject(new Error(`segment_video exited with code ${code}: ${stderrBuf.slice(-2000)}`));
        }
      });
    });
  }
}
