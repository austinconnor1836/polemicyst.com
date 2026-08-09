/**
 * Load the EMBEDDED font buffers for Satori. No runtime network fetch — the
 * TTFs are versioned assets under `assets/fonts/`. This is the intended
 * best-practice for browserless render: fonts ship with the service.
 *
 * Spectral (serif body) weights 400/500/600/800 + italic 400/600, and
 * Roboto Condensed (footer handle + page indicator) weights 400/700.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export type SatoriFontStyle = 'normal' | 'italic';

export interface SatoriFont {
  name: string;
  data: Buffer;
  weight: 400 | 500 | 600 | 700 | 800;
  style: SatoriFontStyle;
}

/**
 * Resolve the embedded font directory. Locally (tsx) the module sits at
 * `src/fonts.ts`, so `../assets/fonts` is correct. On a bundled serverless
 * target (Vercel @vercel/node esbuild) the emitted file lives elsewhere, but
 * the TTFs are shipped at the project root via `includeFiles`, so
 * `process.cwd()/assets/fonts` resolves them. Probe both and use the first
 * that exists — a missing font dir means blank/failed renders.
 */
function resolveFontDir(): string {
  const candidates: string[] = [];
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(here, '..', 'assets', 'fonts'));
    candidates.push(join(here, 'assets', 'fonts'));
  } catch {
    // import.meta.url unavailable in some bundlers — fall through to cwd.
  }
  candidates.push(join(process.cwd(), 'assets', 'fonts'));
  for (const dir of candidates) {
    if (existsSync(join(dir, 'Spectral-Regular.ttf'))) return dir;
  }
  // Last resort: the original relative guess (will throw a clear ENOENT).
  return candidates[0] ?? join(process.cwd(), 'assets', 'fonts');
}

const FONT_DIR = resolveFontDir();

function load(file: string): Buffer {
  return readFileSync(join(FONT_DIR, file));
}

let cached: SatoriFont[] | null = null;

/**
 * Return every font Satori needs, loaded once and cached for the process
 * lifetime. Satori resolves the closest match by (name, weight, style).
 */
export function loadFonts(): SatoriFont[] {
  if (cached) return cached;
  cached = [
    { name: 'Spectral', data: load('Spectral-Regular.ttf'), weight: 400, style: 'normal' },
    { name: 'Spectral', data: load('Spectral-Medium.ttf'), weight: 500, style: 'normal' },
    { name: 'Spectral', data: load('Spectral-SemiBold.ttf'), weight: 600, style: 'normal' },
    { name: 'Spectral', data: load('Spectral-ExtraBold.ttf'), weight: 800, style: 'normal' },
    { name: 'Spectral', data: load('Spectral-Italic.ttf'), weight: 400, style: 'italic' },
    { name: 'Spectral', data: load('Spectral-SemiBoldItalic.ttf'), weight: 600, style: 'italic' },
    {
      name: 'Roboto Condensed',
      data: load('RobotoCondensed-Regular.ttf'),
      weight: 400,
      style: 'normal',
    },
    {
      name: 'Roboto Condensed',
      data: load('RobotoCondensed-Bold.ttf'),
      weight: 700,
      style: 'normal',
    },
  ];
  return cached;
}
