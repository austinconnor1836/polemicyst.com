import { spawn } from 'child_process';
import { PassThrough } from 'stream';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CLIPS_BUCKET = process.env.S3_BUCKET || 'clips-genie-uploads';
const CLIPS_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-2';
const s3 = new S3Client({ region: CLIPS_REGION });

export type Layout = 'mobile' | 'landscape';
export type AudioMode = 'creator' | 'reference' | 'both';

export interface TrackInfo {
  localPath: string;
  startAtS: number;
  trimStartS: number;
  trimEndS: number | null;
  durationS: number;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  sortOrder: number;
}

export interface ComposeOptions {
  layout: Layout;
  creatorPath: string;
  creatorDurationS: number;
  tracks: TrackInfo[];
  audioMode: AudioMode;
  creatorVolume: number;
  referenceVolume: number;
}

/**
 * Effective duration of a reference track after trimming.
 */
function effectiveDuration(track: TrackInfo): number {
  const end = track.trimEndS ?? track.durationS;
  return Math.max(0, end - track.trimStartS);
}

// Creator picture-in-picture size for landscape mode (bottom-right overlay)
const PIP_W = 320;
const PIP_H = 180;
const PIP_MARGIN = 16;

/**
 * Returns true if the reference track has portrait aspect ratio (taller than wide).
 */
function isPortrait(track: TrackInfo): boolean {
  if (track.width && track.height) {
    return track.height > track.width;
  }
  return false; // Default to landscape if dimensions unknown
}

/**
 * Build the FFmpeg filter_complex string for the composition.
 *
 * Mobile stacked (720x1280):
 *   - Creator in bottom half (720x640)
 *   - Full-frame creator (720x1280) shown when no reference is active
 *   - Each reference in top half (720x640) with enable='between(t,START,END)'
 *
 * Landscape (1280x720):
 *   - Full-frame creator shown when no reference is active
 *   - For each LANDSCAPE reference: ref fills entire frame, creator is a small
 *     PIP overlay in the bottom-right corner
 *   - For each PORTRAIT reference: ref is scaled to full height and flush-right,
 *     creator fills the remaining left space
 */
export function buildFilterComplex(opts: ComposeOptions): {
  filterComplex: string;
  outputMap: string[];
} {
  const { layout, tracks, audioMode, creatorVolume, referenceVolume, creatorDurationS } = opts;

  const isMobile = layout === 'mobile';
  const canvasW = isMobile ? 720 : 1280;
  const canvasH = isMobile ? 1280 : 720;

  const filters: string[] = [];

  // Full-frame creator (for solo / no-reference-active state)
  filters.push(
    `[0:v]scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH},setsar=1[creator_full]`
  );

  if (isMobile) {
    // Mobile: also need half-size creator for stacked composite
    const halfW = 720;
    const halfH = 640;
    filters.push(
      `[0:v]scale=${halfW}:${halfH}:force_original_aspect_ratio=increase,crop=${halfW}:${halfH},setsar=1[creator_half]`
    );
  } else {
    // Landscape: PIP creator for landscape-ref overlays
    filters.push(
      `[0:v]scale=${PIP_W}:${PIP_H}:force_original_aspect_ratio=increase,crop=${PIP_W}:${PIP_H},setsar=1[creator_pip]`
    );

    // Pre-scale creator variants for each portrait reference (each has different fill width)
    tracks.forEach((track, i) => {
      if (!isPortrait(track)) return;
      const dur = effectiveDuration(track);
      if (dur <= 0) return;
      const refScaledW = Math.round((track.width! * canvasH) / track.height!);
      const creatorFillW = canvasW - refScaledW;
      if (creatorFillW > 0) {
        filters.push(
          `[0:v]scale=${creatorFillW}:${canvasH}:force_original_aspect_ratio=increase,crop=${creatorFillW}:${canvasH},setsar=1[creator_left${i}]`
        );
      }
    });
  }

  // Build the time intervals where references are active
  const intervals: { start: number; end: number }[] = [];
  tracks.forEach((t) => {
    const dur = effectiveDuration(t);
    if (dur > 0) {
      intervals.push({ start: t.startAtS, end: t.startAtS + dur });
    }
  });

  // Create base canvas: black background
  filters.push(`color=c=black:s=${canvasW}x${canvasH}:d=${creatorDurationS}:r=30[bg]`);

  if (isMobile) {
    // Mobile base: creator in bottom half
    filters.push(`[bg][creator_half]overlay=x=0:y=640[base]`);
  } else {
    // Landscape base: just black (full-frame creator overlaid next)
    filters.push(`[bg]copy[base]`);
  }

  // Build enable expression for "no reference active"
  let noRefExpr = '';
  if (intervals.length > 0) {
    const parts = intervals.map((iv) => `between(t,${iv.start.toFixed(3)},${iv.end.toFixed(3)})`);
    noRefExpr = parts.map((p) => `(1-${p})`).join('*');
  }

  // Overlay full-frame creator when no reference is active
  if (noRefExpr) {
    filters.push(`[base][creator_full]overlay=x=0:y=0:enable='gt(${noRefExpr},0.5)'[canvas0]`);
  } else {
    filters.push(`[base][creator_full]overlay=x=0:y=0[canvas0]`);
  }

  // Scale and overlay each reference track
  let prevLabel = 'canvas0';
  let canvasIdx = 1;
  tracks.forEach((track, i) => {
    const inputIdx = i + 1;
    const dur = effectiveDuration(track);
    if (dur <= 0) return;

    const refStart = track.startAtS;
    const refEnd = track.startAtS + dur;
    const enableExpr = `between(t,${refStart.toFixed(3)},${refEnd.toFixed(3)})`;
    const trimFilter = `trim=start=${track.trimStartS.toFixed(3)}:end=${(track.trimEndS ?? track.durationS).toFixed(3)},setpts=PTS-STARTPTS`;

    if (isMobile) {
      // Mobile stacked: reference in top half (720x640)
      const halfW = 720;
      const halfH = 640;
      filters.push(
        `[${inputIdx}:v]${trimFilter},scale=${halfW}:${halfH}:force_original_aspect_ratio=increase,crop=${halfW}:${halfH},setsar=1[ref${i}]`
      );
      const label = `canvas${canvasIdx++}`;
      filters.push(`[${prevLabel}][ref${i}]overlay=x=0:y=0:enable='${enableExpr}'[${label}]`);
      prevLabel = label;
    } else if (isPortrait(track)) {
      // Landscape + portrait reference:
      // Reference scaled to full height, flush-right
      // Creator fills remaining left space
      const refScaledW = Math.round((track.width! * canvasH) / track.height!);
      const creatorFillW = canvasW - refScaledW;
      const refX = canvasW - refScaledW;

      filters.push(
        `[${inputIdx}:v]${trimFilter},scale=${refScaledW}:${canvasH}:force_original_aspect_ratio=increase,crop=${refScaledW}:${canvasH},setsar=1[ref${i}]`
      );

      // Step 1: overlay left-fill creator
      if (creatorFillW > 0) {
        const labelA = `canvas${canvasIdx++}`;
        filters.push(
          `[${prevLabel}][creator_left${i}]overlay=x=0:y=0:enable='${enableExpr}'[${labelA}]`
        );
        prevLabel = labelA;
      }

      // Step 2: overlay portrait reference flush-right
      const labelB = `canvas${canvasIdx++}`;
      filters.push(
        `[${prevLabel}][ref${i}]overlay=x=${refX}:y=0:enable='${enableExpr}'[${labelB}]`
      );
      prevLabel = labelB;
    } else {
      // Landscape + landscape reference:
      // Reference fills entire frame, creator PIP in bottom-right corner
      filters.push(
        `[${inputIdx}:v]${trimFilter},scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH},setsar=1[ref${i}]`
      );

      // Step 1: overlay full-frame reference
      const labelA = `canvas${canvasIdx++}`;
      filters.push(`[${prevLabel}][ref${i}]overlay=x=0:y=0:enable='${enableExpr}'[${labelA}]`);
      prevLabel = labelA;

      // Step 2: overlay creator PIP in bottom-right
      const pipX = canvasW - PIP_W - PIP_MARGIN;
      const pipY = canvasH - PIP_H - PIP_MARGIN;
      const labelB = `canvas${canvasIdx++}`;
      filters.push(
        `[${prevLabel}][creator_pip]overlay=x=${pipX}:y=${pipY}:enable='${enableExpr}'[${labelB}]`
      );
      prevLabel = labelB;
    }
  });

  // Audio mixing
  const audioFilters: string[] = [];
  let audioOut = '';

  if (audioMode === 'creator') {
    audioFilters.push(`[0:a]volume=${creatorVolume.toFixed(2)}[aout]`);
    audioOut = '[aout]';
  } else if (audioMode === 'reference') {
    const refAudioParts: string[] = [];
    tracks.forEach((track, i) => {
      const inputIdx = i + 1;
      if (!track.hasAudio) {
        // Generate silence for tracks without audio
        const dur = effectiveDuration(track);
        audioFilters.push(
          `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=${dur.toFixed(3)}[refsilence${i}]`
        );
        const delayMs = Math.round(track.startAtS * 1000);
        if (delayMs > 0) {
          audioFilters.push(`[refsilence${i}]adelay=${delayMs}|${delayMs}[refa${i}]`);
        } else {
          audioFilters.push(`[refsilence${i}]acopy[refa${i}]`);
        }
        refAudioParts.push(`[refa${i}]`);
      } else {
        const trimEnd = track.trimEndS ?? track.durationS;
        audioFilters.push(
          `[${inputIdx}:a]atrim=start=${track.trimStartS.toFixed(3)}:end=${trimEnd.toFixed(3)},asetpts=PTS-STARTPTS,volume=${referenceVolume.toFixed(2)}[reftrimmed${i}]`
        );
        const delayMs = Math.round(track.startAtS * 1000);
        if (delayMs > 0) {
          audioFilters.push(`[reftrimmed${i}]adelay=${delayMs}|${delayMs}[refa${i}]`);
        } else {
          audioFilters.push(`[reftrimmed${i}]acopy[refa${i}]`);
        }
        refAudioParts.push(`[refa${i}]`);
      }
    });

    if (refAudioParts.length === 1) {
      audioOut = refAudioParts[0];
    } else if (refAudioParts.length > 1) {
      audioFilters.push(
        `${refAudioParts.join('')}amix=inputs=${refAudioParts.length}:duration=longest[aout]`
      );
      audioOut = '[aout]';
    }
  } else {
    // both
    audioFilters.push(`[0:a]volume=${creatorVolume.toFixed(2)}[creatoraudio]`);

    const allAudioParts = ['[creatoraudio]'];
    tracks.forEach((track, i) => {
      const inputIdx = i + 1;
      if (!track.hasAudio) {
        return; // Skip silent tracks in "both" mode
      }
      const trimEnd = track.trimEndS ?? track.durationS;
      audioFilters.push(
        `[${inputIdx}:a]atrim=start=${track.trimStartS.toFixed(3)}:end=${trimEnd.toFixed(3)},asetpts=PTS-STARTPTS,volume=${referenceVolume.toFixed(2)}[reftrimmed${i}]`
      );
      const delayMs = Math.round(track.startAtS * 1000);
      if (delayMs > 0) {
        audioFilters.push(`[reftrimmed${i}]adelay=${delayMs}|${delayMs}[refa${i}]`);
      } else {
        audioFilters.push(`[reftrimmed${i}]acopy[refa${i}]`);
      }
      allAudioParts.push(`[refa${i}]`);
    });

    if (allAudioParts.length === 1) {
      audioOut = '[creatoraudio]';
    } else {
      audioFilters.push(
        `${allAudioParts.join('')}amix=inputs=${allAudioParts.length}:duration=longest[aout]`
      );
      audioOut = '[aout]';
    }
  }

  const fullFilter = [...filters, ...audioFilters].join(';\n');
  const outputMap = [`[${prevLabel}]`, audioOut];

  return { filterComplex: fullFilter, outputMap: outputMap.filter(Boolean) };
}

/**
 * Download an S3 file to a local temp path.
 */
export async function downloadToTemp(s3Url: string): Promise<string> {
  const { downloadFeedVideoToTemp } = await import('./download');
  return downloadFeedVideoToTemp(s3Url);
}

export interface RenderResult {
  s3Key: string;
  s3Url: string;
  durationMs: number;
  fileSizeBytes?: number;
}

/**
 * Render a composition layout to S3.
 */
export async function renderComposition(
  opts: ComposeOptions,
  s3Key: string,
  onProgress?: (timeS: number) => void
): Promise<RenderResult> {
  const startMs = Date.now();

  const { filterComplex, outputMap } = buildFilterComplex(opts);

  // Build ffmpeg args
  const ffmpegArgs: string[] = [];

  // Input: creator
  ffmpegArgs.push('-i', opts.creatorPath);

  // Inputs: reference tracks
  for (const track of opts.tracks) {
    ffmpegArgs.push('-i', track.localPath);
  }

  // Filter complex
  ffmpegArgs.push('-filter_complex', filterComplex);

  // Map outputs
  for (const m of outputMap) {
    ffmpegArgs.push('-map', m);
  }

  // Output settings
  ffmpegArgs.push(
    '-t',
    opts.creatorDurationS.toFixed(3),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    'frag_keyframe+empty_moov',
    '-f',
    'mp4',
    'pipe:1'
  );

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  let ffmpegErrorOutput = '';
  ffmpeg.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    ffmpegErrorOutput += text;

    // Parse progress from stderr
    if (onProgress) {
      const match = text.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
      if (match) {
        const timeS =
          parseInt(match[1]) * 3600 +
          parseInt(match[2]) * 60 +
          parseInt(match[3]) +
          parseInt(match[4]) / 100;
        onProgress(timeS);
      }
    }
  });

  const outputStream = new PassThrough();
  ffmpeg.stdout.pipe(outputStream);

  const ffmpegDone = new Promise<void>((resolve, reject) => {
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${ffmpegErrorOutput.slice(-2000)}`));
      }
    });
  });

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: CLIPS_BUCKET,
      Key: s3Key,
      Body: outputStream,
      ContentType: 'video/mp4',
    },
  });

  await Promise.all([upload.done(), ffmpegDone]);

  const durationMs = Date.now() - startMs;

  return {
    s3Key,
    s3Url: `https://${CLIPS_BUCKET}.s3.${CLIPS_REGION}.amazonaws.com/${s3Key}`,
    durationMs,
  };
}
