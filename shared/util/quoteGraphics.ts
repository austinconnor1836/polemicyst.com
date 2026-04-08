/**
 * Generate styled quote overlay images for video compositions.
 *
 * Produces PNG images from HTML templates using Puppeteer. These images are
 * overlaid onto the video during FFmpeg rendering (server) or drawn onto
 * the canvas (client).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { DetectedQuote } from '../lib/quote-detection';

export type QuoteGraphicStyle =
  | 'pull-quote'
  | 'lower-third'
  | 'highlight-card'
  | 'side-panel'
  | 'typewriter';

export interface QuoteOverlay {
  quote: DetectedQuote;
  style: QuoteGraphicStyle;
  /** Path to the generated PNG file (temp) */
  imagePath: string;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
}

export interface GenerateQuoteGraphicOptions {
  quote: DetectedQuote;
  style: QuoteGraphicStyle;
  /** Video canvas width (e.g. 720 for mobile, 1280 for landscape) */
  canvasWidth: number;
  /** Video canvas height (e.g. 1280 for mobile, 720 for landscape) */
  canvasHeight: number;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPullQuoteHtml(
  quote: DetectedQuote,
  width: number,
  height: number
): string {
  const attribution = quote.attribution
    ? `<div class="attribution">— ${escapeHtml(quote.attribution)}</div>`
    : '';

  return `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${width}px;
    height: ${height}px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    font-family: 'Georgia', 'Times New Roman', serif;
  }
  .card {
    background: rgba(0, 0, 0, 0.82);
    border-radius: 16px;
    padding: 32px 40px;
    max-width: ${Math.round(width * 0.88)}px;
    border-left: 5px solid #e2b714;
    position: relative;
  }
  .quote-mark {
    font-size: 64px;
    color: #e2b714;
    line-height: 0.6;
    margin-bottom: 12px;
    font-family: Georgia, serif;
  }
  .text {
    color: #ffffff;
    font-size: ${Math.max(18, Math.min(28, Math.round(width / 30)))}px;
    line-height: 1.5;
    font-style: italic;
    margin-bottom: 16px;
    word-wrap: break-word;
  }
  .attribution {
    color: #e2b714;
    font-size: ${Math.max(14, Math.min(20, Math.round(width / 42)))}px;
    font-style: normal;
    font-weight: 600;
    text-align: right;
  }
</style></head><body>
<div class="card">
  <div class="quote-mark">\u201C</div>
  <div class="text">${escapeHtml(quote.text)}</div>
  ${attribution}
</div>
</body></html>`;
}

function buildLowerThirdHtml(
  quote: DetectedQuote,
  width: number,
  height: number
): string {
  const attribution = quote.attribution
    ? `<div class="source">${escapeHtml(quote.attribution)}</div>`
    : '';

  return `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${width}px;
    height: ${height}px;
    display: flex;
    align-items: flex-end;
    background: transparent;
    font-family: -apple-system, 'Segoe UI', sans-serif;
  }
  .bar {
    width: 100%;
    background: linear-gradient(to top, rgba(0,0,0,0.90), rgba(0,0,0,0.70));
    padding: 20px 28px;
  }
  .text {
    color: #ffffff;
    font-size: ${Math.max(16, Math.min(24, Math.round(width / 36)))}px;
    line-height: 1.45;
    font-style: italic;
    margin-bottom: 8px;
    word-wrap: break-word;
  }
  .source {
    color: #9ca3af;
    font-size: ${Math.max(12, Math.min(16, Math.round(width / 52)))}px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
</style></head><body>
<div class="bar">
  <div class="text">\u201C${escapeHtml(quote.text)}\u201D</div>
  ${attribution}
</div>
</body></html>`;
}

function buildHighlightCardHtml(
  quote: DetectedQuote,
  width: number,
  height: number
): string {
  const attribution = quote.attribution
    ? `<div class="attribution">${escapeHtml(quote.attribution)}</div>`
    : '';

  return `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${width}px;
    height: ${height}px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    font-family: -apple-system, 'Segoe UI', sans-serif;
  }
  .card {
    background: rgba(15, 15, 20, 0.88);
    border: 2px solid rgba(226, 183, 20, 0.6);
    border-radius: 20px;
    padding: 28px 36px;
    max-width: ${Math.round(width * 0.85)}px;
    backdrop-filter: blur(8px);
  }
  .label {
    color: #e2b714;
    font-size: ${Math.max(10, Math.min(14, Math.round(width / 60)))}px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin-bottom: 14px;
  }
  .text {
    color: #ffffff;
    font-size: ${Math.max(17, Math.min(26, Math.round(width / 32)))}px;
    line-height: 1.5;
    margin-bottom: 14px;
    word-wrap: break-word;
  }
  .attribution {
    color: #9ca3af;
    font-size: ${Math.max(12, Math.min(18, Math.round(width / 48)))}px;
    font-weight: 500;
  }
</style></head><body>
<div class="card">
  <div class="label">\u{1F4D6} EXCERPT</div>
  <div class="text">\u201C${escapeHtml(quote.text)}\u201D</div>
  ${attribution}
</div>
</body></html>`;
}

function buildSidePanelHtml(
  quote: DetectedQuote,
  width: number,
  height: number
): string {
  const panelWidth = Math.round(width * 0.42);
  const attribution = quote.attribution
    ? `<div class="attribution">— ${escapeHtml(quote.attribution)}</div>`
    : '';

  return `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${width}px;
    height: ${height}px;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    background: transparent;
    font-family: Georgia, 'Times New Roman', serif;
  }
  .panel {
    width: ${panelWidth}px;
    height: 100%;
    background: rgba(0, 0, 0, 0.85);
    border-right: 4px solid #e2b714;
    padding: 32px 24px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .quote-mark {
    font-size: 48px;
    color: #e2b714;
    line-height: 0.6;
    margin-bottom: 16px;
  }
  .text {
    color: #ffffff;
    font-size: ${Math.max(14, Math.min(22, Math.round(panelWidth / 20)))}px;
    line-height: 1.5;
    font-style: italic;
    margin-bottom: 16px;
    word-wrap: break-word;
  }
  .attribution {
    color: #e2b714;
    font-size: ${Math.max(11, Math.min(16, Math.round(panelWidth / 28)))}px;
    font-style: normal;
    font-weight: 600;
  }
</style></head><body>
<div class="panel">
  <div class="quote-mark">\u201C</div>
  <div class="text">${escapeHtml(quote.text)}</div>
  ${attribution}
</div>
</body></html>`;
}

/**
 * Build HTML for a quote graphic based on the selected style.
 */
function buildQuoteHtml(
  quote: DetectedQuote,
  style: QuoteGraphicStyle,
  canvasWidth: number,
  canvasHeight: number
): string {
  switch (style) {
    case 'lower-third':
      return buildLowerThirdHtml(quote, canvasWidth, canvasHeight);
    case 'highlight-card':
      return buildHighlightCardHtml(quote, canvasWidth, canvasHeight);
    case 'side-panel':
      return buildSidePanelHtml(quote, canvasWidth, canvasHeight);
    case 'pull-quote':
    default:
      return buildPullQuoteHtml(quote, canvasWidth, canvasHeight);
  }
}

/**
 * Generate a PNG image for a single quote overlay using Puppeteer.
 */
export async function generateQuoteGraphic(
  opts: GenerateQuoteGraphicOptions
): Promise<QuoteOverlay> {
  const { rasterizeGraphic } = await import('../lib/publishing/rasterize');

  const html = buildQuoteHtml(
    opts.quote,
    opts.style,
    opts.canvasWidth,
    opts.canvasHeight
  );

  const pngBuffer = await rasterizeGraphic(html, {
    width: opts.canvasWidth,
    height: opts.canvasHeight,
  });

  const imagePath = path.join(
    os.tmpdir(),
    `quote-overlay-${Date.now()}-${Math.random().toString(36).slice(2)}.png`
  );
  fs.writeFileSync(imagePath, pngBuffer);

  return {
    quote: opts.quote,
    style: opts.style,
    imagePath,
    width: opts.canvasWidth,
    height: opts.canvasHeight,
  };
}

/**
 * Generate PNG overlays for all detected quotes.
 */
export async function generateAllQuoteGraphics(
  quotes: DetectedQuote[],
  style: QuoteGraphicStyle,
  canvasWidth: number,
  canvasHeight: number
): Promise<QuoteOverlay[]> {
  const overlays: QuoteOverlay[] = [];

  for (const quote of quotes) {
    try {
      const overlay = await generateQuoteGraphic({
        quote,
        style,
        canvasWidth,
        canvasHeight,
      });
      overlays.push(overlay);
    } catch (err) {
      console.warn(
        `[quoteGraphics] Failed to generate graphic for quote at ${quote.startS}s:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return overlays;
}

/**
 * Clean up temp PNG files created by generateQuoteGraphic.
 */
export function cleanupQuoteGraphics(overlays: QuoteOverlay[]): void {
  for (const overlay of overlays) {
    try {
      if (fs.existsSync(overlay.imagePath)) {
        fs.unlinkSync(overlay.imagePath);
      }
    } catch {}
  }
}

/**
 * Available quote graphic style options with labels.
 */
export const QUOTE_GRAPHIC_STYLES: { value: QuoteGraphicStyle; label: string; description: string }[] = [
  { value: 'pull-quote', label: 'Pull Quote', description: 'Large quotation marks with centered text' },
  { value: 'lower-third', label: 'Lower Third', description: 'Text bar across the bottom of the frame' },
  { value: 'highlight-card', label: 'Highlight Card', description: 'Rounded card with accent border' },
  { value: 'side-panel', label: 'Side Panel', description: 'Quote text in a styled panel on one side' },
  { value: 'typewriter', label: 'Typewriter', description: 'Text appears word-by-word (client-side only)' },
];
