/**
 * Browser-side video content region detection.
 *
 * Uses motion analysis (frame differencing) + edge detection to find an
 * embedded video within a screen recording or pillarboxed frame.
 * Works for both black-bar pillarboxing and colored UI surrounds.
 *
 * Falls back to edge-only analysis when motion detection fails (e.g.,
 * when the browser doesn't seek properly on detached video elements).
 */

export interface ClientCropRect {
  w: number;
  h: number;
  x: number;
  y: number;
}

/**
 * Detect if a video element contains an embedded video of a different aspect ratio.
 *
 * Captures multiple frames at different timestamps, diffs them to find the region
 * with consistent motion (the actual video content), then uses edge analysis to
 * find the video player boundaries.
 *
 * Returns the crop rect if embedded content is detected, null otherwise.
 */
export async function detectCropFromVideo(
  video: HTMLVideoElement,
  width: number,
  height: number
): Promise<ClientCropRect | null> {
  // Only check landscape videos
  if (height >= width) {
    console.log('[detectCropFromVideo] Skipping: not landscape', { width, height });
    return null;
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      console.log('[detectCropFromVideo] Failed to get canvas context');
      return null;
    }

    // Add video to DOM hidden to ensure browser initializes media pipeline
    video.style.position = 'fixed';
    video.style.left = '-9999px';
    video.style.top = '-9999px';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    document.body.appendChild(video);

    try {
      // Wait for video to be loadable
      await waitForVideo(video);

      const duration = video.duration || 0;
      console.log('[detectCropFromVideo] Video loaded:', {
        duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
        canvasSize: `${width}x${height}`,
      });
      if (duration < 5) {
        console.log('[detectCropFromVideo] Skipping: duration too short', duration);
        return null;
      }

      // Force decoder initialization by briefly playing
      video.muted = true;
      try {
        await video.play();
        video.pause();
      } catch {
        // play() may fail due to autoplay policy, that's ok
      }

      // Sample ~6 frames spread across the video (skip first/last 10%)
      const start = duration * 0.1;
      const end = duration * 0.9;
      const count = Math.min(6, Math.floor(duration / 5));
      if (count < 3) {
        console.log('[detectCropFromVideo] Skipping: not enough sample points', {
          count,
          duration,
        });
        return null;
      }

      const step = (end - start) / count;
      const grayFrames: Uint8Array[] = [];

      for (let i = 0; i < count; i++) {
        const t = start + i * step;
        try {
          await seekVideo(video, t);
          ctx.drawImage(video, 0, 0, width, height);
          const imageData = ctx.getImageData(0, 0, width, height);
          grayFrames.push(toGrayscale(imageData.data, width, height));
        } catch {
          // Skip frames that fail to seek
        }
      }

      console.log(`[detectCropFromVideo] Captured ${grayFrames.length}/${count} frames`);
      if (grayFrames.length < 2) {
        console.log('[detectCropFromVideo] Skipping: too few frames captured');
        return null;
      }

      // Verify frames are actually different (detect broken seeking)
      let totalDiff = 0;
      const firstFrame = grayFrames[0];
      const lastFrame = grayFrames[grayFrames.length - 1];
      for (let p = 0; p < width * height; p++) {
        totalDiff += Math.abs(firstFrame[p] - lastFrame[p]);
      }
      const avgDiff = totalDiff / (width * height);
      console.log('[detectCropFromVideo] Frame difference (first vs last):', avgDiff.toFixed(2));

      const hasMotion = avgDiff > 1.0;

      if (hasMotion && grayFrames.length >= 3) {
        // --- Motion + edge analysis (preferred) ---
        const result = motionEdgeAnalysis(grayFrames, width, height);
        if (result) return result;
        console.log('[detectCropFromVideo] Motion+edge analysis found no crop, trying edge-only');
      } else {
        console.log(
          '[detectCropFromVideo] No motion detected (seeking may not work), using edge-only'
        );
      }

      // --- Edge-only fallback (single frame) ---
      const midFrame = grayFrames[Math.floor(grayFrames.length / 2)];
      return edgeOnlyAnalysis(midFrame, width, height);
    } finally {
      // Always remove from DOM
      document.body.removeChild(video);
    }
  } catch (err) {
    console.warn('[detectCropFromVideo] Failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Motion + Edge analysis (same algorithm as server-side)
// ---------------------------------------------------------------------------

function motionEdgeAnalysis(
  grayFrames: Uint8Array[],
  width: number,
  height: number
): ClientCropRect | null {
  const motionCount = new Uint16Array(width * height);
  const threshold = 20;

  for (let i = 0; i < grayFrames.length; i++) {
    for (let j = i + 2; j < grayFrames.length && j <= i + 4; j++) {
      const a = grayFrames[i];
      const b = grayFrames[j];
      for (let p = 0; p < width * height; p++) {
        if (Math.abs(a[p] - b[p]) > threshold) {
          motionCount[p]++;
        }
      }
    }
  }

  // Build column/row motion histograms
  const minHits = Math.max(2, Math.floor(grayFrames.length / 4));
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

  // Find motion bounds
  const colThresh = height * 0.05;
  const rowThresh = width * 0.05;
  let mx1 = 0,
    mx2 = width - 1,
    my1 = 0,
    my2 = height - 1;
  while (mx1 < width && colMotion[mx1] < colThresh) mx1++;
  while (mx2 > 0 && colMotion[mx2] < colThresh) mx2--;
  while (my1 < height && rowMotion[my1] < rowThresh) my1++;
  while (my2 > 0 && rowMotion[my2] < rowThresh) my2--;

  console.log('[detectCropFromVideo] Motion bounds:', { mx1, mx2, my1, my2 });
  if (mx1 >= mx2 || my1 >= my2) return null;

  // --- Edge analysis on the middle frame ---
  const midFrame = grayFrames[Math.floor(grayFrames.length / 2)];
  const { vertPeaks, horizPeaks, colEdge } = computeEdges(midFrame, width, height);

  // Find strongest edges near the OUTER motion boundaries
  const margin = width * 0.15;
  const vMargin = height * 0.15;

  let leftEdge = mx1,
    bestLeft = 0;
  for (const p of vertPeaks) {
    if (p.pos >= mx1 - margin && p.pos <= mx1 + width * 0.03 && p.strength > bestLeft) {
      bestLeft = p.strength;
      leftEdge = p.pos;
    }
  }

  let rightEdge = mx2,
    bestRight = 0;
  for (const p of vertPeaks) {
    if (p.pos >= mx2 - width * 0.03 && p.pos <= mx2 + margin && p.strength > bestRight) {
      bestRight = p.strength;
      rightEdge = p.pos;
    }
  }

  const regionW = rightEdge - leftEdge;
  console.log('[detectCropFromVideo] Motion+edge:', {
    leftEdge,
    rightEdge,
    regionW,
    vertPeakCount: vertPeaks.length,
  });
  if (regionW < width * 0.15) return null;

  const widthToFrameRatio = regionW / height;
  console.log('[detectCropFromVideo] widthToFrameRatio:', widthToFrameRatio);

  if (widthToFrameRatio >= 0.35 && widthToFrameRatio <= 0.75) {
    return buildCrop9x16(regionW, leftEdge, my1, my2, width, height);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Edge-only analysis (fallback when motion detection fails)
// ---------------------------------------------------------------------------

function edgeOnlyAnalysis(frame: Uint8Array, width: number, height: number): ClientCropRect | null {
  const { vertPeaks, horizPeaks } = computeEdges(frame, width, height);

  console.log(
    '[detectCropFromVideo] Edge-only: found',
    vertPeaks.length,
    'vertical peaks:',
    vertPeaks.map((p) => `x=${p.pos} str=${p.strength.toFixed(1)}`).join(', ')
  );

  if (vertPeaks.length < 2) return null;

  // Try all pairs of vertical edges that form a portrait-shaped region.
  // Prioritize edge strength (video player borders are the strongest edges).
  // Ratio is used as a filter, not the primary score — the actual player may
  // not be exactly 9:16 due to browser chrome, margins, etc.
  let bestPair: { left: number; right: number; score: number } | null = null;

  for (let i = 0; i < vertPeaks.length; i++) {
    for (let j = i + 1; j < vertPeaks.length; j++) {
      const left = vertPeaks[i].pos;
      const right = vertPeaks[j].pos;
      const regionW = right - left;
      if (regionW < width * 0.15) continue;

      const ratio = regionW / height;
      if (ratio < 0.3 || ratio > 0.75) continue;

      // Score: primarily edge strength, with a small bonus for 9:16 closeness
      const minStrength = Math.min(vertPeaks[i].strength, vertPeaks[j].strength);
      const avgStrength = (vertPeaks[i].strength + vertPeaks[j].strength) / 2;
      const ratioDist = Math.abs(ratio - 9 / 16);
      // Edge strength dominates; ratio closeness is a tiebreaker
      const score = minStrength * 0.6 + avgStrength * 0.4 - ratioDist * 2;

      if (!bestPair || score > bestPair.score) {
        bestPair = { left, right, score };
      }
    }
  }

  if (!bestPair) {
    console.log('[detectCropFromVideo] Edge-only: no portrait-shaped edge pair found');
    return null;
  }

  const regionW = bestPair.right - bestPair.left;
  console.log('[detectCropFromVideo] Edge-only: best pair', {
    left: bestPair.left,
    right: bestPair.right,
    regionW,
    ratio: (regionW / height).toFixed(3),
    score: bestPair.score.toFixed(3),
  });

  // --- Refine top/bottom using horizontal edges within the detected columns ---
  // Compute horizontal edge strength restricted to just the detected column range
  const restrictedRowEdge = new Float32Array(height);
  for (let y = 1; y < height; y++) {
    let sum = 0;
    for (let x = bestPair.left; x < bestPair.right; x++) {
      sum += Math.abs(frame[y * width + x] - frame[(y - 1) * width + x]);
    }
    restrictedRowEdge[y] = sum / regionW;
  }
  const restrictedHorizPeaks = findEdgePeaks(restrictedRowEdge, 10, 5.0);

  // Look for strong horizontal edge in top 15% (address bar / browser chrome)
  let topCrop = 0;
  let bestTopStrength = 0;
  for (const p of restrictedHorizPeaks) {
    if (p.pos < height * 0.15 && p.strength > bestTopStrength) {
      bestTopStrength = p.strength;
      topCrop = p.pos;
    }
  }

  // Look for strong horizontal edge in bottom 15% (taskbar / bottom UI)
  let bottomCrop = height;
  let bestBottomStrength = 0;
  for (const p of restrictedHorizPeaks) {
    if (p.pos > height * 0.85 && p.strength > bestBottomStrength) {
      bestBottomStrength = p.strength;
      bottomCrop = p.pos;
    }
  }

  console.log('[detectCropFromVideo] Edge-only: horizontal refinement', {
    topCrop,
    topStrength: bestTopStrength.toFixed(1),
    bottomCrop,
    bottomStrength: bestBottomStrength.toFixed(1),
    horizPeaks: restrictedHorizPeaks
      .filter((p) => p.pos < height * 0.15 || p.pos > height * 0.85)
      .map((p) => `y=${p.pos} str=${p.strength.toFixed(1)}`)
      .join(', '),
  });

  // Build crop using refined bounds
  const availableH = bottomCrop - topCrop;
  const targetH = roundEven(regionW * (16 / 9));
  const cropH = Math.min(targetH, roundEven(availableH));
  const centerY = Math.round((topCrop + bottomCrop) / 2);
  const cropY = clamp(centerY - Math.round(cropH / 2), topCrop, bottomCrop - cropH);
  const cropX = clamp(bestPair.left, 0, width - roundEven(regionW));
  const crop = {
    w: roundEven(regionW),
    h: cropH,
    x: roundEven(cropX),
    y: cropY,
  };
  console.log(
    `[detectCropFromVideo] Detected 9:16 content: crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`
  );
  return crop;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function computeEdges(
  frame: Uint8Array,
  width: number,
  height: number
): {
  vertPeaks: EdgePeak[];
  horizPeaks: EdgePeak[];
  colEdge: Float32Array;
  rowEdge: Float32Array;
} {
  const colEdge = new Float32Array(width);
  for (let x = 1; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < height; y++) {
      sum += Math.abs(frame[y * width + x] - frame[y * width + x - 1]);
    }
    colEdge[x] = sum / height;
  }

  const rowEdge = new Float32Array(height);
  for (let y = 1; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      sum += Math.abs(frame[y * width + x] - frame[(y - 1) * width + x]);
    }
    rowEdge[y] = sum / width;
  }

  return {
    vertPeaks: findEdgePeaks(colEdge, 10, 5.0),
    horizPeaks: findEdgePeaks(rowEdge, 10, 5.0),
    colEdge,
    rowEdge,
  };
}

function buildCrop9x16(
  regionW: number,
  leftEdge: number,
  my1: number,
  my2: number,
  frameW: number,
  frameH: number
): ClientCropRect {
  const targetH = roundEven(regionW * (16 / 9));
  const centerY = Math.round((my1 + my2) / 2);
  const cropY = clamp(centerY - Math.round(targetH / 2), 0, frameH - targetH);
  const cropX = clamp(leftEdge, 0, frameW - roundEven(regionW));
  const crop = {
    w: roundEven(regionW),
    h: targetH,
    x: roundEven(cropX),
    y: cropY,
  };
  console.log(
    `[detectCropFromVideo] Detected 9:16 content: crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`
  );
  return crop;
}

function waitForVideo(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      video.removeEventListener('loadeddata', onLoaded);
      resolve();
    };
    video.addEventListener('loadeddata', onLoaded);
    setTimeout(() => {
      video.removeEventListener('loadeddata', onLoaded);
      reject(new Error('video load timeout'));
    }, 10000);
  });
}

function seekVideo(video: HTMLVideoElement, timeS: number): Promise<void> {
  return new Promise((resolve, reject) => {
    video.currentTime = timeS;
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      reject(new Error('seek timeout'));
    }, 5000);
  });
}

function toGrayscale(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    gray[i] = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
  }
  return gray;
}

interface EdgePeak {
  pos: number;
  strength: number;
}

function findEdgePeaks(arr: Float32Array, minDist: number, minStrength: number): EdgePeak[] {
  const raw: EdgePeak[] = [];
  for (let i = 3; i < arr.length - 3; i++) {
    const avg = (arr[i - 2] + arr[i - 1] + arr[i + 1] + arr[i + 2]) / 4;
    if (arr[i] > avg * 1.5 && arr[i] > minStrength) {
      raw.push({ pos: i, strength: arr[i] });
    }
  }
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
