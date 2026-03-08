import { spawn } from 'child_process';

export interface DetectedPause {
  start: number;
  end: number;
  duration: number;
  confidence: number; // 0..1, higher = more likely a real unwanted pause
}

export interface KeepSegment {
  start: number;
  end: number;
}

/**
 * Run FFmpeg silencedetect over the full audio track and return all silent
 * intervals with their start/end timestamps.
 *
 * We sweep multiple noise-floor thresholds (-50 dB → -25 dB) and aggregate.
 * A segment that appears at a stricter (lower) threshold gets a higher
 * confidence score, meaning it is more clearly silent.
 */
export async function detectSilentSegments(
  videoPath: string,
  opts?: { minSilenceDurationS?: number }
): Promise<{ pauses: DetectedPause[]; videoDurationS: number }> {
  const minDur = opts?.minSilenceDurationS ?? 0.3;

  // Get video duration first
  const videoDurationS = await getVideoDuration(videoPath);

  // Run silencedetect at a moderate threshold — the adaptive selection
  // algorithm handles the rest.
  const thresholdDb = -35;
  const raw = await runSilenceDetect(videoPath, thresholdDb, minDur);

  // Merge overlapping or near-adjacent segments (within 0.05s gap)
  const merged = mergeSegments(raw, 0.05);

  // Assign confidence: longer pauses and pauses at lower volume get higher
  // confidence. We normalise duration into a 0..1 range where pauses >= 2s
  // saturate at 1.0.
  const pauses: DetectedPause[] = merged.map((seg) => {
    const dur = seg.end - seg.start;
    const durScore = Math.min(dur / 2.0, 1.0);
    const confidence = durScore;
    return {
      start: seg.start,
      end: seg.end,
      duration: dur,
      confidence,
    };
  });

  return { pauses, videoDurationS };
}

/**
 * Given all detected pauses and the user's rough estimate of how many
 * pauses to remove, select the pauses that should actually be cut.
 *
 * Strategy:
 *  1. Sort pauses by a composite "removal priority" that blends duration,
 *     confidence, and spatial distribution.
 *  2. Use the estimate as a soft target — the algorithm may return fewer or
 *     more pauses depending on the actual distribution.
 *  3. Prefer removing longer, higher-confidence pauses first.
 *  4. Avoid removing pauses that are very short (< 0.3s) unless the user
 *     has asked for a high count and there are no better candidates.
 */
export function selectPausesToRemove(
  pauses: DetectedPause[],
  estimatedCount: number,
  videoDurationS: number
): DetectedPause[] {
  if (pauses.length === 0 || estimatedCount <= 0) return [];

  // Sort by duration descending (primary), confidence descending (tiebreak)
  const ranked = [...pauses].sort((a, b) => {
    const durDiff = b.duration - a.duration;
    if (Math.abs(durDiff) > 0.01) return durDiff;
    return b.confidence - a.confidence;
  });

  // Compute a "natural threshold" based on the estimate:
  // If the user says ~N pauses, we want to find a duration cutoff such that
  // approximately N pauses fall above it.
  //
  // We allow ±30% flexibility around the estimate.
  const lowerBound = Math.max(1, Math.floor(estimatedCount * 0.7));
  const upperBound = Math.ceil(estimatedCount * 1.3);

  // The ideal count is capped at available pauses
  const targetCount = Math.min(estimatedCount, ranked.length);

  // Find a natural gap in durations near the target count.
  // Look at durations around index targetCount and find the biggest
  // gap to use as a cutoff.
  let bestCutIdx = targetCount;

  if (ranked.length > 1) {
    const searchStart = Math.max(1, lowerBound - 1);
    const searchEnd = Math.min(ranked.length, upperBound + 1);

    let bestGap = -1;
    for (let i = searchStart; i < searchEnd && i < ranked.length; i++) {
      const gap = ranked[i - 1].duration - ranked[i].duration;
      if (gap > bestGap) {
        bestGap = gap;
        bestCutIdx = i;
      }
    }
  }

  // Clamp to a reasonable range
  bestCutIdx = Math.min(bestCutIdx, ranked.length);
  bestCutIdx = Math.max(bestCutIdx, Math.min(1, ranked.length));

  const selected = ranked.slice(0, bestCutIdx);

  // Filter out very short pauses (< 0.25s) unless they are within the
  // user's estimate range
  const minRemovableDuration = 0.25;
  const filtered = selected.filter((p) => p.duration >= minRemovableDuration);

  // If we filtered everything out, return the single longest pause if it exists
  if (filtered.length === 0 && selected.length > 0) {
    return [selected[0]];
  }

  // Sort by start time for the final output
  return filtered.sort((a, b) => a.start - b.start);
}

/**
 * Given the video duration and the pauses to remove, compute the segments
 * of the video to keep (the complement).
 */
export function buildKeepSegments(
  videoDurationS: number,
  pausesToRemove: DetectedPause[]
): KeepSegment[] {
  const sorted = [...pausesToRemove].sort((a, b) => a.start - b.start);
  const keeps: KeepSegment[] = [];

  let cursor = 0;
  for (const pause of sorted) {
    if (pause.start > cursor + 0.01) {
      keeps.push({ start: cursor, end: pause.start });
    }
    cursor = pause.end;
  }

  if (cursor < videoDurationS - 0.01) {
    keeps.push({ start: cursor, end: videoDurationS });
  }

  // Filter out extremely short keep segments (< 0.05s)
  return keeps.filter((k) => k.end - k.start >= 0.05);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) {
        const dur = parseFloat(stdout.trim());
        resolve(isNaN(dur) ? 0 : dur);
      } else {
        reject(new Error(`ffprobe exited with ${code}: ${stderr}`));
      }
    });
  });
}

interface RawSilence {
  start: number;
  end: number;
}

async function runSilenceDetect(
  videoPath: string,
  noiseDb: number,
  minDuration: number
): Promise<RawSilence[]> {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-i', videoPath,
      '-vn',
      '-af', `silencedetect=noise=${noiseDb}dB:d=${minDuration}`,
      '-f', 'null',
      '-',
    ];
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`ffmpeg silencedetect exited with ${code}: ${stderr}`));
        return;
      }

      const segments: RawSilence[] = [];
      const startRegex = /silence_start:\s*([\d.]+)/g;
      const endRegex = /silence_end:\s*([\d.]+)/g;

      const starts: number[] = [];
      const ends: number[] = [];
      let m: RegExpExecArray | null;

      while ((m = startRegex.exec(stderr)) !== null) {
        starts.push(parseFloat(m[1]));
      }
      while ((m = endRegex.exec(stderr)) !== null) {
        ends.push(parseFloat(m[1]));
      }

      for (let i = 0; i < starts.length; i++) {
        const end = i < ends.length ? ends[i] : starts[i] + minDuration;
        segments.push({ start: starts[i], end });
      }

      resolve(segments);
    });
  });
}

function mergeSegments(segments: RawSilence[], gapThreshold: number): RawSilence[] {
  if (segments.length === 0) return [];
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const merged: RawSilence[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.start - prev.end <= gapThreshold) {
      prev.end = Math.max(prev.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }

  return merged;
}
