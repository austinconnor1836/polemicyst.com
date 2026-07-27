/**
 * Server-side Split-Frame compositor.
 *
 * Composes a portrait 9:16 video where the top half is the user's video and
 * the bottom half is a user-provided static image. Mirrors the design of
 * `shared/util/stitchCompose.ts` — pure filter-graph builders + a single
 * `composeSplitFrame(...)` entry point that shells out to FFmpeg.
 *
 * Output canvas: 720 × 1280. Top half: 720 × 640. Bottom half: 720 × 640.
 * Each half is fit with `force_original_aspect_ratio=decrease` + a black
 * `pad` so mismatched aspect ratios letterbox instead of stretching.
 *
 * Audio comes from the input video (copied to AAC 128k). The static image
 * loops for exactly the video's duration; the output is trimmed to the video
 * duration via `-shortest`.
 */

import { spawn } from 'child_process';

import {
  SPLIT_FRAME_OUTPUT_HEIGHT,
  SPLIT_FRAME_OUTPUT_WIDTH,
  type SplitFrameManifest,
} from '../lib/split-frame/manifest';

// ============================================================================
// Types
// ============================================================================

export interface SplitFrameComposeInputs {
  /** Local file path for the user's video (downloaded from `manifest.videoUrl`). */
  videoLocalPath: string;
  /** Local file path for the static image (downloaded from `manifest.imageUrl`). */
  imageLocalPath: string;
}

export interface SplitFrameComposeOptions {
  manifest: SplitFrameManifest;
  inputs: SplitFrameComposeInputs;
  outputPath: string;
}

export interface SplitFrameComposeResult {
  outputPath: string;
}

/** Canvas + per-half dimensions. Both halves are exactly canvas_h / 2 tall. */
export interface SplitFrameCanvas {
  width: number;
  height: number;
  halfHeight: number;
}

export function splitFrameCanvas(manifest: SplitFrameManifest): SplitFrameCanvas {
  const width = manifest.outputWidth ?? SPLIT_FRAME_OUTPUT_WIDTH;
  const height = manifest.outputHeight ?? SPLIT_FRAME_OUTPUT_HEIGHT;
  return {
    width,
    height,
    halfHeight: Math.round(height / 2),
  };
}

// ============================================================================
// Pure filter-graph builders (unit-testable, no FFmpeg spawn)
// ============================================================================

/**
 * Builds the `filter_complex` graph:
 *
 *   [0:v] fps=30, scale-to-fit(720×640), pad → [top]
 *   [1:v] scale-to-fit(720×640), pad         → [bot]
 *   [top][bot] vstack                        → [stackedRaw]
 *   [stackedRaw] drawtext(caption) [optional] → [vout]
 *
 * The input index convention is:
 *   0 = video
 *   1 = image (looped)
 *
 * The image is treated as a looped input (`-loop 1 -framerate 30 -t <videoDur>`)
 * at the argv level; here we just address it as `[1:v]`.
 */
export function buildSplitFrameFilterComplex(
  manifest: SplitFrameManifest,
  canvas: SplitFrameCanvas = splitFrameCanvas(manifest)
): string {
  const W = canvas.width;
  const HALF = canvas.halfHeight;
  const CFR = 'fps=30,setpts=PTS-STARTPTS';

  const parts: string[] = [];

  // Top: video → fit into 720 × 640 with letterbox pad to black.
  parts.push(
    `[0:v]${CFR},scale=${W}:${HALF}:force_original_aspect_ratio=decrease,` +
      `pad=${W}:${HALF}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[top]`
  );

  // Bottom: image → fit into 720 × 640 with letterbox pad to black.
  // The image is a still, so no fps/setpts — the `-loop 1 -framerate 30`
  // input args handle its temporal shape.
  parts.push(
    `[1:v]scale=${W}:${HALF}:force_original_aspect_ratio=decrease,` +
      `pad=${W}:${HALF}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p[bot]`
  );

  // Stack them vertically → 720 × 1280.
  parts.push(`[top][bot]vstack=inputs=2[stackedRaw]`);

  const captionTrimmed = manifest.caption?.trim() ?? '';
  if (captionTrimmed.length > 0) {
    parts.push(`[stackedRaw]${buildCaptionDrawtext(captionTrimmed, canvas)}[vout]`);
  } else {
    parts.push(`[stackedRaw]null[vout]`);
  }

  return parts.join(';');
}

/**
 * Builds a single `drawtext=...` filter for the optional caption. Positioned
 * one-eighth of the canvas height above the bottom edge so it sits within
 * the bottom (image) half without covering the visual focus.
 *
 * Escapes drawtext-special chars the same way `stitchCompose.escapeDrawtext`
 * does. Pure — takes text + canvas, returns a string.
 */
export function buildCaptionDrawtext(text: string, canvas: SplitFrameCanvas): string {
  const escaped = escapeDrawtext(text);
  // Font size scales with canvas width (7% of width) so the caption reads
  // similarly on any future canvas size.
  const fontSize = Math.max(24, Math.round(canvas.width * 0.07));
  const yBase = canvas.height - Math.round(canvas.height / 8);
  const parts: string[] = [
    `drawtext=text='${escaped}'`,
    `fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf`,
    `fontsize=${fontSize}`,
    `fontcolor=white`,
    // Center horizontally, sit above the bottom edge.
    `x=(w-text_w)/2`,
    `y=${yBase}-text_h/2`,
    `box=1`,
    `boxcolor=black@0.55`,
    `boxborderw=12`,
  ];
  return parts.join(':');
}

/**
 * Escape rules for FFmpeg drawtext — same set as
 * `shared/util/stitchCompose.escapeDrawtext`. Single quotes are replaced with
 * a curly apostrophe because the drawtext parser is famously hostile to
 * escaped quotes inside a quoted argument.
 */
export function escapeDrawtext(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '’').replace(/%/g, '\\%');
}

/**
 * Full FFmpeg argv for the compose invocation. Pure — no spawn, no I/O.
 * Callers pass in the local file paths + output path; this returns the
 * exact `ffmpeg` argument list. Handy for unit tests that snapshot the
 * command.
 */
export function buildSplitFrameFfmpegArgv(opts: SplitFrameComposeOptions): string[] {
  const filterComplex = buildSplitFrameFilterComplex(opts.manifest);
  return [
    // Input 0 — the user's video.
    '-i',
    opts.inputs.videoLocalPath,
    // Input 1 — the static image, looped at 30 fps for the whole video duration.
    // `-shortest` on the output cuts the composed video off at the video's
    // duration (audio + video both end there), so we don't need to know the
    // exact duration up-front to set `-t` on the image input.
    '-loop',
    '1',
    '-framerate',
    '30',
    '-i',
    opts.inputs.imageLocalPath,
    '-filter_complex',
    filterComplex,
    '-map',
    '[vout]',
    // Optional audio map — some source videos have no audio track, in which
    // case `-map 0:a?` produces a valid mp4 without one.
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    // Pin output to constant 30 fps. `stitchCompose` documents in detail why
    // this matters — VFR sources + a looped still image will otherwise fight
    // libx264's rate control and produce enormous frame-dup counts.
    '-r',
    '30',
    '-fps_mode',
    'cfr',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    // End when the shortest input (the video) ends. This is what stops the
    // looped image from running forever.
    '-shortest',
    '-y',
    opts.outputPath,
  ];
}

// ============================================================================
// FFmpeg spawn (impure — the only side-effectful bit)
// ============================================================================

export async function composeSplitFrame(
  opts: SplitFrameComposeOptions
): Promise<SplitFrameComposeResult> {
  const argv = buildSplitFrameFfmpegArgv(opts);
  console.log(`📼 [split-frame-render] ffmpeg argv: ${argv.join(' ')}`);
  await spawnFfmpegPromise(argv);
  return { outputPath: opts.outputPath };
}

function spawnFfmpegPromise(argv: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        // Surface the LAST 8 KB of stderr. Same rationale as stitchCompose —
        // the tail of the ffmpeg banner is where libavfilter prints the
        // actual failure line.
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-8000)}`));
      }
    });
  });
}
