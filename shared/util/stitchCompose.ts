/**
 * Server-side stitch compositor.
 *
 * Mirrors the iOS in-app renderer in `Features/Stitch/StitchRenderer.swift`
 * but runs the heavy lifting (segmentation + freeze frame extraction + final
 * H.264 encode) in FFmpeg + a Python MediaPipe sidecar so the user's phone
 * can background the app while the export completes.
 *
 * Two styles are supported:
 *   - `freezeReveal`: reference plays in full; on its last frame the video
 *     freezes; the creator clip plays segmented (alpha-merged via mask)
 *     over the frozen frame, positioned + scaled per the `cutout` manifest.
 *   - `freeform`: concatenate the manifest's clips in array order (optionally
 *     each segmented) with text overlays burned in per clip's duration.
 *
 * Two-pass architecture
 * ---------------------
 * Earlier revisions did everything in one ffmpeg invocation: alphamerge,
 * scale, overlay, drawtext, concat, and H.264 encode all in one filter
 * graph. That fused every per-frame op into a single serialized pipeline and
 * a 94 s video took 1–3+ minutes to render.
 *
 * The current shape splits the work in two:
 *
 *   Pass 1 (prebake, once per BG-removed clip): take the raw video + mask,
 *           `alphamerge` them, encode to a **transparent intermediate**
 *           (QuickTime RLE in a `.mov`). RLE is lossless, supports alpha,
 *           and encodes very fast. The expensive per-pixel alpha work
 *           happens here, in isolation, with no downstream encode contention.
 *
 *   Pass 2 (composite, one invocation): consume the pre-baked transparent
 *           `.mov`s (or raw clips when no BG removal) plus the freeze PNG,
 *           do a simple `overlay` (no alphamerge — alpha is already in the
 *           input), burn drawtext, concat, encode H.264. The filter graph
 *           is dramatically simpler.
 *
 * The filter-graph builders are still split into small pure functions so they
 * can be unit-tested without spawning FFmpeg.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

import {
  layoutCanvasSize,
  type ManifestColor,
  type StitchLayout,
  type StitchManifest,
  type StitchTextOverlayManifest,
} from '../lib/stitch/manifest';

/** Local file paths the compositor needs. The worker is responsible for
 *  downloading the S3 inputs to disk and running segmentation upstream. */
export interface StitchComposeOptions {
  manifest: StitchManifest;
  /** Local path for `manifest.clips[0]` (reference). */
  refClipLocalPath: string;
  /** Local path for `manifest.clips[1]` (creator) when freezeReveal,
   *  or `manifest.clips[i]` for freeform. */
  creatorClipLocalPath: string;
  /** Mask video for the creator clip when `removeBackground` is set. */
  creatorMaskLocalPath?: string;
  /** Mask video for the reference clip when `removeBackground` is set
   *  (used for the freeze frame extraction). */
  refMaskLocalPath?: string;
  outputLayout: StitchLayout;
  outputPath: string;
}

export interface StitchComposeResult {
  outputPath: string;
  durationS: number;
}

/**
 * Public entry point. Extracts the freeze frame (if needed), prebakes
 * transparent intermediates for any BG-removed clips, then runs the
 * composite ffmpeg. Caller is responsible for cleaning up `outputPath`
 * and the original temp inputs.
 */
export async function renderStitch(opts: StitchComposeOptions): Promise<StitchComposeResult> {
  const { manifest } = opts;
  const canvas = layoutCanvasSize(opts.outputLayout);

  if (manifest.style === 'freezeReveal') {
    return renderFreezeReveal(opts, canvas);
  }
  return renderFreeform(opts, canvas);
}

// ============================================================================
// freezeReveal — the primary path
// ============================================================================

async function renderFreezeReveal(
  opts: StitchComposeOptions,
  canvas: { width: number; height: number }
): Promise<StitchComposeResult> {
  const { manifest } = opts;
  if (manifest.clips.length !== 2) {
    throw new Error('freezeReveal requires exactly 2 clips (reference, creator)');
  }
  const ref = manifest.clips[0];
  const creator = manifest.clips[1];

  const refDur = Math.max(0.05, ref.trimEndS - ref.trimStartS);
  const creatorDur = Math.max(0.05, creator.trimEndS - creator.trimStartS);

  // 1. Extract the freeze frame from the reference clip just before trimEndS.
  //    A separate ffmpeg invocation keeps the main filter graph simple
  //    (looping an image is one input; computing it inline would mean a
  //    cross-segment select+freeze which fights with `concat` quirks).
  const freezePath = path.join(os.tmpdir(), `stitch-freeze-${randomUUID()}.png`);
  // Seek a small epsilon back from trimEndS so we never land past EOF.
  const freezeAtS = Math.max(0, ref.trimEndS - 0.05);
  await extractFrame(opts.refClipLocalPath, freezeAtS, freezePath);

  // 2. Prebake transparent intermediates for any BG-removed clips. This is
  //    where the expensive `alphamerge` runs — in isolation, encoded fast to
  //    qtrle .mov so the main composite below sees a simple alpha input.
  const prebakedFiles: string[] = [];
  let refCompositeInput = opts.refClipLocalPath;
  let creatorCompositeInput = opts.creatorClipLocalPath;

  try {
    if (ref.removeBackground && opts.refMaskLocalPath) {
      const out = path.join(
        os.tmpdir(),
        `stitch-prebaked-${ref.trackId}-${Date.now()}-${randomUUID().slice(0, 8)}.mov`
      );
      await runPrebake({
        clipPath: opts.refClipLocalPath,
        maskPath: opts.refMaskLocalPath,
        outputPath: out,
      });
      prebakedFiles.push(out);
      refCompositeInput = out;
    }
    if (creator.removeBackground && opts.creatorMaskLocalPath) {
      const out = path.join(
        os.tmpdir(),
        `stitch-prebaked-${creator.trackId}-${Date.now()}-${randomUUID().slice(0, 8)}.mov`
      );
      await runPrebake({
        clipPath: opts.creatorClipLocalPath,
        maskPath: opts.creatorMaskLocalPath,
        outputPath: out,
      });
      prebakedFiles.push(out);
      creatorCompositeInput = out;
    }

    const inputs = buildFreezeRevealInputs({
      refPath: refCompositeInput,
      creatorPath: creatorCompositeInput,
      freezePath,
      creatorDurationS: creatorDur,
    });

    const videoFilter = buildFreezeRevealVideoFilter({
      manifest,
      canvas,
      refTrimStartS: ref.trimStartS,
      refTrimEndS: ref.trimEndS,
      creatorTrimStartS: creator.trimStartS,
      creatorTrimEndS: creator.trimEndS,
      refHasAlpha: ref.removeBackground && !!opts.refMaskLocalPath,
      creatorHasAlpha: creator.removeBackground && !!opts.creatorMaskLocalPath,
      inputs,
    });

    const audioFilter = buildFreezeRevealAudioFilter({
      refTrimStartS: ref.trimStartS,
      refTrimEndS: ref.trimEndS,
      creatorTrimStartS: creator.trimStartS,
      creatorTrimEndS: creator.trimEndS,
      refDurationS: refDur,
      creatorDurationS: creatorDur,
      inputs,
    });

    const totalDur = refDur + creatorDur;

    await runFFmpeg({
      inputs,
      videoFilter,
      audioFilter,
      outputPath: opts.outputPath,
      durationS: totalDur,
    });

    return { outputPath: opts.outputPath, durationS: totalDur };
  } finally {
    try {
      fs.unlinkSync(freezePath);
    } catch {}
    for (const p of prebakedFiles) {
      try {
        fs.unlinkSync(p);
      } catch {}
    }
  }
}

// ============================================================================
// Pass 1: prebake — alphamerge a clip with its mask → transparent qtrle .mov
// ============================================================================

export interface PrebakeArgs {
  clipPath: string;
  maskPath: string;
  outputPath: string;
}

/**
 * Pure: build the filter_complex string for the prebake pass. The mask is
 * assumed to be a grayscale video (the MediaPipe sidecar's output); we coerce
 * it to `gray` for safety, then `alphamerge` into the clip stream. Output
 * label is `[v]`.
 */
export function buildPrebakeFilter(): string {
  return [
    `[0:v]setsar=1[clipv]`,
    `[1:v]format=gray,setsar=1[maskv]`,
    `[clipv][maskv]alphamerge[v]`,
  ].join(';');
}

/**
 * Pure: build the full ffmpeg argv for a prebake pass. Encodes video with
 * `qtrle` (QuickTime RLE) into a `.mov` container — lossless, supports
 * alpha, and encodes ~10× faster than VP9/yuva420p alternatives in our
 * worker environment.
 *
 * Audio is stream-copied from the source clip (`-map 0:a? -c:a copy`) so
 * the composite pass can address audio via the same input slot the
 * prebaked .mov occupies. The `?` makes the audio map optional — clips
 * without an audio track (rare but possible) still produce a valid .mov.
 */
export function buildPrebakeArgv(args: PrebakeArgs): string[] {
  return [
    '-i',
    args.clipPath,
    '-i',
    args.maskPath,
    '-filter_complex',
    buildPrebakeFilter(),
    '-map',
    '[v]',
    '-map',
    '0:a?',
    '-c:v',
    'qtrle',
    '-c:a',
    'copy',
    '-y',
    args.outputPath,
  ];
}

async function runPrebake(args: PrebakeArgs): Promise<void> {
  await spawnFfmpegPromise(buildPrebakeArgv(args));
}

// ============================================================================
// Pass 2: freezeReveal filter graph builders (pure, testable)
// ============================================================================

export interface FreezeRevealInputs {
  /** Ordered list of `-i <path>` arguments. Indices below refer to the position here. */
  argv: string[];
  /** Indices for each named input. */
  refIdx: number;
  creatorIdx: number;
  freezeIdx: number;
}

export function buildFreezeRevealInputs(args: {
  /** Either the raw reference clip or the prebaked transparent .mov. */
  refPath: string;
  /** Either the raw creator clip or the prebaked transparent .mov. */
  creatorPath: string;
  freezePath: string;
  creatorDurationS: number;
}): FreezeRevealInputs {
  const argv: string[] = [];
  let idx = 0;
  const push = (...parts: string[]) => {
    argv.push(...parts);
    return idx++;
  };

  const refIdx = push('-i', args.refPath);
  const creatorIdx = push('-i', args.creatorPath);
  // -loop 1 -t <dur> turns a still PNG into a video stream of the right duration.
  const freezeIdx = push(
    '-loop',
    '1',
    '-t',
    args.creatorDurationS.toFixed(3),
    '-i',
    args.freezePath
  );

  return { argv, refIdx, creatorIdx, freezeIdx };
}

export interface FreezeRevealVideoFilterArgs {
  manifest: StitchManifest;
  canvas: { width: number; height: number };
  refTrimStartS: number;
  refTrimEndS: number;
  creatorTrimStartS: number;
  creatorTrimEndS: number;
  /** True when the ref input is a prebaked transparent .mov (already alpha). */
  refHasAlpha: boolean;
  /** True when the creator input is a prebaked transparent .mov (already alpha). */
  creatorHasAlpha: boolean;
  inputs: FreezeRevealInputs;
}

/**
 * Builds the video portion of `-filter_complex`. Output label is `[vout]`.
 *
 * Structure (no more alphamerge in this pass — alpha already baked in):
 *   [refIdx:v]  trim -> scale -> (composite over black if has alpha) -> [refv]
 *   [freezeIdx:v] scale -> [freeze]
 *   [creatorIdx:v] trim -> scale to cutout size -> [crv]
 *   [freeze][crv] overlay at cutout position -> [revealRaw]
 *   [refv] drawtext (clip-0 overlays)
 *   [revealRaw] drawtext (clip-1 overlays)
 *   [refDrawn][revealDrawn] concat=v=1:a=0 -> [vout]
 */
export function buildFreezeRevealVideoFilter(args: FreezeRevealVideoFilterArgs): string {
  const { manifest, canvas, inputs } = args;
  const parts: string[] = [];
  const W = canvas.width;
  const H = canvas.height;

  // --- Reference segment ---
  parts.push(
    `[${inputs.refIdx}:v]trim=start=${args.refTrimStartS.toFixed(3)}:end=${args.refTrimEndS.toFixed(3)},` +
      `setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[refbase]`
  );
  if (args.refHasAlpha) {
    // Pre-baked input already has alpha. Composite over a solid black canvas
    // so the final concat sees an opaque yuv420p stream.
    parts.push(`color=c=black:s=${W}x${H}[refbg]`);
    parts.push(`[refbg][refbase]overlay=shortest=1:format=auto[refv]`);
  } else {
    parts.push(`[refbase]null[refv]`);
  }

  // --- Freeze frame (background of reveal segment) ---
  parts.push(
    `[${inputs.freezeIdx}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p[freeze]`
  );

  // --- Creator clip (cutout) ---
  const cutoutScale =
    manifest.style === 'freezeReveal' && manifest.cutout
      ? Math.min(2, Math.max(0.05, manifest.cutout.scale))
      : 0.6;
  const cutoutPosX = manifest.cutout?.position.x ?? 0.5;
  const cutoutPosY = manifest.cutout?.position.y ?? 0.5;
  const cutoutH = Math.round(H * cutoutScale);
  // Scale creator so its long edge matches cutoutH while preserving aspect.
  // When the creator already has alpha (prebaked), pass it through unchanged.
  // When it doesn't, coerce to yuva420p so the `overlay` below has a valid
  // alpha channel even though there's nothing to make transparent.
  if (args.creatorHasAlpha) {
    parts.push(
      `[${inputs.creatorIdx}:v]trim=start=${args.creatorTrimStartS.toFixed(3)}:end=${args.creatorTrimEndS.toFixed(3)},` +
        `setpts=PTS-STARTPTS,scale=-2:${cutoutH},setsar=1[crv]`
    );
  } else {
    parts.push(
      `[${inputs.creatorIdx}:v]trim=start=${args.creatorTrimStartS.toFixed(3)}:end=${args.creatorTrimEndS.toFixed(3)},` +
        `setpts=PTS-STARTPTS,scale=-2:${cutoutH},setsar=1,format=yuva420p[crv]`
    );
  }

  // --- Overlay creator over freeze ---
  // Cutout position is the CENTER of the cutout, normalized to the canvas.
  // FFmpeg's overlay x/y is the TOP-LEFT corner. With width 'overlay_w' for the
  // creator stream, the top-left x is `<canvas_w * px> - overlay_w/2`.
  const cx = `(${W}*${cutoutPosX}-overlay_w/2)`;
  const cy = `(${H}*${cutoutPosY}-overlay_h/2)`;
  parts.push(`[freeze][crv]overlay=x=${cx}:y=${cy}:eof_action=endall:shortest=1[revealRaw]`);

  // --- Text overlays per attached clip ---
  // Clip 0 (reference) overlays burn onto [refv].
  let refLabel = 'refv';
  const refOverlays = (manifest.textOverlays || []).filter((t) => t.attachedToClipIndex === 0);
  refOverlays.forEach((ov, i) => {
    const next = `refv${i + 1}`;
    parts.push(`[${refLabel}]${buildDrawtextArgs(ov, canvas)}[${next}]`);
    refLabel = next;
  });

  // Clip 1 (creator/reveal) overlays burn onto [revealRaw].
  let revealLabel = 'revealRaw';
  const revealOverlays = (manifest.textOverlays || []).filter((t) => t.attachedToClipIndex === 1);
  revealOverlays.forEach((ov, i) => {
    const next = `reveal${i + 1}`;
    parts.push(`[${revealLabel}]${buildDrawtextArgs(ov, canvas)}[${next}]`);
    revealLabel = next;
  });

  // --- Concat refSegment then revealSegment ---
  parts.push(`[${refLabel}][${revealLabel}]concat=n=2:v=1:a=0[vout]`);

  return parts.join(';');
}

export interface FreezeRevealAudioFilterArgs {
  refTrimStartS: number;
  refTrimEndS: number;
  creatorTrimStartS: number;
  creatorTrimEndS: number;
  refDurationS: number;
  creatorDurationS: number;
  inputs: FreezeRevealInputs;
}

/**
 * Audio: trim each clip to its slot, then concat. Mirrors the video timeline so
 * the final mp4 has uninterrupted audio across the freeze cut.
 * Output label is `[aout]`.
 *
 * Audio is pulled from inputs `refIdx` (0) and `creatorIdx` (1). When those
 * inputs are prebaked .mov intermediates, the prebake pass stream-copies the
 * source clip's audio into the .mov (see `buildPrebakeArgv`), so the audio
 * is still addressable at the same input slot.
 */
export function buildFreezeRevealAudioFilter(args: FreezeRevealAudioFilterArgs): string {
  const parts: string[] = [];

  parts.push(
    `[${args.inputs.refIdx}:a]atrim=start=${args.refTrimStartS.toFixed(3)}:end=${args.refTrimEndS.toFixed(3)},` +
      `asetpts=PTS-STARTPTS[refa]`
  );
  parts.push(
    `[${args.inputs.creatorIdx}:a]atrim=start=${args.creatorTrimStartS.toFixed(3)}:end=${args.creatorTrimEndS.toFixed(3)},` +
      `asetpts=PTS-STARTPTS[cra]`
  );
  parts.push(`[refa][cra]concat=n=2:v=0:a=1[aout]`);

  return parts.join(';');
}

// ============================================================================
// freeform — concatenate clips with overlays
// ============================================================================

async function renderFreeform(
  opts: StitchComposeOptions,
  canvas: { width: number; height: number }
): Promise<StitchComposeResult> {
  const { manifest } = opts;
  if (manifest.clips.length === 0) {
    throw new Error('freeform requires at least one clip');
  }
  // For now the iOS app's freeform flow renders on-device. The server-side
  // freeform path uses a simple two-input concat so the worker exists and the
  // contract is in place; richer freeform will land alongside the iOS hook-up.
  if (manifest.clips.length > 2) {
    throw new Error(
      'freeform with >2 clips is not yet supported server-side; iOS still owns this case'
    );
  }
  const ref = manifest.clips[0];
  const refDur = Math.max(0.05, ref.trimEndS - ref.trimStartS);

  if (manifest.clips.length === 1) {
    // Single clip: just trim + scale + overlays.
    const argv: string[] = ['-i', opts.refClipLocalPath];
    const W = canvas.width;
    const H = canvas.height;
    const videoBase =
      `[0:v]trim=start=${ref.trimStartS.toFixed(3)}:end=${ref.trimEndS.toFixed(3)},` +
      `setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[base0]`;

    let label = 'base0';
    const overlays = (manifest.textOverlays || []).filter((t) => t.attachedToClipIndex === 0);
    const drawFilters: string[] = [];
    overlays.forEach((ov, i) => {
      const next = `base0_t${i + 1}`;
      drawFilters.push(`[${label}]${buildDrawtextArgs(ov, canvas)}[${next}]`);
      label = next;
    });

    const audio =
      `[0:a]atrim=start=${ref.trimStartS.toFixed(3)}:end=${ref.trimEndS.toFixed(3)},` +
      `asetpts=PTS-STARTPTS[aout]`;

    const filterParts: string[] = [videoBase, ...drawFilters, audio];
    const finalVideoLabel = label;
    const filterComplex = filterParts.join(';') + `;[${finalVideoLabel}]null[vout]`;

    await runFFmpeg({
      inputs: {
        argv,
        refIdx: 0,
        creatorIdx: 0,
        freezeIdx: 0,
      } as FreezeRevealInputs,
      videoFilter: filterComplex,
      audioFilter: '', // already merged inline above
      outputPath: opts.outputPath,
      durationS: refDur,
    });
    return { outputPath: opts.outputPath, durationS: refDur };
  }

  // 2-clip freeform: concat with same layout as freezeReveal minus the freeze
  // frame. Reuse the freezeReveal builders with a synthetic "freeze" that just
  // re-plays the creator clip — it's simpler to fall back to two trimmed scale
  // + concat. Done as a small inline graph here:
  const creator = manifest.clips[1];
  const creatorDur = Math.max(0.05, creator.trimEndS - creator.trimStartS);

  const argv: string[] = ['-i', opts.refClipLocalPath, '-i', opts.creatorClipLocalPath];
  const W = canvas.width;
  const H = canvas.height;
  const filterComplex = [
    `[0:v]trim=start=${ref.trimStartS.toFixed(3)}:end=${ref.trimEndS.toFixed(3)},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[v0]`,
    `[1:v]trim=start=${creator.trimStartS.toFixed(3)}:end=${creator.trimEndS.toFixed(3)},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[v1]`,
    `[0:a]atrim=start=${ref.trimStartS.toFixed(3)}:end=${ref.trimEndS.toFixed(3)},asetpts=PTS-STARTPTS[a0]`,
    `[1:a]atrim=start=${creator.trimStartS.toFixed(3)}:end=${creator.trimEndS.toFixed(3)},asetpts=PTS-STARTPTS[a1]`,
    `[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]`,
  ].join(';');

  await runFFmpeg({
    inputs: {
      argv,
      refIdx: 0,
      creatorIdx: 1,
      freezeIdx: -1,
    } as FreezeRevealInputs,
    videoFilter: filterComplex,
    audioFilter: '',
    outputPath: opts.outputPath,
    durationS: refDur + creatorDur,
  });
  return { outputPath: opts.outputPath, durationS: refDur + creatorDur };
}

// ============================================================================
// drawtext — pure, testable
// ============================================================================

/**
 * Builds a single FFmpeg `drawtext=...` filter chain for a text overlay.
 * Pure function: takes overlay + canvas, returns the string. Caller is
 * responsible for wiring it between filter-graph labels.
 *
 * The canvas size is needed because `position` is normalized (0..1) but
 * drawtext expects pixel offsets. Position is the CENTER of the text.
 */
export function buildDrawtextArgs(
  overlay: StitchTextOverlayManifest,
  canvas: { width: number; height: number }
): string {
  const text = escapeDrawtext(overlay.text);
  const fontSize = Math.max(8, Math.round(overlay.fontSize));
  const xCenter = Math.round(canvas.width * overlay.position.x);
  const yCenter = Math.round(canvas.height * overlay.position.y);
  // drawtext's x/y is the top-left of the text bbox. text_w/text_h are
  // measured at render time.
  const xExpr = `${xCenter}-text_w/2`;
  const yExpr = `${yCenter}-text_h/2`;

  const parts: string[] = [
    `drawtext=text='${text}'`,
    `fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf`,
    `fontsize=${fontSize}`,
    `fontcolor=${ffColor(overlay.textColor)}`,
    `x=${xExpr}`,
    `y=${yExpr}`,
  ];
  if (overlay.backgroundColor) {
    parts.push(`box=1`);
    parts.push(`boxcolor=${ffColor(overlay.backgroundColor)}`);
    parts.push(`boxborderw=10`);
  }
  return parts.join(':');
}

/**
 * `drawtext` requires escaping single quotes, colons, percent and backslash.
 * See https://ffmpeg.org/ffmpeg-utils.html#Quoting-and-escaping.
 */
export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, '’') // curly apostrophe — drawtext + single quote is famously hostile
    .replace(/%/g, '\\%');
}

/** Convert a 0..1 sRGB color to the `0xRRGGBB@alpha` form FFmpeg expects. */
export function ffColor(c: ManifestColor): string {
  const r = clamp255(c.r);
  const g = clamp255(c.g);
  const b = clamp255(c.b);
  const a = Math.max(0, Math.min(1, c.a));
  const hex = ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  return `0x${hex}@${a.toFixed(2)}`;
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

// ============================================================================
// FFmpeg invocation
// ============================================================================

interface RunFFmpegArgs {
  inputs: FreezeRevealInputs;
  /** Filter graph that ends in `[vout]` (and `[aout]` for audio if non-empty). */
  videoFilter: string;
  audioFilter: string;
  outputPath: string;
  durationS: number;
}

async function runFFmpeg(args: RunFFmpegArgs): Promise<void> {
  const filterComplex = args.audioFilter
    ? `${args.videoFilter};${args.audioFilter}`
    : args.videoFilter;

  const argv: string[] = [
    ...args.inputs.argv,
    '-filter_complex',
    filterComplex,
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-t',
    args.durationS.toFixed(3),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    '-y',
    args.outputPath,
  ];

  await spawnFfmpegPromise(argv);
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
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`));
      }
    });
  });
}

async function extractFrame(videoPath: string, atS: number, outPath: string): Promise<void> {
  const argv = [
    '-y',
    '-ss',
    atS.toFixed(3),
    '-i',
    videoPath,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    outPath,
  ];
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', argv, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (c) => (stderr += c.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg freeze-frame exit ${code}: ${stderr.slice(-1000)}`));
    });
  });
}

/**
 * Reconstructs the FFmpeg argv for a manifest WITHOUT actually invoking ffmpeg.
 * Used by tests to snapshot the command. Pure: no spawn, no fs.
 *
 * With the two-pass refactor, this can produce EITHER:
 *   - `mode: 'composite'` (default): the Pass 2 argv, assuming any BG-removed
 *     clips have already been prebaked. The `refClipLocalPath` /
 *     `creatorClipLocalPath` are taken as-is; in production these point at
 *     the prebaked `.mov` when `removeBackground` is true.
 *   - `mode: 'prebake'`: the Pass 1 argv for ONE clip's prebake. Caller picks
 *     which clip with `prebakeFor: 'ref' | 'creator'`. Returns the argv for
 *     that single ffmpeg invocation.
 */
export function debugBuildFfmpegArgv(
  opts: StitchComposeOptions,
  freezePath = '/tmp/freeze.png',
  mode: { kind: 'composite' } | { kind: 'prebake'; clip: 'ref' | 'creator' } = { kind: 'composite' }
): { argv: string[]; videoFilter: string; audioFilter: string; totalDurationS: number } {
  const canvas = layoutCanvasSize(opts.outputLayout);
  if (opts.manifest.style !== 'freezeReveal') {
    throw new Error('debugBuildFfmpegArgv only supports freezeReveal at the moment');
  }
  const ref = opts.manifest.clips[0];
  const creator = opts.manifest.clips[1];
  const refDur = Math.max(0.05, ref.trimEndS - ref.trimStartS);
  const creatorDur = Math.max(0.05, creator.trimEndS - creator.trimStartS);

  if (mode.kind === 'prebake') {
    const clipPath = mode.clip === 'ref' ? opts.refClipLocalPath : opts.creatorClipLocalPath;
    const maskPath = mode.clip === 'ref' ? opts.refMaskLocalPath : opts.creatorMaskLocalPath;
    if (!maskPath) {
      throw new Error(`debugBuildFfmpegArgv prebake mode requires a mask for ${mode.clip}`);
    }
    const outputPath = `/tmp/prebaked-${mode.clip}.mov`;
    const argv = buildPrebakeArgv({ clipPath, maskPath, outputPath });
    return {
      argv,
      videoFilter: buildPrebakeFilter(),
      audioFilter: '',
      totalDurationS: mode.clip === 'ref' ? refDur : creatorDur,
    };
  }

  // Composite (default): assume any BG-removed clips have been prebaked and
  // the caller's `refClipLocalPath` / `creatorClipLocalPath` now point at the
  // prebaked .mov. The composite filter doesn't need the mask inputs.
  const inputs = buildFreezeRevealInputs({
    refPath: opts.refClipLocalPath,
    creatorPath: opts.creatorClipLocalPath,
    freezePath,
    creatorDurationS: creatorDur,
  });

  const videoFilter = buildFreezeRevealVideoFilter({
    manifest: opts.manifest,
    canvas,
    refTrimStartS: ref.trimStartS,
    refTrimEndS: ref.trimEndS,
    creatorTrimStartS: creator.trimStartS,
    creatorTrimEndS: creator.trimEndS,
    refHasAlpha: ref.removeBackground && !!opts.refMaskLocalPath,
    creatorHasAlpha: creator.removeBackground && !!opts.creatorMaskLocalPath,
    inputs,
  });

  const audioFilter = buildFreezeRevealAudioFilter({
    refTrimStartS: ref.trimStartS,
    refTrimEndS: ref.trimEndS,
    creatorTrimStartS: creator.trimStartS,
    creatorTrimEndS: creator.trimEndS,
    refDurationS: refDur,
    creatorDurationS: creatorDur,
    inputs,
  });

  const totalDurationS = refDur + creatorDur;
  const filterComplex = `${videoFilter};${audioFilter}`;
  const argv = [
    ...inputs.argv,
    '-filter_complex',
    filterComplex,
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-t',
    totalDurationS.toFixed(3),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    '-y',
    opts.outputPath,
  ];

  return { argv, videoFilter, audioFilter, totalDurationS };
}
