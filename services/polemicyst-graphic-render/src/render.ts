/**
 * Browserless render backend: Satori (element tree -> SVG) + @resvg/resvg-js
 * (SVG -> PNG). Swaps ONLY the measure + render backend of the monolith's
 * Chromium renderer; the parse / paginate / pack logic in `pagination.ts` is
 * reused verbatim.
 *
 * Pagination measurement without a DOM: each candidate paragraph is laid out at
 * the frame content width via a WIDTH-ONLY (auto-height) Satori pass, and the
 * resulting SVG's height attribute is the paragraph's rendered height — the
 * direct analogue of `getBoundingClientRect().height` in the browser version.
 */

import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

import {
  parseInput,
  buildMeasurementUnits,
  computeAvailableHeight,
  paginate,
  shouldStopShrinking,
  type Block,
  type ParagraphMeasurer,
  COMFORTABLE_FONT_SIZE,
  MIN_FONT_SIZE,
  FONT_STEP,
  MAX_PAGES,
  PARAGRAPH_GAP,
  FRAME_CONTENT_WIDTH,
  CARD_WIDTH,
  CARD_HEIGHT,
  DEVICE_SCALE_FACTOR,
} from './pagination';
import { card, measureParagraph, measureFooter } from './template';
import { loadFonts, type SatoriFont } from './fonts';

const HEIGHT_RE = /<svg[^>]*\bheight="([\d.]+)"/;

/** Auto-height Satori pass: returns the rendered height (px) of `node` at `width`. */
async function measureHeight(node: unknown, width: number, fonts: SatoriFont[]): Promise<number> {
  // Width-only options -> Satori sizes height to content.
  const svg = await satori(node as never, { width, fonts: fonts as never });
  const m = svg.match(HEIGHT_RE);
  return m ? Math.ceil(parseFloat(m[1]!)) : 0;
}

export interface RenderOptions {
  text: string;
  /** Show the "i / N" footer indicator on multi-page output. Default true. */
  showPageIndicator?: boolean;
}

export interface RenderResult {
  /** One PNG buffer per carousel page (1080x1350 * DEVICE_SCALE_FACTOR). */
  buffers: Buffer[];
  pageCount: number;
  fontSize: number;
}

/**
 * Render pasted text into 1..N branded PNG carousel pages via Satori + resvg.
 * Throws if the text has no paragraphs.
 */
export async function renderPolemicystGraphic(opts: RenderOptions): Promise<RenderResult> {
  const showPageIndicator = opts.showPageIndicator ?? true;
  const fonts = loadFonts();

  const blocks = parseInput(opts.text);
  const hasContent = blocks.some((b) => b.type === 'paragraph');
  if (!hasContent) throw new Error('No text to render');

  // Footer height is independent of the body font-size -> measure once.
  const footerHeight = await measureHeight(measureFooter(), FRAME_CONTENT_WIDTH, fonts);
  const availableHeight = computeAvailableHeight(footerHeight);

  const units = buildMeasurementUnits(blocks);

  // Uniform-shrink loop (mirrors the Chromium orchestrator): start comfortable,
  // step the font-size DOWN only if the carousel would exceed MAX_PAGES.
  let fontSize = COMFORTABLE_FONT_SIZE;
  let pages: string[][] = [];

  for (;;) {
    // Pre-measure every unit at this font-size so `paginate`'s measurer is sync.
    const heightByText = new Map<string, number>();
    for (const u of units) {
      const h = await measureHeight(measureParagraph(u.text, fontSize), FRAME_CONTENT_WIDTH, fonts);
      heightByText.set(u.text, h);
    }
    const measure: ParagraphMeasurer = (text) => heightByText.get(text) ?? 0;

    pages = paginate(blocks, measure, { availableHeight, gap: PARAGRAPH_GAP });

    if (
      shouldStopShrinking(pages.length, fontSize, {
        maxPages: MAX_PAGES,
        minFontSize: MIN_FONT_SIZE,
      })
    ) {
      break;
    }
    fontSize -= FONT_STEP;
  }

  const buffers: Buffer[] = [];
  for (let i = 0; i < pages.length; i++) {
    const buf = await renderPageToPng({
      paragraphs: pages[i]!,
      fontSize,
      pageIndex: i,
      pageCount: pages.length,
      showPageIndicator,
      fonts,
    });
    buffers.push(buf);
  }

  return { buffers, pageCount: pages.length, fontSize };
}

interface RenderPageOptions {
  paragraphs: string[];
  fontSize: number;
  pageIndex: number;
  pageCount: number;
  showPageIndicator: boolean;
  fonts: SatoriFont[];
}

/** Render one card page: Satori -> SVG, then resvg -> PNG at DEVICE_SCALE_FACTOR. */
async function renderPageToPng(opts: RenderPageOptions): Promise<Buffer> {
  const { paragraphs, fontSize, pageIndex, pageCount, showPageIndicator, fonts } = opts;

  const svg = await satori(
    card({ paragraphs, fontSize, pageIndex, pageCount, showPageIndicator }) as never,
    { width: CARD_WIDTH, height: CARD_HEIGHT, fonts: fonts as never }
  );

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: CARD_WIDTH * DEVICE_SCALE_FACTOR },
    background: '#f5f2e9',
  });
  const png = resvg.render().asPng();
  return Buffer.from(png);
}

export { parseInput, type Block };
