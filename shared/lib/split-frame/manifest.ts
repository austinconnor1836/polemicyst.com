/**
 * Split-Frame render manifest.
 *
 * A portrait 9:16 composed video where the top half is a video and the bottom
 * half is a static image. The manifest is what iOS POSTs to
 * `/api/split-frame/render`; the server persists it onto
 * `Composition.renderConfig` and the `split-frame-render` worker reads it back.
 *
 * If you add a field, mirror it in
 * `ios/Sources/ClipfireiOS/Features/SplitFrame/SplitFrameModels.swift` in the
 * same commit — the iOS encoder maps 1:1 to these JSON keys.
 */

export const SPLIT_FRAME_OUTPUT_WIDTH = 720;
export const SPLIT_FRAME_OUTPUT_HEIGHT = 1280;

export interface SplitFrameManifest {
  /** Bump when the shape changes so old rows can be identified. */
  version: 1;
  /**
   * S3 URL of the user's video. The worker downloads this directly (no
   * `CompositionTrack` row is required — Split Frame is simpler than Stitch
   * and doesn't need transcripts or reuse across renders).
   */
  videoUrl: string;
  /** S3 URL of the uploaded static image (jpg / png). */
  imageUrl: string;
  outputWidth: typeof SPLIT_FRAME_OUTPUT_WIDTH;
  outputHeight: typeof SPLIT_FRAME_OUTPUT_HEIGHT;
  /** Optional overlay text burned in over the composed frame (bottom third). */
  caption?: string;
}

export interface ManifestValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Hand-rolled validator — zod isn't a dep in this repo, and the stitch
 * pipeline follows the same pattern (see `shared/lib/stitch/manifest.ts`).
 * Errors are accumulated so the API route can return the full list in one 400.
 */
export function validateSplitFrameManifest(raw: unknown): ManifestValidationResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['manifest must be an object'] };
  }
  const m = raw as Record<string, any>;

  if (m.version !== 1) {
    errors.push(`version must be 1 (got ${JSON.stringify(m.version)})`);
  }
  if (typeof m.videoUrl !== 'string' || m.videoUrl.length === 0) {
    errors.push('videoUrl must be a non-empty string');
  }
  if (typeof m.imageUrl !== 'string' || m.imageUrl.length === 0) {
    errors.push('imageUrl must be a non-empty string');
  }
  if (m.outputWidth !== SPLIT_FRAME_OUTPUT_WIDTH) {
    errors.push(
      `outputWidth must be ${SPLIT_FRAME_OUTPUT_WIDTH} (got ${JSON.stringify(m.outputWidth)})`
    );
  }
  if (m.outputHeight !== SPLIT_FRAME_OUTPUT_HEIGHT) {
    errors.push(
      `outputHeight must be ${SPLIT_FRAME_OUTPUT_HEIGHT} (got ${JSON.stringify(m.outputHeight)})`
    );
  }
  if (m.caption !== undefined && typeof m.caption !== 'string') {
    errors.push('caption must be a string if present');
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Cast + validate in one shot. Throws on invalid input — the API route uses
 * `validateSplitFrameManifest` directly so it can include the error list in
 * the 400 body, but tests/workers prefer the throwing shape.
 */
export function parseSplitFrameManifest(raw: unknown): SplitFrameManifest {
  const result = validateSplitFrameManifest(raw);
  if (!result.ok) {
    throw new Error(`Invalid split-frame manifest: ${result.errors.join('; ')}`);
  }
  return raw as SplitFrameManifest;
}
