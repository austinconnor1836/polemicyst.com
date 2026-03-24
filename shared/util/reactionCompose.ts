import { spawn } from 'child_process';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateAssSubtitles, type TranscriptSegment } from './ffmpegUtils';
import { getCaptionFontSizePx, type CaptionFontSize } from '@shared/virality';

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

export interface ComposeCaptionOptions {
  font?: string;
  fontSize?: CaptionFontSize;
  /** Creator transcript segments (times relative to UNTRIMMED creator video) */
  creatorSegments?: TranscriptSegment[];
  /** Per-track transcript segments (times relative to each track's original video) */
  trackSegments?: Array<{
    segments: TranscriptSegment[];
    startAtS: number;
    trimStartS: number;
    trimEndS: number | null;
  }>;
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
  captions?: ComposeCaptionOptions;
}

/**
 * Effective duration of a reference track after trimming.
 */
function effectiveDuration(track: TrackInfo): number {
  const end = track.trimEndS ?? track.durationS;
  return Math.max(0, end - track.trimStartS);
}

// Creator picture-in-picture size for landscape mode (bottom-right overlay, flush)
const PIP_W = 480;
const PIP_H = 270;
const PIP_MARGIN = 0;

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
      // Mobile: reference scaled to full width (720), aspect ratio preserved.
      // For portrait refs this fills the frame; for landscape refs the height
      // is proportional (e.g. 720x405 for 16:9) and centered above the creator.
      const refIsPortrait = isPortrait(track);
      if (refIsPortrait) {
        // Portrait reference — fill entire frame, creator overlaid at bottom
        filters.push(
          `[${inputIdx}:v]${trimFilter},scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH},setsar=1[ref${i}]`
        );
      } else {
        // Landscape reference — scale to full width, keep aspect ratio
        filters.push(`[${inputIdx}:v]${trimFilter},scale=${canvasW}:-2,setsar=1[ref${i}]`);
      }

      if (refIsPortrait) {
        // Portrait: overlay full-frame reference, creator at bottom
        const labelA = `canvas${canvasIdx++}`;
        filters.push(
          `[${prevLabel}][ref${i}]overlay=x=0:y=0:eof_action=repeat:enable='${enableExpr}'[${labelA}]`
        );
        prevLabel = labelA;

        const creatorY = canvasH - MOBILE_CREATOR_H;
        const labelB = `canvas${canvasIdx++}`;
        filters.push(
          `[${prevLabel}][creator_mobile]overlay=x=0:y=${creatorY}:enable='${enableExpr}'[${labelB}]`
        );
        prevLabel = labelB;
      } else {
        // Landscape ref: place reference at top, creator flush at bottom.
        // Reference is full-width, proportional height — center it in the
        // space above the creator overlay.
        const refH =
          track.width && track.height
            ? Math.round((canvasW * track.height) / track.width)
            : Math.round((canvasW * 9) / 16); // fallback 16:9
        const availableH = canvasH - MOBILE_CREATOR_H;
        const refY = Math.round((availableH - refH) / 2);

        const labelA = `canvas${canvasIdx++}`;
        filters.push(
          `[${prevLabel}][ref${i}]overlay=x=0:y=${Math.max(0, refY)}:eof_action=repeat:enable='${enableExpr}'[${labelA}]`
        );
        prevLabel = labelA;

        const creatorY = canvasH - MOBILE_CREATOR_H;
        const labelB = `canvas${canvasIdx++}`;
        filters.push(
          `[${prevLabel}][creator_mobile]overlay=x=0:y=${creatorY}:enable='${enableExpr}'[${labelB}]`
        );
        prevLabel = labelB;
      }
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
 * Pre-trim the creator video using filter-level trim (frame-accurate, no keyframe snap).
 * Produces a clean intermediate with 1 video + 1 audio stream for perfect A/V sync.
 */
async function preTrimCreator(
  creatorPath: string,
  trimStartS: number,
  trimEndS: number,
  creatorDurationS: number
): Promise<{ path: string; durationS: number }> {
  const durationS = trimEndS - trimStartS;
  const needsTrim = trimStartS > 0.01 || trimEndS < creatorDurationS - 0.01;

  const tmpPath = path.join(
    os.tmpdir(),
    `creator-trim-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`
  );

  console.log(
    `[preTrimCreator] ${needsTrim ? 'Filter-trim' : 'Normalize'} ${trimStartS.toFixed(3)}s → ${trimEndS.toFixed(3)}s (${durationS.toFixed(3)}s)`
  );

  // Always normalize the creator video to ensure:
  // - Single video stream with square SAR (setsar=1) and consistent pixel format
  // - Single audio stream (0:a:0) — eliminates iPhone multi-mic streams
  // - No rotation metadata — FFmpeg auto-rotates during filter_complex
  // - Constant frame rate
  // This prevents recurring width/scaling issues in the main render step.
  // When trimming, uses filter_complex trim+atrim for frame-accurate cutting.
  // -bf 0 prevents B-frame reordering delay so video starts at PTS 0.
  // aresample=async=1:first_pts=0 forces audio to sync with video timestamps.
  const videoFilter = needsTrim
    ? `[0:v]trim=start=${trimStartS.toFixed(3)}:end=${trimEndS.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v]`
    : `[0:v]format=yuv420p,setsar=1[v]`;
  const audioFilter = needsTrim
    ? `[0:a:0]atrim=start=${trimStartS.toFixed(3)}:end=${trimEndS.toFixed(3)},asetpts=PTS-STARTPTS,aresample=async=1:first_pts=0[a]`
    : `[0:a:0]aresample=async=1:first_pts=0[a]`;
  const filterComplex = [videoFilter, audioFilter].join(';');

  const args = [
    '-i',
    creatorPath,
    '-filter_complex',
    filterComplex,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '18',
    '-bf',
    '0',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-y',
    tmpPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`preTrimCreator ffmpeg failed (code ${code}): ${stderr.slice(-1000)}`));
    });
  });

  console.log(`[preTrimCreator] Done → ${tmpPath}`);
  return { path: tmpPath, durationS };
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

  // Pre-trim creator for perfect A/V sync (uses filter-level trim, not -ss seek)
  const trimStartS = opts.creatorTrimStartS ?? 0;
  const trimEndS = opts.creatorTrimEndS ?? opts.creatorDurationS;
  const trimResult = await preTrimCreator(
    opts.creatorPath,
    trimStartS,
    trimEndS,
    opts.creatorDurationS
  );

  // Build filter_complex with the pre-trimmed creator (no trim needed)
  const trimmedOpts: ComposeOptions = {
    ...opts,
    creatorPath: trimResult.path,
    creatorDurationS: trimResult.durationS,
    creatorTrimStartS: 0,
    creatorTrimEndS: undefined,
  };

  let { filterComplex, outputMap } = buildFilterComplex(trimmedOpts);

  // --- Burn-in captions (ASS subtitles) ---
  let assFilePath: string | null = null;
  if (opts.captions) {
    const isMobile = opts.layout === 'mobile';
    const canvasW = isMobile ? 720 : 1280;
    const canvasH = isMobile ? 1280 : 720;
    const outputDurationS = trimResult.durationS;
    const creatorTrimOffset = trimStartS; // original creator trim start

    // Collect and time-adjust segments to the output timeline
    const outputSegments: TranscriptSegment[] = [];

    if (opts.audioMode === 'creator' || opts.audioMode === 'both') {
      // Creator segments: times are relative to the untrimmed creator.
      // After pre-trim, output t=0 corresponds to original t=creatorTrimOffset.
      for (const seg of opts.captions.creatorSegments ?? []) {
        const start = seg.start - creatorTrimOffset;
        const end = seg.end - creatorTrimOffset;
        if (end > 0 && start < outputDurationS) {
          outputSegments.push({
            start: Math.max(0, start),
            end: Math.min(outputDurationS, end),
            text: seg.text,
          });
        }
      }
    }

    if (opts.audioMode === 'reference' || opts.audioMode === 'both') {
      // Track segments: each segment time is relative to the track's original video.
      // After trim + placement: outputTime = seg.time - trimStartS + startAtS
      for (const ts of opts.captions.trackSegments ?? []) {
        for (const seg of ts.segments) {
          const start = seg.start - ts.trimStartS + ts.startAtS;
          const end = seg.end - ts.trimStartS + ts.startAtS;
          if (end > 0 && start < outputDurationS) {
            outputSegments.push({
              start: Math.max(0, start),
              end: Math.min(outputDurationS, end),
              text: seg.text,
            });
          }
        }
      }
    }

    if (outputSegments.length > 0) {
      // Sort by start time (merged creator + reference segments may interleave)
      outputSegments.sort((a, b) => a.start - b.start);

      const fontSizePx = getCaptionFontSizePx(opts.captions.fontSize);
      const assContent = generateAssSubtitles(
        outputSegments,
        0,
        outputDurationS,
        opts.captions.font || 'DejaVu Sans',
        fontSizePx,
        canvasW,
        canvasH
      );

      assFilePath = path.join(
        os.tmpdir(),
        `comp-captions-${Date.now()}-${Math.random().toString(36).slice(2)}.ass`
      );
      fs.writeFileSync(assFilePath, assContent, 'utf-8');

      // Append ASS filter: take current video output, apply subtitles
      const videoLabel = outputMap[0]; // e.g. '[canvas5]'
      const labelName = videoLabel.replace(/[\[\]]/g, ''); // e.g. 'canvas5'
      const escapedPath = assFilePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
      filterComplex += `;\n[${labelName}]ass='${escapedPath}'[captioned]`;
      outputMap[0] = '[captioned]';

      console.log(
        `[renderComposition] Captions: ${outputSegments.length} segments, ASS file: ${assFilePath}`
      );
    }
  }

  console.log(`[renderComposition] layout=${opts.layout} filter_complex:\n${filterComplex}`);
  console.log(`[renderComposition] outputMap: ${JSON.stringify(outputMap)}`);

  // Build ffmpeg args
  const ffmpegArgs: string[] = [];

  // Input: pre-trimmed creator (clean 1 video + 1 audio, synced)
  ffmpegArgs.push('-i', trimResult.path);

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
  const outputDuration = trimResult.durationS;
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
      // Clean up ASS temp file
      if (assFilePath) {
        try {
          fs.unlinkSync(assFilePath);
        } catch {}
      }
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

  // Clean up temp files
  try {
    fs.unlinkSync(tmpOut);
  } catch {}
  if (trimResult.path !== opts.creatorPath) {
    try {
      fs.unlinkSync(trimResult.path);
    } catch {}
  }

  const durationMs = Date.now() - startMs;

  return {
    s3Key,
    s3Url: `https://${getBucket()}.s3.${getRegion()}.amazonaws.com/${s3Key}`,
    durationMs,
    fileSizeBytes,
  };
}
