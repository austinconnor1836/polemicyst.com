/**
 * Reaction boundary detection.
 *
 * Given ONE long screen-capture in which a fixed on-screen region plays reference
 * videos back-to-back, find where each reference ends and the next begins — the
 * boundaries that split the recording into one reaction per reference.
 *
 * Signal: FFmpeg scene-change detection over ONLY the reference rectangle. When a new
 * reference video starts, that region has a hard visual discontinuity. A minimum-segment
 * gate suppresses cuts *inside* a single reference; optional blackdetect corroborates
 * fades between clips.
 *
 * This is the shared implementation consumed by both the standalone CLI
 * (`scripts/detect-reaction-boundaries.ts`) and the web API
 * (`POST /api/reaction-sessions/detect-boundaries`). Keep provider-agnostic: it operates
 * on a local file path and only needs `ffmpeg` / `ffprobe` on PATH.
 */

import { spawn } from 'child_process';
import type { CropRect } from './cropDetect';

export const DEFAULT_SCENE_THRESHOLD = 0.4;
export const DEFAULT_MIN_SEGMENT_S = 8;
/** Shorts/Reels hard cap. Windows longer than this are flagged for sub-splitting. */
export const DEFAULT_PLATFORM_LIMIT_S = 90;

export interface ReactionBoundaryParams {
  /** Region to analyze; omit/null to scan the full frame. */
  refRect?: CropRect | null;
  /** Scene-change score in (0,1) that counts as a cut. */
  threshold?: number;
  /** Minimum seconds between accepted cuts; smaller gaps are merged. */
  minSegmentS?: number;
  /** Platform limit in seconds; windows longer than this are flagged. */
  maxSegmentS?: number;
  /** Also fold blackdetect starts in as candidate cuts. */
  useBlackDetect?: boolean;
}

export interface ReactionWindow {
  /** 1-based position in the capture. */
  index: number;
  startS: number;
  endS: number;
  durationS: number;
  /** True when `durationS` exceeds the platform limit and needs sub-splitting. */
  overLimit: boolean;
}

export interface ReactionBoundaryResult {
  durationS: number;
  refRect: CropRect | null;
  threshold: number;
  minSegmentS: number;
  maxSegmentS: number;
  /** Number of raw scene cuts above threshold before the min-segment gate. */
  rawCutCount: number;
  windows: ReactionWindow[];
}

/** Run a command, resolving with combined stdout+stderr (ffmpeg writes diagnostics to stderr). */
function runCapture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = '';
    let stdout = '';
    proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    proc.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(`\`${cmd}\` not found on PATH. Install FFmpeg and retry.`));
      } else {
        reject(err);
      }
    });
    proc.on('close', (code) => {
      // ffmpeg exits non-zero for some inputs while still emitting the data we parse;
      // only reject when there is genuinely nothing to work with.
      if (code !== 0 && !stderr && !stdout) {
        reject(new Error(`${cmd} exited ${code} with no output`));
      } else {
        resolve(stdout + stderr);
      }
    });
  });
}

/** Duration of the capture in seconds (ffprobe). */
export async function probeDurationS(inputPath: string): Promise<number> {
  const out = await runCapture('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    inputPath,
  ]);
  const dur = parseFloat(out.trim());
  if (!Number.isFinite(dur) || dur <= 0) {
    throw new Error(
      `Could not read duration from "${inputPath}" (ffprobe returned "${out.trim()}")`
    );
  }
  return dur;
}

function cropPrefix(rect: CropRect | null | undefined): string {
  return rect ? `crop=${rect.w}:${rect.h}:${rect.x}:${rect.y},` : '';
}

function parseTimes(output: string, key: 'pts_time' | 'black_start'): number[] {
  const times: number[] = [];
  const re = new RegExp(`${key}:([0-9]+\\.?[0-9]*)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    times.push(parseFloat(m[1]));
  }
  return times;
}

/** Scene-change timestamps (seconds) within the (optionally cropped) region. */
export async function detectSceneCutTimes(
  inputPath: string,
  refRect: CropRect | null | undefined,
  threshold: number
): Promise<number[]> {
  const vf = `${cropPrefix(refRect)}select='gt(scene,${threshold})',showinfo`;
  const out = await runCapture('ffmpeg', [
    '-nostats',
    '-i',
    inputPath,
    '-vf',
    vf,
    '-an',
    '-f',
    'null',
    '-',
  ]);
  // showinfo prints one line per selected (scene-cut) frame, each carrying pts_time.
  return parseTimes(out, 'pts_time');
}

/** black_start timestamps (seconds) — fades/gaps between clips corroborate boundaries. */
export async function detectBlackStartTimes(
  inputPath: string,
  refRect: CropRect | null | undefined
): Promise<number[]> {
  const vf = `${cropPrefix(refRect)}blackdetect=d=0.10:pic_th=0.98`;
  const out = await runCapture('ffmpeg', [
    '-nostats',
    '-i',
    inputPath,
    '-vf',
    vf,
    '-an',
    '-f',
    'null',
    '-',
  ]);
  return parseTimes(out, 'black_start');
}

/**
 * Turn raw cut timestamps into segment windows across [0, duration].
 *
 * Cuts within `minSegmentS` of the previous accepted cut (or of 0) are dropped, so a
 * reference that cuts scenes internally doesn't over-split. A trailing sliver shorter
 * than `minSegmentS` is merged back into the previous window. Pure + deterministic.
 */
export function buildReactionWindows(
  rawCuts: number[],
  durationS: number,
  minSegmentS: number,
  maxSegmentS: number
): ReactionWindow[] {
  const sorted = [...new Set(rawCuts)].sort((a, b) => a - b).filter((t) => t > 0 && t < durationS);

  const accepted: number[] = [];
  let last = 0;
  for (const t of sorted) {
    if (t - last >= minSegmentS) {
      accepted.push(t);
      last = t;
    }
  }

  const bounds = [0, ...accepted, durationS];
  const windows: Array<Omit<ReactionWindow, 'index' | 'overLimit'>> = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    windows.push({ startS: bounds[i], endS: bounds[i + 1], durationS: bounds[i + 1] - bounds[i] });
  }

  // Merge a too-short trailing window into its predecessor.
  if (windows.length >= 2) {
    const tail = windows[windows.length - 1];
    if (tail.durationS < minSegmentS) {
      const prev = windows[windows.length - 2];
      prev.endS = tail.endS;
      prev.durationS = prev.endS - prev.startS;
      windows.pop();
    }
  }

  return windows.map((w, i) => ({
    index: i + 1,
    startS: Number(w.startS.toFixed(3)),
    endS: Number(w.endS.toFixed(3)),
    durationS: Number(w.durationS.toFixed(3)),
    overLimit: w.durationS > maxSegmentS,
  }));
}

/**
 * Full pipeline: probe duration → scene-cut (+ optional blackdetect) → windows.
 * `inputPath` must be a local file; callers download from S3 first.
 */
export async function detectReactionBoundaries(
  inputPath: string,
  params: ReactionBoundaryParams = {}
): Promise<ReactionBoundaryResult> {
  const refRect = params.refRect ?? null;
  const threshold = params.threshold ?? DEFAULT_SCENE_THRESHOLD;
  const minSegmentS = params.minSegmentS ?? DEFAULT_MIN_SEGMENT_S;
  const maxSegmentS = params.maxSegmentS ?? DEFAULT_PLATFORM_LIMIT_S;

  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) {
    throw new Error('threshold must be a number in (0, 1)');
  }
  if (!Number.isFinite(minSegmentS) || minSegmentS < 0) {
    throw new Error('minSegmentS must be a non-negative number');
  }

  const durationS = await probeDurationS(inputPath);
  const sceneCuts = await detectSceneCutTimes(inputPath, refRect, threshold);
  const blackStarts = params.useBlackDetect ? await detectBlackStartTimes(inputPath, refRect) : [];
  const rawCuts = [...sceneCuts, ...blackStarts];

  return {
    durationS,
    refRect,
    threshold,
    minSegmentS,
    maxSegmentS,
    rawCutCount: sceneCuts.length,
    windows: buildReactionWindows(rawCuts, durationS, minSegmentS, maxSegmentS),
  };
}
