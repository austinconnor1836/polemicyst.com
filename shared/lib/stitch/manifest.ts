/**
 * Stitch render manifest.
 *
 * This is the canonical payload the iOS client sends to the server when it
 * wants the server-side renderer to produce a stitch output. The shape is a
 * mechanical mirror of `ios/Sources/ClipfireiOS/Features/Stitch/StitchModels.swift`
 * so the iOS encoder can map 1:1.
 *
 * The manifest is persisted onto `Composition.renderConfig` (JSONB) and the
 * worker reads it back to decide what to download, segment, and composite.
 */

export type StitchStyle = 'freeform' | 'freezeReveal';
export type StitchLayout = 'mobile' | 'landscape';

/** Reference to a CompositionTrack that has already been uploaded server-side. */
export interface StitchClipRef {
  /** `CompositionTrack.id` — the canonical server-side handle for the clip. */
  trackId: string;
  trimStartS: number;
  trimEndS: number;
  removeBackground: boolean;
}

/** Normalized 0..1 sRGB color (matches iOS `CodableColor`). */
export interface ManifestColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface StitchTextOverlayManifest {
  text: string;
  /**
   * Which clip in `clips` the overlay is attached to. For freezeReveal:
   *   0 = reference clip
   *   1 = creator clip (rendered over the freeze frame)
   */
  attachedToClipIndex: number;
  /** Normalized 0..1 position, SwiftUI convention (y=0 top, y=1 bottom). */
  position: { x: number; y: number };
  /** In iOS render-canvas pixels (matches `StitchLayout.renderSize`). */
  fontSize: number;
  textColor: ManifestColor;
  backgroundColor?: ManifestColor;
}

export interface StitchCutoutManifest {
  /** Normalized 0..1 position (center). */
  position: { x: number; y: number };
  /** Fraction of render height (0..1). */
  scale: number;
}

export interface StitchManifest {
  style: StitchStyle;
  layout: StitchLayout;
  /**
   * For freezeReveal: index 0 = reference, index 1 = creator.
   * For freeform: arbitrary order; concatenated in array order.
   */
  clips: StitchClipRef[];
  textOverlays: StitchTextOverlayManifest[];
  /** Present iff style === 'freezeReveal' (position + scale of segmented creator). */
  cutout?: StitchCutoutManifest;
  title?: string;
}

/** Output of `validateStitchManifest`. Errors are accumulated, not throw-on-first. */
export interface ManifestValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Pure validator — hand-rolled (zod isn't a dependency in this repo).
 * Returns ok=false with a populated `errors` list rather than throwing,
 * so the API route can include the list in the 400 response.
 */
export function validateStitchManifest(raw: unknown): ManifestValidationResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['manifest must be an object'] };
  }
  const m = raw as Record<string, any>;

  if (m.style !== 'freeform' && m.style !== 'freezeReveal') {
    errors.push(`style must be 'freeform' or 'freezeReveal' (got ${JSON.stringify(m.style)})`);
  }
  if (m.layout !== 'mobile' && m.layout !== 'landscape') {
    errors.push(`layout must be 'mobile' or 'landscape' (got ${JSON.stringify(m.layout)})`);
  }

  if (!Array.isArray(m.clips) || m.clips.length === 0) {
    errors.push('clips must be a non-empty array');
  } else {
    if (m.style === 'freezeReveal' && m.clips.length !== 2) {
      errors.push('freezeReveal requires exactly 2 clips (reference, creator)');
    }
    m.clips.forEach((c: any, i: number) => {
      if (!c || typeof c !== 'object') {
        errors.push(`clips[${i}] must be an object`);
        return;
      }
      if (typeof c.trackId !== 'string' || c.trackId.length === 0) {
        errors.push(`clips[${i}].trackId must be a non-empty string`);
      }
      if (typeof c.trimStartS !== 'number' || c.trimStartS < 0) {
        errors.push(`clips[${i}].trimStartS must be a non-negative number`);
      }
      if (typeof c.trimEndS !== 'number' || c.trimEndS <= 0) {
        errors.push(`clips[${i}].trimEndS must be a positive number`);
      }
      if (
        typeof c.trimEndS === 'number' &&
        typeof c.trimStartS === 'number' &&
        c.trimEndS <= c.trimStartS
      ) {
        errors.push(`clips[${i}].trimEndS must be greater than trimStartS`);
      }
      if (typeof c.removeBackground !== 'boolean') {
        errors.push(`clips[${i}].removeBackground must be a boolean`);
      }
    });
  }

  if (m.textOverlays !== undefined && !Array.isArray(m.textOverlays)) {
    errors.push('textOverlays must be an array if present');
  } else if (Array.isArray(m.textOverlays)) {
    m.textOverlays.forEach((t: any, i: number) => {
      if (typeof t?.text !== 'string') {
        errors.push(`textOverlays[${i}].text must be a string`);
      }
      if (typeof t?.attachedToClipIndex !== 'number') {
        errors.push(`textOverlays[${i}].attachedToClipIndex must be a number`);
      } else if (
        Array.isArray(m.clips) &&
        (t.attachedToClipIndex < 0 || t.attachedToClipIndex >= m.clips.length)
      ) {
        errors.push(
          `textOverlays[${i}].attachedToClipIndex (${t.attachedToClipIndex}) out of range`
        );
      }
      if (!t?.position || typeof t.position.x !== 'number' || typeof t.position.y !== 'number') {
        errors.push(`textOverlays[${i}].position must be { x: number, y: number }`);
      }
      if (typeof t?.fontSize !== 'number' || t.fontSize <= 0) {
        errors.push(`textOverlays[${i}].fontSize must be a positive number`);
      }
      if (!isManifestColor(t?.textColor)) {
        errors.push(`textOverlays[${i}].textColor must be a ManifestColor`);
      }
      if (t?.backgroundColor !== undefined && !isManifestColor(t.backgroundColor)) {
        errors.push(`textOverlays[${i}].backgroundColor must be a ManifestColor if present`);
      }
    });
  }

  if (m.style === 'freezeReveal') {
    if (!m.cutout || typeof m.cutout !== 'object') {
      errors.push('freezeReveal requires a cutout object');
    } else {
      const c = m.cutout;
      if (!c.position || typeof c.position.x !== 'number' || typeof c.position.y !== 'number') {
        errors.push('cutout.position must be { x: number, y: number }');
      }
      if (typeof c.scale !== 'number' || c.scale <= 0 || c.scale > 2) {
        errors.push('cutout.scale must be a positive number in (0, 2]');
      }
    }
  }

  if (m.title !== undefined && typeof m.title !== 'string') {
    errors.push('title must be a string if present');
  }

  return { ok: errors.length === 0, errors };
}

function isManifestColor(v: any): v is ManifestColor {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof v.r === 'number' &&
    typeof v.g === 'number' &&
    typeof v.b === 'number' &&
    typeof v.a === 'number'
  );
}

/** Render-canvas pixel size for a layout — matches iOS `StitchLayout.renderSize`. */
export function layoutCanvasSize(layout: StitchLayout): { width: number; height: number } {
  return layout === 'mobile' ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
}
