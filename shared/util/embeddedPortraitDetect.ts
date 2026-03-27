import { spawn } from 'child_process';

export interface EmbeddedPortraitResult {
  detected: boolean;
  /** X offset of the content area within the full frame */
  cropX: number;
  /** Y offset of the content area within the full frame */
  cropY: number;
  /** Width of the detected content area */
  cropW: number;
  /** Height of the detected content area */
  cropH: number;
}

/**
 * Detect whether a landscape-container video has an embedded portrait video
 * (i.e. a portrait-aspect video with black sidebars making the file 16:9).
 *
 * Uses ffmpeg's cropdetect filter to sample frames at multiple timestamps,
 * finds the consensus crop region, then checks if that region is portrait.
 *
 * @param inputPath Local file path or HTTP(S) URL to the video
 * @param videoWidth  Display width of the video (rotation-corrected)
 * @param videoHeight Display height of the video (rotation-corrected)
 * @param durationS   Duration in seconds
 * @returns Detection result with crop coordinates, or detected=false
 */
export async function detectEmbeddedPortrait(
  inputPath: string,
  videoWidth: number,
  videoHeight: number,
  durationS: number
): Promise<EmbeddedPortraitResult> {
  const noDetection: EmbeddedPortraitResult = {
    detected: false,
    cropX: 0,
    cropY: 0,
    cropW: videoWidth,
    cropH: videoHeight,
  };

  if (videoHeight >= videoWidth) {
    return noDetection;
  }

  // Sample 5 evenly-spaced frames, avoiding the first/last 5%
  const sampleCount = 5;
  const startFraction = 0.05;
  const endFraction = 0.95;
  const sampleTimestamps: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const frac = startFraction + (endFraction - startFraction) * (i / (sampleCount - 1));
    sampleTimestamps.push(Math.max(0.5, frac * durationS));
  }

  const cropLines = await runCropdetect(inputPath, sampleTimestamps);
  if (cropLines.length === 0) {
    return noDetection;
  }

  const crops = parseCropLines(cropLines);
  if (crops.length === 0) {
    return noDetection;
  }

  const consensus = computeConsensusCrop(crops);
  if (!consensus) {
    return noDetection;
  }

  // The content region must be meaningfully narrower than the frame
  // (at least 10% narrower on each side combined)
  const widthReduction = (videoWidth - consensus.w) / videoWidth;
  if (widthReduction < 0.15) {
    return noDetection;
  }

  // The detected content must be portrait (taller than wide)
  if (consensus.h <= consensus.w) {
    return noDetection;
  }

  return {
    detected: true,
    cropX: consensus.x,
    cropY: consensus.y,
    cropW: consensus.w,
    cropH: consensus.h,
  };
}

interface CropRect {
  w: number;
  h: number;
  x: number;
  y: number;
}

function runCropdetect(inputPath: string, timestamps: number[]): Promise<string[]> {
  return new Promise((resolve) => {
    // Build a select filter that picks specific frames by timestamp.
    // We seek to each timestamp and run cropdetect on one frame per seek.
    // Using multiple -ss seeks is more reliable than select filter for network URLs.
    const cropLines: string[] = [];
    let pending = timestamps.length;

    if (pending === 0) {
      resolve([]);
      return;
    }

    for (const ts of timestamps) {
      const args = [
        '-ss',
        ts.toFixed(2),
        '-i',
        inputPath,
        '-vframes',
        '5',
        '-vf',
        'cropdetect=round=2:limit=24',
        '-f',
        'null',
        '-',
      ];

      const proc = spawn('ffmpeg', args);
      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      proc.stdout.on('data', () => {});
      proc.on('close', () => {
        const lines = stderr.split('\n').filter((l) => l.includes('crop='));
        cropLines.push(...lines);
        pending--;
        if (pending === 0) {
          resolve(cropLines);
        }
      });
      proc.on('error', () => {
        pending--;
        if (pending === 0) {
          resolve(cropLines);
        }
      });
    }
  });
}

function parseCropLines(lines: string[]): CropRect[] {
  const results: CropRect[] = [];
  const cropRegex = /crop=(\d+):(\d+):(\d+):(\d+)/;

  for (const line of lines) {
    const match = cropRegex.exec(line);
    if (match) {
      results.push({
        w: parseInt(match[1], 10),
        h: parseInt(match[2], 10),
        x: parseInt(match[3], 10),
        y: parseInt(match[4], 10),
      });
    }
  }
  return results;
}

/**
 * Compute a consensus crop from multiple samples.
 * Uses the median of all crop values, which is robust against
 * scene-change frames or credits that might have different crops.
 */
function computeConsensusCrop(crops: CropRect[]): CropRect | null {
  if (crops.length === 0) return null;

  const median = (arr: number[]): number => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  };

  const w = median(crops.map((c) => c.w));
  const h = median(crops.map((c) => c.h));
  const x = median(crops.map((c) => c.x));
  const y = median(crops.map((c) => c.y));

  // Ensure even values for ffmpeg compatibility
  return {
    w: w % 2 === 0 ? w : w - 1,
    h: h % 2 === 0 ? h : h - 1,
    x: x % 2 === 0 ? x : x - 1,
    y: y % 2 === 0 ? y : y - 1,
  };
}
