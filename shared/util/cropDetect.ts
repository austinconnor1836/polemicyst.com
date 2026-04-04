import { spawn } from 'child_process';

export interface CropRect {
  w: number;
  h: number;
  x: number;
  y: number;
}

export interface CropDetectResult {
  sourceAspectRatio: '16:9' | '9:16';
  crop: CropRect | null;
}

/**
 * Detect whether a video contains an embedded video of a different aspect ratio.
 *
 * Uses a two-phase approach:
 * 1. Motion analysis — diff multiple frame pairs to find the region with consistent
 *    pixel changes (the actual playing video vs. static UI/chrome).
 * 2. Edge analysis — find the strongest vertical/horizontal edges flanking the
 *    motion region (the video player boundaries).
 *
 * Works for both black-bar pillarboxing AND screen recordings where the surrounding
 * content is a colored UI (Reddit, browser chrome, etc.).
 *
 * Returns the detected aspect ratio and crop rect to extract the embedded content.
 */
export async function detectSourceAspectRatio(
  filePath: string,
  width: number | null,
  height: number | null
): Promise<CropDetectResult> {
  // Already portrait — no detection needed
  if (width && height && height > width) {
    return { sourceAspectRatio: '9:16', crop: null };
  }

  // If dimensions unknown or video is square, skip detection
  if (!width || !height || width === height) {
    return { sourceAspectRatio: '16:9', crop: null };
  }

  try {
    // Phase 1: Try simple black-bar cropdetect first (fast, handles standard pillarboxing)
    const blackBarResult = await tryBlackBarDetect(filePath, width, height);
    if (blackBarResult) {
      return blackBarResult;
    }

    // Phase 2: Motion + edge analysis (handles screen recordings, colored UIs)
    return await motionEdgeDetect(filePath, width, height);
  } catch (err) {
    console.warn('[cropDetect] Failed, defaulting to 16:9:', err);
    return { sourceAspectRatio: '16:9', crop: null };
  }
}

// ---------------------------------------------------------------------------
// Phase 1: Black-bar cropdetect (fast path)
// ---------------------------------------------------------------------------

async function tryBlackBarDetect(
  filePath: string,
  width: number,
  height: number
): Promise<CropDetectResult | null> {
  const stderr = await runFFmpeg([
    '-i',
    filePath,
    '-vf',
    'fps=1/10,cropdetect=24:16:0',
    '-t',
    '60',
    '-f',
    'null',
    '-',
  ]);

  const crops = parseCropLines(stderr);
  if (crops.length === 0) return null;

  const modeCrop = findModeCrop(crops);

  // Ignore crops that are nearly the full frame
  const widthReduction = (width - modeCrop.w) / width;
  if (widthReduction < 0.1) return null;

  const ratio = modeCrop.w / modeCrop.h;
  if (ratio >= 0.45 && ratio <= 0.65) {
    console.log(
      `[cropDetect] Black-bar detected 9:16 source: crop=${modeCrop.w}:${modeCrop.h}:${modeCrop.x}:${modeCrop.y} (ratio=${ratio.toFixed(3)})`
    );
    return { sourceAspectRatio: '9:16', crop: modeCrop };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Phase 2: Motion + edge analysis
// ---------------------------------------------------------------------------

async function motionEdgeDetect(
  filePath: string,
  width: number,
  height: number
): Promise<CropDetectResult> {
  const noDetection: CropDetectResult = { sourceAspectRatio: '16:9', crop: null };

  // Get video duration to spread samples
  const duration = await getVideoDuration(filePath);
  if (duration < 5) return noDetection;

  // Sample timestamps spread across the video (skip first/last 5%)
  const start = Math.max(1, duration * 0.05);
  const end = duration * 0.95;
  const sampleCount = Math.min(10, Math.floor(duration / 10));
  if (sampleCount < 3) return noDetection;

  const step = (end - start) / sampleCount;
  const timestamps: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    timestamps.push(Math.round(start + i * step));
  }

  // Extract grayscale frames
  const frames = await extractGrayFrames(filePath, width, height, timestamps);
  if (frames.length < 3) return noDetection;

  // --- Motion analysis ---
  const motionCount = new Uint16Array(width * height);
  const motionThreshold = 20;

  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 2; j < frames.length && j <= i + 4; j++) {
      const a = frames[i];
      const b = frames[j];
      for (let p = 0; p < width * height; p++) {
        if (Math.abs(a[p] - b[p]) > motionThreshold) {
          motionCount[p]++;
        }
      }
    }
  }

  // Find pixels with consistent motion (>= 3 frame pairs)
  const minHits = Math.max(2, Math.floor(frames.length / 4));
  const colMotion = new Uint32Array(width);
  const rowMotion = new Uint32Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (motionCount[y * width + x] >= minHits) {
        colMotion[x]++;
        rowMotion[y]++;
      }
    }
  }

  // Find motion bounds (columns/rows with > 5% motion density)
  const colThresh = height * 0.05;
  const rowThresh = width * 0.05;
  let motionX1 = 0,
    motionX2 = width - 1,
    motionY1 = 0,
    motionY2 = height - 1;
  while (motionX1 < width && colMotion[motionX1] < colThresh) motionX1++;
  while (motionX2 > 0 && colMotion[motionX2] < colThresh) motionX2--;
  while (motionY1 < height && rowMotion[motionY1] < rowThresh) motionY1++;
  while (motionY2 > 0 && rowMotion[motionY2] < rowThresh) motionY2--;

  if (motionX1 >= motionX2 || motionY1 >= motionY2) return noDetection;

  const motionCenterX = Math.round((motionX1 + motionX2) / 2);
  const motionCenterY = Math.round((motionY1 + motionY2) / 2);

  console.log(
    `[cropDetect] Motion region: x=${motionX1}–${motionX2}, y=${motionY1}–${motionY2}, center=(${motionCenterX},${motionCenterY})`
  );

  // --- Edge analysis on a frame near the middle ---
  const midFrame = frames[Math.floor(frames.length / 2)];

  // Vertical edge strength per column (detects video player left/right borders)
  const colEdge = new Float32Array(width);
  for (let x = 1; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < height; y++) {
      sum += Math.abs(midFrame[y * width + x] - midFrame[y * width + x - 1]);
    }
    colEdge[x] = sum / height;
  }

  // Horizontal edge strength per row (detects top/bottom borders)
  const rowEdge = new Float32Array(height);
  for (let y = 1; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      sum += Math.abs(midFrame[y * width + x] - midFrame[(y - 1) * width + x]);
    }
    rowEdge[y] = sum / width;
  }

  // Find edge peaks
  const vertPeaks = findEdgePeaks(colEdge, 10, 5.0);
  const horizPeaks = findEdgePeaks(rowEdge, 10, 5.0);

  // --- Combine motion + edges to find video bounds ---
  // Look for strong edges near the OUTER boundaries of the motion region.
  // The video player border should be at or slightly outside where motion starts/stops.
  const margin = width * 0.15;

  // Left edge: strongest edge near/to-the-left of motion left bound
  let leftEdge = motionX1;
  let bestLeftStrength = 0;
  for (const peak of vertPeaks) {
    if (peak.pos >= motionX1 - margin && peak.pos <= motionX1 + width * 0.03) {
      if (peak.strength > bestLeftStrength) {
        bestLeftStrength = peak.strength;
        leftEdge = peak.pos;
      }
    }
  }

  // Right edge: strongest edge near/to-the-right of motion right bound
  let rightEdge = motionX2;
  let bestRightStrength = 0;
  for (const peak of vertPeaks) {
    if (peak.pos >= motionX2 - width * 0.03 && peak.pos <= motionX2 + margin) {
      if (peak.strength > bestRightStrength) {
        bestRightStrength = peak.strength;
        rightEdge = peak.pos;
      }
    }
  }

  // Top edge: strongest edge near/above motion top bound
  const vMargin = height * 0.15;
  let topEdge = motionY1;
  let bestTopStrength = 0;
  for (const peak of horizPeaks) {
    if (peak.pos >= motionY1 - vMargin && peak.pos <= motionY1 + height * 0.03) {
      if (peak.strength > bestTopStrength) {
        bestTopStrength = peak.strength;
        topEdge = peak.pos;
      }
    }
  }

  // Bottom edge: strongest edge near/below motion bottom bound
  let bottomEdge = motionY2;
  let bestBottomStrength = 0;
  for (const peak of horizPeaks) {
    if (peak.pos >= motionY2 - height * 0.03 && peak.pos <= motionY2 + vMargin) {
      if (peak.strength > bestBottomStrength) {
        bestBottomStrength = peak.strength;
        bottomEdge = peak.pos;
      }
    }
  }

  const regionW = rightEdge - leftEdge;
  if (regionW < width * 0.15) return noDetection;

  // Use left/right edges for width, then compare against FULL FRAME HEIGHT
  // to determine aspect ratio. Vertical edges (top/bottom) within the video
  // are unreliable because text overlays and static backgrounds create false edges.
  const widthToFrameRatio = regionW / height;

  console.log(
    `[cropDetect] Edge-bounded width: x=${leftEdge}–${rightEdge} (${regionW}px), width/frameH=${widthToFrameRatio.toFixed(3)}`
  );

  // Portrait content: width relative to frame height is ~9:16 (0.5625)
  // Accept 0.35–0.75 to handle varying amounts of chrome/padding
  if (widthToFrameRatio >= 0.35 && widthToFrameRatio <= 0.75) {
    // Fit a 9:16 crop. Use the detected width, compute matching height.
    const targetH = roundEven(regionW * (16 / 9));
    // Center vertically on the motion region, clamped to frame
    const centerY = Math.round((motionY1 + motionY2) / 2);
    const cropY = clamp(centerY - Math.round(targetH / 2), 0, height - targetH);
    const cropX = clamp(leftEdge, 0, width - regionW);
    const crop: CropRect = { w: roundEven(regionW), h: targetH, x: roundEven(cropX), y: cropY };

    console.log(
      `[cropDetect] Detected 9:16 source via motion+edge: crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`
    );
    return { sourceAspectRatio: '9:16', crop };
  }

  // Landscape content: check top/bottom edges for embedded landscape video
  const regionH = bottomEdge - topEdge;
  if (regionH > height * 0.15) {
    const regionRatio = regionW / regionH;
    if (regionRatio >= 1.4 && regionRatio <= 2.2 && regionW < width * 0.8) {
      const targetH = roundEven(regionW * (9 / 16));
      const centerY = Math.round((topEdge + bottomEdge) / 2);
      const cropY = clamp(centerY - Math.round(targetH / 2), 0, height - targetH);
      const cropX = clamp(leftEdge, 0, width - regionW);
      const crop: CropRect = { w: regionW, h: targetH, x: cropX, y: cropY };

      console.log(
        `[cropDetect] Detected 16:9 source via motion+edge: crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`
      );
      return { sourceAspectRatio: '16:9', crop };
    }
  }

  return noDetection;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runFFmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code: number | null) => {
      if (code === 0 || stderr.length > 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited ${code}`));
    });
  });
}

/**
 * Extract grayscale frames at specific timestamps using raw pixel output.
 */
async function extractGrayFrames(
  filePath: string,
  width: number,
  height: number,
  timestamps: number[]
): Promise<Buffer[]> {
  const frames: Buffer[] = [];
  const pixelCount = width * height;

  for (const t of timestamps) {
    try {
      const buf = await new Promise<Buffer>((resolve, reject) => {
        const args = [
          '-ss',
          t.toFixed(1),
          '-i',
          filePath,
          '-vf',
          'format=gray',
          '-frames:v',
          '1',
          '-f',
          'rawvideo',
          '-',
        ];
        const proc = spawn('ffmpeg', args);
        const chunks: Buffer[] = [];
        proc.stdout.on('data', (d: Buffer) => chunks.push(d));
        proc.on('error', reject);
        proc.on('close', (code: number | null) => {
          const data = Buffer.concat(chunks);
          if (data.length === pixelCount) resolve(data);
          else
            reject(new Error(`Frame at t=${t}: expected ${pixelCount} bytes, got ${data.length}`));
        });
      });
      frames.push(buf);
    } catch {
      // Skip frames that fail to extract (e.g., past end of video)
    }
  }

  return frames;
}

async function getVideoDuration(filePath: string): Promise<number> {
  const stderr = await runFFmpeg(['-i', filePath, '-f', 'null', '-t', '0', '-']);
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
  if (!match) return 0;
  return (
    parseInt(match[1]) * 3600 +
    parseInt(match[2]) * 60 +
    parseInt(match[3]) +
    parseInt(match[4]) / 100
  );
}

function parseCropLines(stderr: string): CropRect[] {
  const crops: CropRect[] = [];
  const regex = /crop=(\d+):(\d+):(\d+):(\d+)/g;
  let match;
  while ((match = regex.exec(stderr)) !== null) {
    crops.push({
      w: parseInt(match[1], 10),
      h: parseInt(match[2], 10),
      x: parseInt(match[3], 10),
      y: parseInt(match[4], 10),
    });
  }
  return crops;
}

function findModeCrop(crops: CropRect[]): CropRect {
  const counts = new Map<string, { count: number; crop: CropRect }>();
  for (const crop of crops) {
    const key = `${crop.w}:${crop.h}`;
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { count: 1, crop });
  }
  let best = { count: 0, crop: crops[0] };
  for (const entry of counts.values()) {
    if (entry.count > best.count) best = entry;
  }
  return best.crop;
}

interface EdgePeak {
  pos: number;
  strength: number;
}

/**
 * Find local peaks in an edge strength array.
 * Deduplicates peaks within `minDist` of each other, keeping the strongest.
 */
function findEdgePeaks(arr: Float32Array, minDist: number, minStrength: number): EdgePeak[] {
  const raw: EdgePeak[] = [];
  for (let i = 3; i < arr.length - 3; i++) {
    const avg = (arr[i - 2] + arr[i - 1] + arr[i + 1] + arr[i + 2]) / 4;
    if (arr[i] > avg * 1.5 && arr[i] > minStrength) {
      raw.push({ pos: i, strength: arr[i] });
    }
  }

  // Deduplicate nearby peaks
  const peaks: EdgePeak[] = [];
  for (const p of raw) {
    if (peaks.length === 0 || p.pos - peaks[peaks.length - 1].pos > minDist) {
      peaks.push(p);
    } else if (p.strength > peaks[peaks.length - 1].strength) {
      peaks[peaks.length - 1] = p;
    }
  }

  return peaks;
}

function roundEven(n: number): number {
  return Math.round(n / 2) * 2;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
