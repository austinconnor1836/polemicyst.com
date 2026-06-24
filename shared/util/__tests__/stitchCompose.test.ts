import { describe, expect, it } from 'vitest';
import {
  buildDrawtextArgs,
  buildFreezeRevealAudioFilter,
  buildFreezeRevealInputs,
  buildFreezeRevealVideoFilter,
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
  it('indexes ref, creator, freeze, then masks in order', () => {
    const inputs = buildFreezeRevealInputs({
      refPath: '/r.mp4',
      creatorPath: '/c.mp4',
      freezePath: '/f.png',
      refMaskPath: '/rm.mp4',
      creatorMaskPath: '/cm.mp4',
      creatorDurationS: 3.5,
    });
    expect(inputs.refIdx).toBe(0);
    expect(inputs.creatorIdx).toBe(1);
    expect(inputs.freezeIdx).toBe(2);
    expect(inputs.refMaskIdx).toBe(3);
    expect(inputs.creatorMaskIdx).toBe(4);
    // freezeIdx is a -loop image with explicit -t duration.
    expect(inputs.argv).toContain('-loop');
    expect(inputs.argv).toContain('3.500');
  });

  it('omits mask inputs when paths are absent', () => {
    const inputs = buildFreezeRevealInputs({
      refPath: '/r.mp4',
      creatorPath: '/c.mp4',
      freezePath: '/f.png',
      creatorDurationS: 1,
    });
    expect(inputs.refMaskIdx).toBeUndefined();
    expect(inputs.creatorMaskIdx).toBeUndefined();
    // 3 inputs × 2 args each + 2 -loop/-t pairs = 6 + 2 = 8
    expect(inputs.argv.filter((a) => a === '-i').length).toBe(3);
  });
});

describe('buildFreezeRevealVideoFilter', () => {
  const canvas = layoutCanvasSize('mobile');

  it('uses alphamerge when creatorRemoveBg is true', () => {
    const inputs = buildFreezeRevealInputs({
      refPath: '/r.mp4',
      creatorPath: '/c.mp4',
      freezePath: '/f.png',
      creatorMaskPath: '/cm.mp4',
      creatorDurationS: 3.5,
    });
    const f = buildFreezeRevealVideoFilter({
      manifest: baseManifest,
      canvas,
      refTrimStartS: baseManifest.clips[0].trimStartS,
      refTrimEndS: baseManifest.clips[0].trimEndS,
      creatorTrimStartS: baseManifest.clips[1].trimStartS,
      creatorTrimEndS: baseManifest.clips[1].trimEndS,
      refRemoveBg: false,
      creatorRemoveBg: true,
      inputs,
    });
    expect(f).toContain('alphamerge');
    expect(f).toContain('overlay=x=(720*0.5-overlay_w/2)');
  });

  it('skips alphamerge when removeBackground is false on both', () => {
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
      refRemoveBg: false,
      creatorRemoveBg: false,
      inputs,
    });
    expect(f).not.toContain('alphamerge');
  });

  it('concats the reference and reveal segments', () => {
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
      refRemoveBg: false,
      creatorRemoveBg: true,
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
      refRemoveBg: false,
      creatorRemoveBg: false,
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
  it('produces a stable argv shape for a known manifest', () => {
    const out = debugBuildFfmpegArgv(
      {
        manifest: baseManifest,
        refClipLocalPath: '/tmp/ref.mp4',
        creatorClipLocalPath: '/tmp/creator.mp4',
        creatorMaskLocalPath: '/tmp/creator-mask.mp4',
        outputLayout: 'mobile',
        outputPath: '/tmp/out.mp4',
      },
      '/tmp/freeze.png'
    );
    expect(out.totalDurationS).toBeCloseTo(7.5, 3);
    // Encoder flags must include HEVC + faststart per spec.
    expect(out.argv).toContain('libx265');
    expect(out.argv).toContain('+faststart');
    expect(out.argv).toContain('[vout]');
    expect(out.argv).toContain('[aout]');
    // Filter graph must end with a concat into [vout] and an [aout] tail.
    expect(out.videoFilter).toMatch(/\[vout\]$/);
    expect(out.audioFilter).toMatch(/\[aout\]$/);
  });
});
