import { spawn } from 'child_process';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

console.log('[reactionCompose] Module loaded — v2 with eof_action+gte');

// Lazy S3 init — env vars may not be loaded yet when this module is imported statically
let _s3: S3Client | null = null;
function getS3() {
  if (!_s3) {
    const region = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-2';
    _s3 = new S3Client({ region });
  }
  return _s3;
}
function getBucket() {
  return process.env.S3_BUCKET || 'clips-genie-uploads';
}
function getRegion() {
  return process.env.S3_REGION || process.env.AWS_REGION || 'us-east-2';
}

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
  creatorTrimStartS?: number;
  creatorTrimEndS?: number | null;
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

// Creator overlay for mobile mode: full-width, flush with bottom
// Height is proportional (16:9 creator at 720w = 405h)
const MOBILE_CREATOR_W = 720;
const MOBILE_CREATOR_H = 405;

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
 * Mobile (720x1280):
 *   - Full-frame creator (720x1280) shown when no reference is active
 *   - Each reference fills the entire frame (720x1280)
 *   - Creator overlaid full-width at bottom (flush) when a reference is active
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
  const { layout, tracks, audioMode, creatorVolume, referenceVolume } = opts;
  // Creator trim values for filter-level trimming
  const creatorTrimStart = opts.creatorTrimStartS ?? 0;
  const creatorTrimEnd = opts.creatorTrimEndS ?? opts.creatorDurationS;
  const effectiveCreatorDuration = creatorTrimEnd - creatorTrimStart;
  const needsCreatorTrim = creatorTrimStart > 0 || creatorTrimEnd < opts.creatorDurationS;
  const creatorTrimFilter = needsCreatorTrim
    ? `trim=start=${creatorTrimStart.toFixed(3)}:end=${creatorTrimEnd.toFixed(3)},setpts=PTS-STARTPTS,`
    : '';
  const creatorAudioTrimFilter = needsCreatorTrim
    ? `atrim=start=${creatorTrimStart.toFixed(3)}:end=${creatorTrimEnd.toFixed(3)},asetpts=PTS-STARTPTS,`
    : '';

  const isMobile = layout === 'mobile';
  const canvasW = isMobile ? 720 : 1280;
  const canvasH = isMobile ? 1280 : 720;

  const filters: string[] = [];

  // Full-frame creator (for solo / no-reference-active state)
  filters.push(
    `[0:v]${creatorTrimFilter}scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH},setsar=1[creator_full]`
  );

  if (isMobile) {
    // Mobile: creator overlay at bottom of frame (reference fills full frame)
    filters.push(
      `[0:v]${creatorTrimFilter}scale=${MOBILE_CREATOR_W}:${MOBILE_CREATOR_H}:force_original_aspect_ratio=increase,crop=${MOBILE_CREATOR_W}:${MOBILE_CREATOR_H},setsar=1[creator_mobile]`
    );
  } else {
    // Landscape: PIP creator only if there's at least one landscape reference
    const hasLandscapeRef = tracks.some((t) => !isPortrait(t) && effectiveDuration(t) > 0);
    if (hasLandscapeRef) {
      filters.push(
        `[0:v]${creatorTrimFilter}scale=${PIP_W}:${PIP_H}:force_original_aspect_ratio=increase,crop=${PIP_W}:${PIP_H},setsar=1[creator_pip]`
      );
    }

    // Pre-scale creator variants for each portrait reference (each has different fill width)
    tracks.forEach((track, i) => {
      if (!isPortrait(track)) return;
      const dur = effectiveDuration(track);
      if (dur <= 0) return;
      const refScaledW = Math.round((track.width! * canvasH) / track.height!);
      const creatorFillW = canvasW - refScaledW;
      if (creatorFillW > 0) {
        filters.push(
          `[0:v]${creatorTrimFilter}scale=${creatorFillW}:${canvasH}:force_original_aspect_ratio=increase,crop=${creatorFillW}:${canvasH},setsar=1[creator_left${i}]`
        );
      }
    });
  }

  // Create base canvas: black background
  filters.push(`color=c=black:s=${canvasW}x${canvasH}:d=${effectiveCreatorDuration}:r=30[bg]`);
  filters.push(`[bg]copy[base]`);

  // Overlay full-frame creator as base layer (visible when no reference covers it)
  filters.push(`[base][creator_full]overlay=x=0:y=0[canvas0]`);

  // Scale and overlay each reference track
  let prevLabel = 'canvas0';
  let canvasIdx = 1;
  tracks.forEach((track, i) => {
    const inputIdx = i + 1;
    const dur = effectiveDuration(track);
    if (dur <= 0) return;

    const refStart = track.startAtS;
    const enableExpr = `gte(t,${refStart.toFixed(3)})`;
    const trimFilter = `trim=start=${track.trimStartS.toFixed(3)}:end=${(track.trimEndS ?? track.durationS).toFixed(3)},setpts=PTS-STARTPTS`;

    if (isMobile) {
      // Mobile: reference fills entire frame, creator overlaid at bottom-center
      filters.push(
        `[${inputIdx}:v]${trimFilter},scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH},setsar=1[ref${i}]`
      );

      // Step 1: overlay full-frame reference (eof_action=repeat freezes last frame)
      const labelA = `canvas${canvasIdx++}`;
      filters.push(
        `[${prevLabel}][ref${i}]overlay=x=0:y=0:eof_action=repeat:enable='${enableExpr}'[${labelA}]`
      );
      prevLabel = labelA;

      // Step 2: overlay creator full-width at bottom, flush
      const creatorY = canvasH - MOBILE_CREATOR_H;
      const labelB = `canvas${canvasIdx++}`;
      filters.push(
        `[${prevLabel}][creator_mobile]overlay=x=0:y=${creatorY}:enable='${enableExpr}'[${labelB}]`
      );
      prevLabel = labelB;
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

      // Step 2: overlay portrait reference flush-right (eof_action=repeat freezes last frame)
      const labelB = `canvas${canvasIdx++}`;
      filters.push(
        `[${prevLabel}][ref${i}]overlay=x=${refX}:y=0:eof_action=repeat:enable='${enableExpr}'[${labelB}]`
      );
      prevLabel = labelB;
    } else {
      // Landscape + landscape reference:
      // Reference fills entire frame, creator PIP in bottom-right corner
      filters.push(
        `[${inputIdx}:v]${trimFilter},scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH},setsar=1[ref${i}]`
      );

      // Step 1: overlay full-frame reference (eof_action=repeat freezes last frame)
      const labelA = `canvas${canvasIdx++}`;
      filters.push(
        `[${prevLabel}][ref${i}]overlay=x=0:y=0:eof_action=repeat:enable='${enableExpr}'[${labelA}]`
      );
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
    audioFilters.push(`[0:a]${creatorAudioTrimFilter}volume=${creatorVolume.toFixed(2)}[aout]`);
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
    audioFilters.push(
      `[0:a]${creatorAudioTrimFilter}volume=${creatorVolume.toFixed(2)}[creatoraudio]`
    );

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

  console.log(`[renderComposition] layout=${opts.layout} filter_complex:\n${filterComplex}`);
  console.log(`[renderComposition] outputMap: ${JSON.stringify(outputMap)}`);

  // Build ffmpeg args
  const ffmpegArgs: string[] = [];

  // Input: creator video
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

  // Output settings — write to temp file for proper MP4 muxing.
  const trimStartS = opts.creatorTrimStartS ?? 0;
  const trimEndS = opts.creatorTrimEndS ?? opts.creatorDurationS;
  const outputDuration = trimEndS - trimStartS;
  const tmpOut = path.join(
    os.tmpdir(),
    `compose-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`
  );
  ffmpegArgs.push(
    '-t',
    outputDuration.toFixed(3),
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
    '+faststart',
    '-y',
    tmpOut
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

  await new Promise<void>((resolve, reject) => {
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${ffmpegErrorOutput.slice(-2000)}`));
      }
    });
  });

  // Upload the rendered file to S3
  const fileStream = fs.createReadStream(tmpOut);
  const fileSizeBytes = fs.statSync(tmpOut).size;

  const upload = new Upload({
    client: getS3(),
    params: {
      Bucket: getBucket(),
      Key: s3Key,
      Body: fileStream,
      ContentType: 'video/mp4',
    },
  });

  await upload.done();

  // Clean up temp file
  try {
    fs.unlinkSync(tmpOut);
  } catch {}

  const durationMs = Date.now() - startMs;

  return {
    s3Key,
    s3Url: `https://${getBucket()}.s3.${getRegion()}.amazonaws.com/${s3Key}`,
    durationMs,
    fileSizeBytes,
  };
}
