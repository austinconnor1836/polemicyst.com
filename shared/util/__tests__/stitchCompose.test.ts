import { describe, expect, it } from 'vitest';
import {
  buildDrawtextArgs,
  buildFreezeRevealAudioFilter,
  buildFreezeRevealInputs,
  buildFreezeRevealVideoFilter,
  buildPrebakeArgv,
  buildPrebakeFilter,
  debugBuildFfmpegArgv,
  escapeDrawtext,
  ffColor,
} from '../stitchCompose';
import {
  layoutCanvasSize,
  validateStitchManifest,
  type StitchManifest,
} from '../../lib/stitch/manifest';

const baseManifest: StitchManifest = {
  style: 'freezeReveal',
  layout: 'mobile',
  clips: [
    { trackId: 'ref-track-1', trimStartS: 1.0, trimEndS: 5.0, removeBackground: false },
    { trackId: 'creator-track-1', trimStartS: 0.0, trimEndS: 3.5, removeBackground: true },
  ],
  textOverlays: [
    {
      text: 'Hook line',
      attachedToClipIndex: 0,
      position: { x: 0.5, y: 0.1 },
      fontSize: 48,
      textColor: { r: 1, g: 1, b: 1, a: 1 },
      backgroundColor: { r: 0, g: 0, b: 0, a: 0.5 },
    },
    {
      text: 'My reaction: wow!',
      attachedToClipIndex: 1,
      position: { x: 0.5, y: 0.85 },
      fontSize: 40,
      textColor: { r: 1, g: 0.8, b: 0.2, a: 1 },
    },
  ],
  cutout: { position: { x: 0.5, y: 0.5 }, scale: 0.6 },
  title: 'My stitch',
};

describe('validateStitchManifest', () => {
  it('accepts a well-formed manifest', () => {
    const r = validateStitchManifest(baseManifest);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects null/undefined', () => {
    expect(validateStitchManifest(null).ok).toBe(false);
    expect(validateStitchManifest(undefined).ok).toBe(false);
  });

  it('requires freezeReveal to have exactly 2 clips', () => {
    const m = { ...baseManifest, clips: [baseManifest.clips[0]] };
    const r = validateStitchManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/exactly 2 clips/);
  });

  it('requires freezeReveal to carry a cutout', () => {
    const { cutout, ...rest } = baseManifest;
    const r = validateStitchManifest(rest);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/cutout/);
  });

  it('rejects out-of-range attachedToClipIndex', () => {
    const m: StitchManifest = {
      ...baseManifest,
      textOverlays: [
        {
          ...baseManifest.textOverlays[0],
          attachedToClipIndex: 5,
        },
      ],
    };
    const r = validateStitchManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/out of range/);
  });

  it('rejects malformed color', () => {
    const m: StitchManifest = {
      ...baseManifest,
      textOverlays: [
        {
          ...baseManifest.textOverlays[0],
          // @ts-expect-error intentionally wrong
          textColor: { r: 1, g: 1, b: 1 },
        },
      ],
    };
    const r = validateStitchManifest(m);
    expect(r.ok).toBe(false);
  });

  it('rejects trimEndS <= trimStartS', () => {
    const m: StitchManifest = {
      ...baseManifest,
      clips: [{ ...baseManifest.clips[0], trimStartS: 5, trimEndS: 5 }, baseManifest.clips[1]],
    };
    const r = validateStitchManifest(m);
    expect(r.ok).toBe(false);
  });
});

describe('layoutCanvasSize', () => {
  it('mobile is 720x1280', () => {
    expect(layoutCanvasSize('mobile')).toEqual({ width: 720, height: 1280 });
  });
  it('landscape is 1280x720', () => {
    expect(layoutCanvasSize('landscape')).toEqual({ width: 1280, height: 720 });
  });
});

describe('escapeDrawtext', () => {
  it('escapes colons and backslashes', () => {
    expect(escapeDrawtext('a:b')).toBe('a\\:b');
    expect(escapeDrawtext('a\\b')).toBe('a\\\\b');
  });
  it('replaces single quotes with curly apostrophe', () => {
    // Single straight quote in a drawtext arg is hostile inside `text='...'`,
    // so we hard-substitute with a typographic apostrophe.
    expect(escapeDrawtext("it's")).toBe('it’s');
  });
  it('escapes percent', () => {
    expect(escapeDrawtext('50%')).toBe('50\\%');
  });
});

describe('ffColor', () => {
  it('converts white to 0xffffff@1.00', () => {
    expect(ffColor({ r: 1, g: 1, b: 1, a: 1 })).toBe('0xffffff@1.00');
  });
  it('converts opaque black', () => {
    expect(ffColor({ r: 0, g: 0, b: 0, a: 1 })).toBe('0x000000@1.00');
  });
  it('preserves intermediate alpha', () => {
    expect(ffColor({ r: 0, g: 0, b: 0, a: 0.5 })).toBe('0x000000@0.50');
  });
  it('clamps out-of-range to [0,255]', () => {
    expect(ffColor({ r: 2, g: -1, b: 0.5, a: 2 })).toBe('0xff0080@1.00');
  });
});

describe('buildDrawtextArgs', () => {
  const canvas = { width: 720, height: 1280 };

  it('produces a centered text position from normalized coords', () => {
    const out = buildDrawtextArgs(baseManifest.textOverlays[0], canvas);
    // x center = 360, y center = 128 → expressions subtract text_w/2 etc.
    expect(out).toContain('x=360-text_w/2');
    expect(out).toContain('y=128-text_h/2');
    expect(out).toContain('fontsize=48');
    expect(out).toContain('fontcolor=0xffffff@1.00');
  });

  it('emits a box for backgroundColor', () => {
    const out = buildDrawtextArgs(baseManifest.textOverlays[0], canvas);
    expect(out).toContain('box=1');
    expect(out).toContain('boxcolor=0x000000@0.50');
  });

  it('omits box when backgroundColor is absent', () => {
    const out = buildDrawtextArgs(baseManifest.textOverlays[1], canvas);
    expect(out).not.toContain('box=1');
  });

  it('references the bundled DejaVu font', () => {
    const out = buildDrawtextArgs(baseManifest.textOverlays[0], canvas);
    expect(out).toContain('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf');
  });
});

describe('buildFreezeRevealInputs', () => {
  it('indexes ref, creator, freeze with no mask inputs (composite pass only)', () => {
    const inputs = buildFreezeRevealInputs({
      refPath: '/r.mp4',
      creatorPath: '/c.mp4',
      freezePath: '/f.png',
      creatorDurationS: 3.5,
    });
    expect(inputs.refIdx).toBe(0);
    expect(inputs.creatorIdx).toBe(1);
    expect(inputs.freezeIdx).toBe(2);
    // No mask indices exist on the composite pass — Pass 1 already consumed them.
    // freezeIdx is a -loop image with explicit -t duration.
    expect(inputs.argv).toContain('-loop');
    expect(inputs.argv).toContain('3.500');
    expect(inputs.argv.filter((a) => a === '-i').length).toBe(3);
  });

  it('takes prebaked paths transparently — same shape regardless of source', () => {
    // When BG removal was active, refPath / creatorPath point at the .mov
    // prebaked by Pass 1. The builder treats them identically.
    const inputs = buildFreezeRevealInputs({
      refPath: '/tmp/prebaked-ref.mov',
      creatorPath: '/tmp/prebaked-creator.mov',
      freezePath: '/f.png',
      creatorDurationS: 1,
    });
    expect(inputs.argv).toContain('/tmp/prebaked-ref.mov');
    expect(inputs.argv).toContain('/tmp/prebaked-creator.mov');
    expect(inputs.argv.filter((a) => a === '-i').length).toBe(3);
  });
});

describe('buildPrebakeFilter', () => {
  it('alphamerges clip + mask into [v]', () => {
    const f = buildPrebakeFilter();
    expect(f).toContain('[0:v]');
    expect(f).toContain('[1:v]');
    expect(f).toContain('format=gray');
    expect(f).toContain('alphamerge');
    expect(f).toMatch(/alphamerge\[v\]$/);
  });
});

describe('buildPrebakeArgv', () => {
  it('produces a two-input argv encoded with qtrle into a .mov', () => {
    const argv = buildPrebakeArgv({
      clipPath: '/tmp/creator.mp4',
      maskPath: '/tmp/creator-mask.mp4',
      outputPath: '/tmp/prebaked-creator.mov',
    });
    // Two -i inputs (clip, mask).
    expect(argv.filter((a) => a === '-i').length).toBe(2);
    expect(argv).toContain('/tmp/creator.mp4');
    expect(argv).toContain('/tmp/creator-mask.mp4');
    // qtrle codec — chosen for fast lossless alpha encoding in .mov.
    expect(argv).toContain('qtrle');
    expect(argv).toContain('/tmp/prebaked-creator.mov');
    // Filter complex contains alphamerge and maps [v].
    const fcIdx = argv.indexOf('-filter_complex');
    expect(fcIdx).toBeGreaterThanOrEqual(0);
    expect(argv[fcIdx + 1]).toContain('alphamerge');
    expect(argv).toContain('[v]');
  });

  it('stream-copies source audio so the composite pass can still address it', () => {
    const argv = buildPrebakeArgv({
      clipPath: '/tmp/creator.mp4',
      maskPath: '/tmp/creator-mask.mp4',
      outputPath: '/tmp/prebaked-creator.mov',
    });
    // -map 0:a? (optional — clip may not have audio) and -c:a copy.
    expect(argv).toContain('0:a?');
    expect(argv).toContain('copy');
  });

  it('always overwrites the output (-y)', () => {
    const argv = buildPrebakeArgv({
      clipPath: '/a.mp4',
      maskPath: '/b.mp4',
      outputPath: '/o.mov',
    });
    expect(argv).toContain('-y');
  });
});

describe('buildFreezeRevealVideoFilter', () => {
  const canvas = layoutCanvasSize('mobile');

  it('does NOT alphamerge in the composite pass (alpha is pre-baked)', () => {
    const inputs = buildFreezeRevealInputs({
      refPath: '/tmp/prebaked-creator.mov',
      creatorPath: '/tmp/prebaked-creator.mov',
      freezePath: '/f.png',
      creatorDurationS: 3.5,
    });
    const f = buildFreezeRevealVideoFilter({
      manifest: baseManifest,
      canvas,
      refTrimStartS: baseManifest.clips[0].trimStartS,
      refTrimEndS: baseManifest.clips[0].trimEndS,
      creatorTrimStartS: baseManifest.clips[1].trimStartS,
      creatorTrimEndS: baseManifest.clips[1].trimEndS,
      refHasAlpha: false,
      creatorHasAlpha: true,
      inputs,
    });
    expect(f).not.toContain('alphamerge');
    // The cutout overlay positioning is still wired correctly.
    expect(f).toContain('overlay=x=(720*0.5-overlay_w/2)');
  });

  it('skips the over-black composite step when neither clip has alpha', () => {
    const inputs = buildFreezeRevealInputs({
      refPath: '/r.mp4',
      creatorPath: '/c.mp4',
      freezePath: '/f.png',
      creatorDurationS: 3.5,
    });
    const manifestNoBg: StitchManifest = {
      ...baseManifest,
      clips: [
        { ...baseManifest.clips[0], removeBackground: false },
        { ...baseManifest.clips[1], removeBackground: false },
      ],
    };
    const f = buildFreezeRevealVideoFilter({
      manifest: manifestNoBg,
      canvas,
      refTrimStartS: 1,
      refTrimEndS: 5,
      creatorTrimStartS: 0,
      creatorTrimEndS: 3.5,
      refHasAlpha: false,
      creatorHasAlpha: false,
      inputs,
    });
    expect(f).not.toContain('alphamerge');
    // No color=c=black step needed when alpha isn't in play.
    expect(f).not.toContain('color=c=black');
  });

  it('flattens a transparent ref over solid black when refHasAlpha is true', () => {
    const inputs = buildFreezeRevealInputs({
      refPath: '/tmp/prebaked-ref.mov',
      creatorPath: '/c.mp4',
      freezePath: '/f.png',
      creatorDurationS: 3.5,
    });
    const f = buildFreezeRevealVideoFilter({
      manifest: baseManifest,
      canvas,
      refTrimStartS: 1,
      refTrimEndS: 5,
      creatorTrimStartS: 0,
      creatorTrimEndS: 3.5,
      refHasAlpha: true,
      creatorHasAlpha: false,
      inputs,
    });
    // A solid-black background is generated and the transparent ref is overlaid on it.
    expect(f).toContain('color=c=black');
    expect(f).toMatch(/\[refbg\]\[refbase\]overlay/);
  });

  it('concats the reference and reveal segments', () => {
    const inputs = buildFreezeRevealInputs({
      refPath: '/r.mp4',
      creatorPath: '/tmp/prebaked-creator.mov',
      freezePath: '/f.png',
      creatorDurationS: 3.5,
    });
    const f = buildFreezeRevealVideoFilter({
      manifest: baseManifest,
      canvas,
      refTrimStartS: 1,
      refTrimEndS: 5,
      creatorTrimStartS: 0,
      creatorTrimEndS: 3.5,
      refHasAlpha: false,
      creatorHasAlpha: true,
      inputs,
    });
    expect(f).toMatch(/concat=n=2:v=1:a=0\[vout\]/);
  });

  it('chains drawtext overlays for the reference clip', () => {
    const inputs = buildFreezeRevealInputs({
      refPath: '/r.mp4',
      creatorPath: '/c.mp4',
      freezePath: '/f.png',
      creatorDurationS: 3.5,
    });
    const f = buildFreezeRevealVideoFilter({
      manifest: baseManifest,
      canvas,
      refTrimStartS: 1,
      refTrimEndS: 5,
      creatorTrimStartS: 0,
      creatorTrimEndS: 3.5,
      refHasAlpha: false,
      creatorHasAlpha: false,
      inputs,
    });
    expect(f).toContain("text='Hook line'");
    expect(f).toContain("text='My reaction\\: wow!'");
  });
});

describe('buildFreezeRevealAudioFilter', () => {
  it('concatenates the two audio streams', () => {
    const inputs = buildFreezeRevealInputs({
      refPath: '/r.mp4',
      creatorPath: '/c.mp4',
      freezePath: '/f.png',
      creatorDurationS: 3.5,
    });
    const a = buildFreezeRevealAudioFilter({
      refTrimStartS: 1,
      refTrimEndS: 5,
      creatorTrimStartS: 0,
      creatorTrimEndS: 3.5,
      refDurationS: 4,
      creatorDurationS: 3.5,
      inputs,
    });
    expect(a).toContain('atrim=start=1.000:end=5.000');
    expect(a).toContain('atrim=start=0.000:end=3.500');
    expect(a).toContain('concat=n=2:v=0:a=1[aout]');
  });
});

describe('debugBuildFfmpegArgv (snapshot)', () => {
  it('produces a stable composite argv (default mode) for a known manifest', () => {
    const out = debugBuildFfmpegArgv(
      {
        manifest: baseManifest,
        refClipLocalPath: '/tmp/ref.mp4',
        // In production this would be the prebaked .mov; for the snapshot we
        // just confirm the argv shape, not the path semantics.
        creatorClipLocalPath: '/tmp/creator.mp4',
        creatorMaskLocalPath: '/tmp/creator-mask.mp4',
        outputLayout: 'mobile',
        outputPath: '/tmp/out.mp4',
      },
      '/tmp/freeze.png'
    );
    expect(out.totalDurationS).toBeCloseTo(7.5, 3);
    // Encoder flags must include H.264 + faststart. Switched off libx265 because
    // CPU-only HEVC encoding inside the Docker worker is ~20× too slow for a 90s
    // portrait render; libx264 veryfast is still visually solid at crf 23.
    expect(out.argv).toContain('libx264');
    expect(out.argv).toContain('+faststart');
    expect(out.argv).toContain('[vout]');
    expect(out.argv).toContain('[aout]');
    // Filter graph must end with a concat into [vout] and an [aout] tail.
    expect(out.videoFilter).toMatch(/\[vout\]$/);
    expect(out.audioFilter).toMatch(/\[aout\]$/);
    // Composite pass no longer alphamerges — that's Pass 1's job.
    expect(out.videoFilter).not.toContain('alphamerge');
  });

  it('produces a prebake argv when mode is prebake', () => {
    const out = debugBuildFfmpegArgv(
      {
        manifest: baseManifest,
        refClipLocalPath: '/tmp/ref.mp4',
        creatorClipLocalPath: '/tmp/creator.mp4',
        creatorMaskLocalPath: '/tmp/creator-mask.mp4',
        outputLayout: 'mobile',
        outputPath: '/tmp/out.mp4',
      },
      '/tmp/freeze.png',
      { kind: 'prebake', clip: 'creator' }
    );
    expect(out.argv).toContain('qtrle');
    expect(out.argv).toContain('/tmp/creator.mp4');
    expect(out.argv).toContain('/tmp/creator-mask.mp4');
    expect(out.videoFilter).toContain('alphamerge');
    expect(out.audioFilter).toBe('');
  });

  it('throws when prebake mode is requested for a clip without a mask', () => {
    expect(() =>
      debugBuildFfmpegArgv(
        {
          manifest: baseManifest,
          refClipLocalPath: '/tmp/ref.mp4',
          creatorClipLocalPath: '/tmp/creator.mp4',
          // no refMaskLocalPath → ref prebake is invalid
          outputLayout: 'mobile',
          outputPath: '/tmp/out.mp4',
        },
        '/tmp/freeze.png',
        { kind: 'prebake', clip: 'ref' }
      )
    ).toThrow(/mask/);
  });
});
