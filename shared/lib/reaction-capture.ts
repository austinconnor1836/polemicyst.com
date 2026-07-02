/**
 * Shared types + validators for the reaction capture splitter.
 *
 * A "capture" is one long screen recording with a fixed on-screen layout: the creator
 * feed lives in one rectangle, the reference feed in another. The splitter crops each
 * feed out and fans the recording into one composition per reaction. These helpers are
 * used by the capture-template and reaction-session API routes to validate untrusted
 * request bodies (zod isn't a dependency in this repo — hand-rolled, same as the stitch
 * manifest validator).
 */

/** Pixel crop rectangle. Matches `CropRect` in `shared/util/cropDetect.ts`. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ReferenceOrientation = 'portrait' | 'landscape';

export interface BoundaryWindow {
  startS: number;
  endS: number;
  overLimit?: boolean;
}

/** Validate + normalize a crop rect. Returns null if the shape is invalid. */
export function parseRect(v: unknown): Rect | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const { x, y, w, h } = r;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof w !== 'number' ||
    typeof h !== 'number' ||
    ![x, y, w, h].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    w <= 0 ||
    h <= 0
  ) {
    return null;
  }
  return { x, y, w, h };
}

export function parseOrientation(v: unknown): ReferenceOrientation {
  return v === 'landscape' ? 'landscape' : 'portrait';
}

/**
 * Validate a boundary list: each window needs finite `startS < endS >= 0`. Windows are
 * sorted by start. Returns null if any entry is malformed or the list is empty.
 */
export function parseBoundaries(v: unknown): BoundaryWindow[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: BoundaryWindow[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') return null;
    const b = raw as Record<string, unknown>;
    const startS = b.startS;
    const endS = b.endS;
    if (
      typeof startS !== 'number' ||
      typeof endS !== 'number' ||
      !Number.isFinite(startS) ||
      !Number.isFinite(endS) ||
      startS < 0 ||
      endS <= startS
    ) {
      return null;
    }
    out.push({ startS, endS, overLimit: b.overLimit === true });
  }
  return out.sort((a, b) => a.startS - b.startS);
}
