import { describe, it, expect } from 'vitest';
import {
  validateSplitFrameManifest,
  parseSplitFrameManifest,
  SPLIT_FRAME_OUTPUT_HEIGHT,
  SPLIT_FRAME_OUTPUT_WIDTH,
  type SplitFrameManifest,
} from '@shared/lib/split-frame/manifest';
import {
  buildSplitFrameFilterComplex,
  buildSplitFrameFfmpegArgv,
  splitFrameCanvas,
  escapeDrawtext,
} from '@shared/util/splitFrameCompose';

// A canonical happy-path manifest — used across the compositor tests.
const baseManifest: SplitFrameManifest = {
  version: 1,
  videoUrl: 'https://s3.example/video.mp4',
  imageUrl: 'https://s3.example/image.jpg',
  outputWidth: SPLIT_FRAME_OUTPUT_WIDTH,
  outputHeight: SPLIT_FRAME_OUTPUT_HEIGHT,
};

describe('validateSplitFrameManifest', () => {
  it('accepts a well-formed manifest', () => {
    const result = validateSplitFrameManifest(baseManifest);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a wrong version', () => {
    const result = validateSplitFrameManifest({ ...baseManifest, version: 2 as any });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('version'))).toBe(true);
  });

  it('rejects missing videoUrl', () => {
    const result = validateSplitFrameManifest({ ...baseManifest, videoUrl: '' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('videoUrl'))).toBe(true);
  });

  it('rejects missing imageUrl', () => {
    const result = validateSplitFrameManifest({ ...baseManifest, imageUrl: '' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('imageUrl'))).toBe(true);
  });

  it('rejects the wrong output dimensions', () => {
    const result = validateSplitFrameManifest({
      ...baseManifest,
      outputWidth: 1080 as any,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('outputWidth'))).toBe(true);
  });

  it('accepts an optional caption', () => {
    const result = validateSplitFrameManifest({ ...baseManifest, caption: 'Hello' });
    expect(result.ok).toBe(true);
  });

  it('rejects a non-string caption', () => {
    const result = validateSplitFrameManifest({ ...baseManifest, caption: 42 as any });
    expect(result.ok).toBe(false);
  });

  it('parseSplitFrameManifest throws on invalid input', () => {
    expect(() => parseSplitFrameManifest({ ...baseManifest, videoUrl: '' })).toThrow();
  });
});

describe('splitFrameCanvas', () => {
  it('splits the canvas into equal halves', () => {
    const c = splitFrameCanvas(baseManifest);
    expect(c.width).toBe(720);
    expect(c.height).toBe(1280);
    expect(c.halfHeight).toBe(640);
  });
});

describe('buildSplitFrameFilterComplex', () => {
  it('produces a graph with vstack of the two halves', () => {
    const graph = buildSplitFrameFilterComplex(baseManifest);
    // Both halves feed into a vstack — the canonical split-frame move.
    expect(graph).toContain('[top][bot]vstack=inputs=2[stackedRaw]');
    // Top uses input 0 (the video) with a fit + pad chain.
    expect(graph).toContain('[0:v]');
    expect(graph).toContain('force_original_aspect_ratio=decrease');
    // Bottom uses input 1 (the image).
    expect(graph).toContain('[1:v]');
    // Without a caption, the final step is a null pass-through.
    expect(graph).toContain('[stackedRaw]null[vout]');
  });

  it('adds a drawtext filter when caption is present', () => {
    const graph = buildSplitFrameFilterComplex({
      ...baseManifest,
      caption: 'Hello world',
    });
    expect(graph).toContain('drawtext=');
    expect(graph).toContain("text='Hello world'");
    // The pass-through null shouldn't be present when drawtext is doing the
    // final wiring.
    expect(graph).not.toContain('[stackedRaw]null[vout]');
  });

  it('escapes drawtext-hostile characters', () => {
    // Curly-apostrophe replacement is the important one — libavfilter's
    // drawtext parser blows up on a bare `'` inside a `text='...'` argument.
    expect(escapeDrawtext("it's fine")).toBe('it’s fine');
    expect(escapeDrawtext('50%')).toBe('50\\%');
    expect(escapeDrawtext('a:b')).toBe('a\\:b');
    expect(escapeDrawtext('back\\slash')).toBe('back\\\\slash');
  });
});

describe('buildSplitFrameFfmpegArgv', () => {
  const opts = {
    manifest: baseManifest,
    inputs: {
      videoLocalPath: '/tmp/video.mp4',
      imageLocalPath: '/tmp/image.jpg',
    },
    outputPath: '/tmp/output.mp4',
  };

  it('wires the video first and the looped image second', () => {
    const argv = buildSplitFrameFfmpegArgv(opts);
    // First `-i` should be the video.
    const firstDashI = argv.indexOf('-i');
    expect(argv[firstDashI + 1]).toBe('/tmp/video.mp4');
    // The image input is preceded by `-loop 1 -framerate 30` so a still becomes
    // a CFR 30 fps video stream — matches stitchCompose's freeze-frame trick.
    const loopIdx = argv.indexOf('-loop');
    expect(loopIdx).toBeGreaterThan(firstDashI);
    expect(argv[loopIdx + 1]).toBe('1');
    const framerateIdx = argv.indexOf('-framerate');
    expect(argv[framerateIdx + 1]).toBe('30');
  });

  it('maps [vout] and optional audio, and cuts at the shortest input', () => {
    const argv = buildSplitFrameFfmpegArgv(opts);
    // `-map [vout]` present exactly once.
    const mapIdx = argv.indexOf('-map');
    expect(argv[mapIdx + 1]).toBe('[vout]');
    // Optional audio map (`0:a?`) — some source videos have no audio.
    expect(argv).toContain('0:a?');
    // The whole point of the loop-and-shortest trick — trims the composed
    // output to the video's actual duration.
    expect(argv).toContain('-shortest');
  });

  it('encodes with libx264 CRF 20 at CFR 30 fps', () => {
    const argv = buildSplitFrameFfmpegArgv(opts);
    expect(argv).toContain('libx264');
    // CRF 20 chosen for split-frame (vs 23 for stitch) because the still-image
    // bottom half rewards a slightly higher-quality encode without blowing up
    // file size — it's low motion, so the extra bits are cheap.
    const crfIdx = argv.indexOf('-crf');
    expect(argv[crfIdx + 1]).toBe('20');
    const rIdx = argv.indexOf('-r');
    expect(argv[rIdx + 1]).toBe('30');
    expect(argv).toContain('cfr');
  });
});
