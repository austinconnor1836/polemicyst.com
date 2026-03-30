// Auto-edit analysis: FFmpeg silencedetect + transcript-based bad take detection

import { spawn } from 'child_process';
import type { AutoEditSettings, AutoEditCut, AutoEditResult, AutoEditSummary } from '../auto-edit';

/** Transcript segment shape (Whisper / YouTube captions) */
export interface TranscriptSegment {
  start: number; // seconds
  end: number; // seconds
  text: string;
}

// ---------------------------------------------------------------------------
// Levenshtein distance (simple O(n*m) DP — no deps)
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  // Single-row optimisation
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[lb];
}

/** Normalised similarity: 1 = identical, 0 = completely different */
function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const maxLen = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / maxLen;
}

/** Normalise text for comparison: lowercase, strip punctuation, collapse spaces */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function generateCutId(): string {
  return `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// FFmpeg silencedetect — waveform-level silence detection
// ---------------------------------------------------------------------------

/**
 * Run FFmpeg silencedetect on a local video file and return silence regions.
 * Parses stderr for `silence_start` / `silence_end` lines.
 */
export async function detectSilenceFFmpeg(
  videoPath: string,
  silenceThresholdDb: number,
  minSilenceDurationS: number
): Promise<Array<{ startS: number; endS: number }>> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i',
      videoPath,
      '-af',
      `silencedetect=noise=${silenceThresholdDb}dB:d=${minSilenceDurationS}`,
      '-f',
      'null',
      '-',
    ];

    const proc = spawn('ffmpeg', args);
    let stderr = '';

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => reject(new Error(`FFmpeg spawn failed: ${err.message}`)));

    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        // FFmpeg returns non-zero for some formats but still outputs silence data;
        // only reject if we got no silence output at all
        if (!stderr.includes('silence_start') && !stderr.includes('silence_end')) {
          reject(new Error(`FFmpeg silencedetect exited with code ${code}`));
          return;
        }
      }

      const regions: Array<{ startS: number; endS: number }> = [];
      let pendingStart: number | null = null;

      for (const line of stderr.split('\n')) {
        const startMatch = line.match(/silence_start:\s*([\d.]+)/);
        if (startMatch) {
          pendingStart = parseFloat(startMatch[1]);
          continue;
        }

        const endMatch = line.match(/silence_end:\s*([\d.]+)/);
        if (endMatch && pendingStart !== null) {
          regions.push({ startS: pendingStart, endS: parseFloat(endMatch[1]) });
          pendingStart = null;
        }
      }

      resolve(regions);
    });
  });
}

// ---------------------------------------------------------------------------
// Transcript-based silence detection (fallback when no video file available)
// ---------------------------------------------------------------------------

export function detectSilenceGaps(
  segments: TranscriptSegment[],
  durationS: number,
  silenceThresholdS: number,
  minSilenceToKeepS: number
): AutoEditCut[] {
  if (segments.length === 0) return [];

  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const cuts: AutoEditCut[] = [];

  // Leading silence (before first speech)
  if (sorted[0].start > silenceThresholdS) {
    const cutEnd = sorted[0].start - minSilenceToKeepS;
    if (cutEnd > minSilenceToKeepS) {
      cuts.push({
        id: generateCutId(),
        startS: 0,
        endS: Math.max(0, cutEnd),
        reason: 'silence',
        detail: `Leading silence: ${sorted[0].start.toFixed(1)}s before first speech`,
      });
    }
  }

  // Gaps between segments
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].start - sorted[i].end;
    if (gap > silenceThresholdS) {
      const cutStart = sorted[i].end + minSilenceToKeepS;
      const cutEnd = sorted[i + 1].start - minSilenceToKeepS;
      if (cutEnd - cutStart > 0.1) {
        cuts.push({
          id: generateCutId(),
          startS: cutStart,
          endS: cutEnd,
          reason: 'silence',
          detail: `${gap.toFixed(1)}s silence gap`,
        });
      }
    }
  }

  // Trailing silence (after last speech)
  const lastEnd = sorted[sorted.length - 1].end;
  if (durationS - lastEnd > silenceThresholdS) {
    const cutStart = lastEnd + minSilenceToKeepS;
    if (durationS - cutStart > minSilenceToKeepS) {
      cuts.push({
        id: generateCutId(),
        startS: cutStart,
        endS: durationS,
        reason: 'silence',
        detail: `Trailing silence: ${(durationS - lastEnd).toFixed(1)}s after last speech`,
      });
    }
  }

  return cuts;
}

// ---------------------------------------------------------------------------
// Bad take detection
// ---------------------------------------------------------------------------

const SIMILARITY_THRESHOLD = 0.6;
const FALSE_START_MAX_WORDS = 3;

export function detectBadTakes(segments: TranscriptSegment[]): AutoEditCut[] {
  if (segments.length < 2) return [];

  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const cuts: AutoEditCut[] = [];
  const markedIndices = new Set<number>();

  // 1. Sliding window: compare groups of 2-4 consecutive segments
  for (let windowSize = 2; windowSize <= Math.min(4, sorted.length); windowSize++) {
    for (let i = 0; i <= sorted.length - windowSize * 2; i++) {
      if (markedIndices.has(i)) continue;

      const groupA = sorted
        .slice(i, i + windowSize)
        .map((s) => s.text)
        .join(' ');
      const groupB = sorted
        .slice(i + windowSize, i + windowSize * 2)
        .map((s) => s.text)
        .join(' ');

      const normA = normalise(groupA);
      const normB = normalise(groupB);

      if (normA.length < 5 || normB.length < 5) continue;

      const sim = similarity(normA, normB);
      if (sim > SIMILARITY_THRESHOLD) {
        // Mark the earlier occurrence (group A) as a bad take — keep the retry
        const cutStart = sorted[i].start;
        const cutEnd = sorted[i + windowSize - 1].end;

        // Don't create duplicate cuts for overlapping windows
        const alreadyCut = cuts.some(
          (c) =>
            c.reason === 'bad_take' &&
            Math.abs(c.startS - cutStart) < 0.5 &&
            Math.abs(c.endS - cutEnd) < 0.5
        );

        if (!alreadyCut) {
          cuts.push({
            id: generateCutId(),
            startS: cutStart,
            endS: cutEnd,
            reason: 'bad_take',
            detail: `Repeated phrase (${Math.round(sim * 100)}% similar): "${normA.slice(0, 60)}"`,
          });
          for (let j = i; j < i + windowSize; j++) markedIndices.add(j);
        }
      }
    }
  }

  // 2. False starts: short segment (< N words) followed by longer segment starting with same words
  for (let i = 0; i < sorted.length - 1; i++) {
    if (markedIndices.has(i)) continue;

    const wordsA = normalise(sorted[i].text).split(' ').filter(Boolean);
    if (wordsA.length === 0 || wordsA.length > FALSE_START_MAX_WORDS) continue;

    const wordsB = normalise(sorted[i + 1].text)
      .split(' ')
      .filter(Boolean);
    if (wordsB.length <= wordsA.length) continue;

    // Check if B starts with A's words (n-gram prefix overlap)
    const prefixMatch = wordsA.every((w, idx) => wordsB[idx] === w);
    if (prefixMatch) {
      const alreadyCut = cuts.some(
        (c) => c.reason === 'bad_take' && Math.abs(c.startS - sorted[i].start) < 0.5
      );

      if (!alreadyCut) {
        cuts.push({
          id: generateCutId(),
          startS: sorted[i].start,
          endS: sorted[i].end,
          reason: 'bad_take',
          detail: `False start: "${wordsA.join(' ')}" retried in next segment`,
        });
        markedIndices.add(i);
      }
    }
  }

  return cuts;
}

// ---------------------------------------------------------------------------
// Merge overlapping cuts
// ---------------------------------------------------------------------------

export function mergeOverlappingCuts(cuts: AutoEditCut[]): AutoEditCut[] {
  if (cuts.length <= 1) return cuts;

  const sorted = [...cuts].sort((a, b) => a.startS - b.startS);
  const merged: AutoEditCut[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const curr = sorted[i];

    if (curr.startS <= last.endS + 0.05) {
      // Overlap or adjacent — extend
      last.endS = Math.max(last.endS, curr.endS);
      // Keep the more descriptive detail, prefer bad_take reason
      if (curr.reason === 'bad_take' && last.reason !== 'bad_take') {
        last.reason = curr.reason;
        last.detail = curr.detail;
      }
    } else {
      merged.push({ ...curr });
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Main analysis entry point.
 * @param ffmpegSilenceCuts — pre-computed silence regions from FFmpeg silencedetect.
 *   When provided, these replace transcript-based silence detection entirely.
 *   Each region gets a buffer (minSilenceToKeepS) trimmed from both edges.
 */
export function analyzeForAutoEdit(
  segments: TranscriptSegment[],
  settings: AutoEditSettings,
  durationS: number,
  ffmpegSilenceCuts?: Array<{ startS: number; endS: number }>
): AutoEditResult {
  const allCuts: AutoEditCut[] = [];

  // Silence detection — prefer FFmpeg waveform analysis over transcript gaps
  if (ffmpegSilenceCuts && ffmpegSilenceCuts.length > 0) {
    const buffer = settings.minSilenceToKeepS;
    for (const region of ffmpegSilenceCuts) {
      const cutStart = region.startS + buffer;
      const cutEnd = region.endS - buffer;
      if (cutEnd - cutStart > 0.1) {
        allCuts.push({
          id: generateCutId(),
          startS: cutStart,
          endS: cutEnd,
          reason: 'silence',
          detail: `${(region.endS - region.startS).toFixed(1)}s silence (audio-level)`,
        });
      }
    }
  }

  // Bad take detection (transcript-based — requires text comparison)
  if (settings.badTakeDetection) {
    const badTakeCuts = detectBadTakes(segments);
    allCuts.push(...badTakeCuts);
  }

  // Merge overlapping cuts
  const mergedCuts = mergeOverlappingCuts(allCuts);

  // Compute summary
  const totalRemovedS = mergedCuts.reduce((sum, c) => sum + (c.endS - c.startS), 0);
  const summary: AutoEditSummary = {
    silenceCuts: mergedCuts.filter((c) => c.reason === 'silence').length,
    badTakeCuts: mergedCuts.filter((c) => c.reason === 'bad_take').length,
    totalCuts: mergedCuts.length,
    totalRemovedS: Math.round(totalRemovedS * 10) / 10,
    originalDurationS: Math.round(durationS * 10) / 10,
    newDurationS: Math.round((durationS - totalRemovedS) * 10) / 10,
  };

  return { cuts: mergedCuts, summary };
}
