/**
 * Polemicyst Graphic renderer — 100% PROGRAMMATIC (no AI / no LLM).
 *
 * Typesets a plain block of pasted text into the fixed Polemicyst brand card
 * (cream 1080×1350, Spectral serif, hairline-ruled body frame, `@polemicyst`
 * footer) and rasterizes it to one or more PNG buffers via Puppeteer.
 *
 * There is deliberately NO "structuring" or "generation" step. The template is
 * fixed. The only "smart" part is pure geometry: measuring rendered paragraph
 * heights in the headless browser and packing them across 1080×1350 carousel
 * pages so nothing clips. Everything below the `renderPolemicystGraphic`
 * orchestrator is a pure function and unit-tested without a browser.
 *
 * Rendering path mirrors `shared/lib/publishing/rasterize.ts` /
 * `shared/util/quoteGraphics.ts`: `puppeteer-core`, system Chromium via
 * `PUPPETEER_EXECUTABLE_PATH`, `document.fonts.ready`, element screenshot.
 */

import puppeteerCore from 'puppeteer-core';

// ---------------------------------------------------------------------------
// Canonical template constants (verbatim from the brand card)
// ---------------------------------------------------------------------------

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
/** Padding on all four sides of the card (`padding:150px 150px`). */
export const CARD_PADDING = 150;
/** `.frame { padding:56px 0 }` vertical padding, one side. */
export const FRAME_VERTICAL_PADDING = 56;
/** `.frame` has a 1px top border and 1px bottom border. */
export const FRAME_BORDER = 1;
/** Total vertical chrome the frame adds around its paragraphs. */
export const FRAME_CHROME = FRAME_VERTICAL_PADDING * 2 + FRAME_BORDER * 2; // 114
/** `.frame { gap:34px }` between paragraphs. */
export const PARAGRAPH_GAP = 34;
/** Frame content width = card width minus horizontal padding (no frame x-pad). */
export const FRAME_CONTENT_WIDTH = CARD_WIDTH - CARD_PADDING * 2; // 780

/** Comfortable, readable starting font-size — we do NOT shrink below this
 *  just to fit long text on one card; instead we paginate into a carousel. */
export const COMFORTABLE_FONT_SIZE = 44;
/** Hard cap so a very short post doesn't balloon absurdly. */
export const MAX_FONT_SIZE = 52;
/** Sensible floor for the uniform-shrink fallback. */
export const MIN_FONT_SIZE = 22;
/** Step the font-size down by this many px per shrink iteration. */
export const FONT_STEP = 2;
export const LINE_HEIGHT = 1.4;
/** Only apply a uniform shrink once the carousel would exceed this page cap. */
export const MAX_PAGES = 10;
/** Supersample for crisp output (matches the proven render.js invocation). */
export const DEVICE_SCALE_FACTOR = 2;

export const POLEMICYST_HANDLE = '@polemicyst';

// ---------------------------------------------------------------------------
// Pure text → blocks parsing
// ---------------------------------------------------------------------------

export type Block = { type: 'paragraph'; text: string } | { type: 'break' };

/** A line consisting only of `---` or `===` (3+) forces a page break. */
const EXPLICIT_BREAK_RE = /^\s*(-{3,}|={3,})\s*$/;

/**
 * Parse the user's pasted text into an ordered stream of paragraph + explicit
 * page-break blocks.
 *
 * - Paragraphs are separated by blank lines (`\n\n+`).
 * - Single newlines inside a paragraph collapse to spaces.
 * - A line containing only `---` (or `===`) is an EXPLICIT page break — it
 *   partitions the carousel even mid-text, honoring the brand's hand-authored
 *   multi-panel layouts.
 *
 * Empty paragraphs are dropped. Break blocks are preserved in order.
 */
export function parseInput(raw: string): Block[] {
  const normalized = (raw ?? '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');

  const blocks: Block[] = [];
  let current: string[] = [];

  const flushParagraph = () => {
    if (current.length === 0) return;
    const text = current.join(' ').replace(/\s+/g, ' ').trim();
    if (text.length > 0) blocks.push({ type: 'paragraph', text });
    current = [];
  };

  for (const line of lines) {
    if (EXPLICIT_BREAK_RE.test(line)) {
      flushParagraph();
      blocks.push({ type: 'break' });
      continue;
    }
    if (line.trim().length === 0) {
      flushParagraph();
      continue;
    }
    current.push(line.trim());
  }
  flushParagraph();

  return blocks;
}

// ---------------------------------------------------------------------------
// Pure HTML escaping + sentence splitting
// ---------------------------------------------------------------------------

/** Escape HTML-unsafe characters. Correctness over typography. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Split a paragraph at sentence boundaries (`. `, `! `, `? `) keeping the
 * terminal punctuation with its sentence. Used only as the fallback when a
 * single paragraph is too tall to fit on one page.
 */
export function splitIntoSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+(?:[.!?]+(?:["'”’)\]]+)?|$)/g);
  if (!matches) return [text];
  const sentences = matches.map((s) => s.trim()).filter((s) => s.length > 0);
  return sentences.length > 0 ? sentences : [text];
}

// ---------------------------------------------------------------------------
// Pure pagination
// ---------------------------------------------------------------------------

/** Measures the rendered height (px) a paragraph string occupies in the frame. */
export type ParagraphMeasurer = (text: string) => number;

export interface PaginateOptions {
  /** Vertical space available for paragraphs + gaps on a single page (px). */
  availableHeight: number;
  /** Gap between paragraphs (px). */
  gap: number;
}

/**
 * Pack parsed blocks into carousel pages, greedily filling each page until the
 * next paragraph would overflow, honoring explicit `break` blocks, and
 * splitting an over-tall single paragraph at sentence boundaries.
 *
 * Pure: the `measure` callback supplies heights, so this runs in tests without
 * a browser. Returns an array of pages; each page is an array of the paragraph
 * strings that belong on it (sentence fragments that stay together are already
 * re-joined into a single string).
 */
export function paginate(
  blocks: Block[],
  measure: ParagraphMeasurer,
  opts: PaginateOptions
): string[][] {
  const { availableHeight, gap } = opts;
  const pages: string[][] = [];
  let page: string[] = [];
  let pageHeight = 0;

  const flush = () => {
    if (page.length > 0) {
      pages.push(page);
      page = [];
      pageHeight = 0;
    }
  };

  /** Place one whole-paragraph unit, flushing / splitting as needed. */
  const placeParagraph = (text: string) => {
    const height = measure(text);

    // If it doesn't fit on the current (non-empty) page, start a new page.
    if (page.length > 0 && pageHeight + gap + height > availableHeight) {
      flush();
    }

    // Fresh page and STILL too tall → split at sentence boundaries.
    if (page.length === 0 && height > availableHeight) {
      const sentences = splitIntoSentences(text);
      if (sentences.length > 1) {
        let chunk: string[] = [];
        let chunkHeight = 0;
        for (const sentence of sentences) {
          const sh = measure(sentence);
          if (chunk.length > 0 && chunkHeight + sh > availableHeight) {
            // Emit the filled chunk as its own full page.
            pages.push([chunk.join(' ')]);
            chunk = [sentence];
            chunkHeight = sh;
          } else {
            chunk.push(sentence);
            chunkHeight += sh;
          }
        }
        // Keep the trailing chunk on the current page so following paragraphs
        // can still join it (with a gap).
        if (chunk.length > 0) {
          page.push(chunk.join(' '));
          pageHeight = chunkHeight;
        }
        return;
      }
      // Un-splittable single sentence taller than a page: place it alone and
      // accept the (rare) overflow — the uniform-shrink loop will have already
      // tried to make it fit.
      pages.push([text]);
      return;
    }

    const gapAdd = page.length > 0 ? gap : 0;
    page.push(text);
    pageHeight += gapAdd + height;
  };

  for (const block of blocks) {
    if (block.type === 'break') {
      flush();
      continue;
    }
    placeParagraph(block.text);
  }
  flush();

  return pages;
}

// ---------------------------------------------------------------------------
// Pure font-size selection (uniform-shrink loop)
// ---------------------------------------------------------------------------

export interface FontSizeSelectOptions {
  startFontSize?: number;
  minFontSize?: number;
  fontStep?: number;
  maxPages?: number;
  gap?: number;
}

/** Frame layout (available height + paragraph measurer) at a given font-size. */
export interface FontLayout {
  availableHeight: number;
  measure: ParagraphMeasurer;
}

/**
 * The stop condition for the uniform-shrink loop: stop once the carousel fits
 * within the page cap, OR we've hit the font-size floor. Shared by the pure
 * `selectFontSizeAndPaginate` and the browser-backed orchestrator so the
 * decision can't drift between them.
 */
export function shouldStopShrinking(
  pageCount: number,
  fontSize: number,
  opts: { maxPages: number; minFontSize: number }
): boolean {
  return pageCount <= opts.maxPages || fontSize <= opts.minFontSize;
}

/**
 * Pick the largest font-size (starting comfortable) whose carousel stays within
 * the page cap, stepping DOWN only when the page count would exceed it. Pure:
 * `layoutFor` supplies the available height + measurer for each candidate
 * font-size, so this is unit-tested without a browser.
 */
export function selectFontSizeAndPaginate(
  blocks: Block[],
  layoutFor: (fontSize: number) => FontLayout,
  opts: FontSizeSelectOptions = {}
): { fontSize: number; pages: string[][] } {
  const startFontSize = opts.startFontSize ?? COMFORTABLE_FONT_SIZE;
  const minFontSize = opts.minFontSize ?? MIN_FONT_SIZE;
  const fontStep = opts.fontStep ?? FONT_STEP;
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const gap = opts.gap ?? PARAGRAPH_GAP;

  let fontSize = startFontSize;
  let pages: string[][] = [];
  for (;;) {
    const { availableHeight, measure } = layoutFor(fontSize);
    pages = paginate(blocks, measure, { availableHeight, gap });
    if (shouldStopShrinking(pages.length, fontSize, { maxPages, minFontSize })) break;
    fontSize -= fontStep;
  }
  return { fontSize, pages };
}

// ---------------------------------------------------------------------------
// Pure HTML builders (single source of truth for the template CSS)
// ---------------------------------------------------------------------------

/**
 * The canonical brand-card CSS, verbatim, with the paragraph font-size and
 * line-height injected. Single source of truth — both the measurement pass and
 * the final page render use this so measured heights match rendered heights.
 */
export function cardCss(fontSize: number): string {
  return `@import url('https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,400;0,500;0,600;0,800;1,400;1,600&family=Roboto+Condensed:wght@400;700&display=swap');
* { margin:0; padding:0; box-sizing:border-box; }
.card {
  width:${CARD_WIDTH}px; height:${CARD_HEIGHT}px;
  background:#f5f2e9;
  position:relative;
  padding:${CARD_PADDING}px ${CARD_PADDING}px;
  display:flex; flex-direction:column;
  font-family:'Spectral', serif;
  color:#161512;
  overflow:hidden;
}
.card::before{
  content:""; position:absolute; inset:0;
  background:repeating-linear-gradient(0deg, rgba(0,0,0,0.015) 0 1px, transparent 1px 3px);
  pointer-events:none;
}
.body{ flex:1; display:flex; flex-direction:column; justify-content:center; }

.frame{
  border-top:1px solid #c9c0ad;
  border-bottom:1px solid #c9c0ad;
  padding:${FRAME_VERTICAL_PADDING}px 0;
  display:flex; flex-direction:column; gap:${PARAGRAPH_GAP}px;
}
.frame p{
  font-size:${fontSize}px; line-height:${LINE_HEIGHT}; font-weight:500;
}

.footer{
  border-top:3px double #161512;
  padding-top:20px;
  display:flex; align-items:center; justify-content:space-between;
  font-family:'Roboto Condensed', sans-serif;
}
.handle{ font-weight:700; font-size:22px; letter-spacing:1px; }
.pageIndicator{ font-weight:700; font-size:18px; letter-spacing:1px; color:#8a2b1e; }`;
}

export interface BuildPageHtmlOptions {
  /** Paragraphs to typeset on this page (raw, un-escaped user text). */
  paragraphs: string[];
  /** 0-based index of this page. */
  pageIndex: number;
  /** Total number of pages in the carousel. */
  pageCount: number;
  fontSize: number;
  /** Show the "i / N" page indicator (only meaningful when pageCount > 1). */
  showPageIndicator: boolean;
}

/**
 * Build the full HTML document for one carousel page. Pure + deterministic:
 * escapes each paragraph, injects them as `<p>` slots inside the `.frame`, and
 * appends the page indicator in the footer when the carousel has >1 page and
 * indicators are enabled.
 */
export function buildPageHtml(opts: BuildPageHtmlOptions): string {
  const { paragraphs, pageIndex, pageCount, fontSize, showPageIndicator } = opts;
  const paras = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n      ');

  const indicator =
    showPageIndicator && pageCount > 1
      ? `<div class="pageIndicator">${pageIndex + 1} / ${pageCount}</div>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
${cardCss(fontSize)}
</style>
</head>
<body>
<div class="card">
  <div class="body">
    <div class="frame">
      ${paras}
    </div>
  </div>
  <div class="footer">
    <div class="handle">${POLEMICYST_HANDLE}</div>
    ${indicator}
  </div>
</div>
</body>
</html>`;
}

/**
 * Build a measurement document that lists every unit (each paragraph AND each
 * of its sentence fragments) as a `<p data-k="...">` so the browser can report
 * each unit's rendered height in one pass. The footer is included so its real
 * height feeds the available-space computation.
 */
export function buildMeasurementHtml(
  units: { key: string; text: string }[],
  fontSize: number
): string {
  const items = units.map((u) => `<p data-k="${u.key}">${escapeHtml(u.text)}</p>`).join('\n      ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
${cardCss(fontSize)}
</style>
</head>
<body>
<div class="card">
  <div class="body">
    <div class="frame" id="measure-frame">
      ${items}
    </div>
  </div>
  <div class="footer">
    <div class="handle">${POLEMICYST_HANDLE}</div>
    <div class="pageIndicator">0 / 0</div>
  </div>
</div>
</body>
</html>`;
}

/**
 * Compute the vertical space available for paragraphs + gaps on one page,
 * given the measured footer height.
 */
export function computeAvailableHeight(footerHeight: number): number {
  return CARD_HEIGHT - CARD_PADDING * 2 - footerHeight - FRAME_CHROME;
}

/**
 * Build the full list of measurement units for a set of blocks: every
 * paragraph, plus every sentence fragment of every paragraph (so the pagination
 * fallback has exact standalone heights available).
 */
export function buildMeasurementUnits(blocks: Block[]): { key: string; text: string }[] {
  const units: { key: string; text: string }[] = [];
  const seen = new Set<string>();
  const push = (text: string) => {
    if (seen.has(text)) return;
    seen.add(text);
    units.push({ key: String(units.length), text });
  };
  for (const block of blocks) {
    if (block.type !== 'paragraph') continue;
    push(block.text);
    const sentences = splitIntoSentences(block.text);
    if (sentences.length > 1) sentences.forEach(push);
  }
  return units;
}

// ---------------------------------------------------------------------------
// Impure Puppeteer orchestrator
// ---------------------------------------------------------------------------

export interface RenderPolemicystGraphicOptions {
  text: string;
  /** Show the "i / N" footer indicator on multi-page output. Default true. */
  showPageIndicator?: boolean;
}

function getChromiumPath(): string | undefined {
  return process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
}

/**
 * Render the pasted text into 1..N branded 1080×1350 PNG carousel pages.
 *
 * Returns one PNG buffer per page. A short post yields a single page; a long
 * post yields an Instagram carousel. Throws if the text has no paragraphs.
 */
export async function renderPolemicystGraphic(
  opts: RenderPolemicystGraphicOptions
): Promise<Buffer[]> {
  const showPageIndicator = opts.showPageIndicator ?? true;

  const blocks = parseInput(opts.text);
  const hasContent = blocks.some((b) => b.type === 'paragraph');
  if (!hasContent) {
    throw new Error('No text to render');
  }

  const launchOptions: Record<string, unknown> = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };
  const executablePath = getChromiumPath();
  if (executablePath) launchOptions.executablePath = executablePath;

  const browser = await puppeteerCore.launch(
    launchOptions as Parameters<typeof puppeteerCore.launch>[0]
  );

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
    });

    const units = buildMeasurementUnits(blocks);

    // Uniform-shrink loop: start comfortable, only step the font-size DOWN if
    // the carousel would exceed MAX_PAGES pages. Pure `paginate` decides the
    // page layout from measured heights.
    let fontSize = COMFORTABLE_FONT_SIZE;
    let pages: string[][] = [];

    for (;;) {
      const measurements = await measureAtFontSize(page, units, fontSize);
      const available = computeAvailableHeight(measurements.footerHeight);
      const heightByText = measurements.heightByText;
      const measure: ParagraphMeasurer = (text) => heightByText.get(text) ?? 0;

      pages = paginate(blocks, measure, { availableHeight: available, gap: PARAGRAPH_GAP });

      if (
        shouldStopShrinking(pages.length, fontSize, {
          maxPages: MAX_PAGES,
          minFontSize: MIN_FONT_SIZE,
        })
      )
        break;
      fontSize -= FONT_STEP;
    }

    const buffers: Buffer[] = [];
    for (let i = 0; i < pages.length; i++) {
      const html = buildPageHtml({
        paragraphs: pages[i],
        pageIndex: i,
        pageCount: pages.length,
        fontSize,
        showPageIndicator,
      });
      // `domcontentloaded` + an explicit `document.fonts.ready` wait is both
      // faster and more robust than `networkidle0`: it settles precisely when
      // the Google-Fonts webfonts have applied, instead of hanging on a
      // keepalive socket that never reaches network-idle.
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await page.evaluate(() => document.fonts?.ready);
      const card = await page.$('.card');
      if (!card) throw new Error('Rendered card element not found');
      const shot = await card.screenshot({ type: 'png' });
      buffers.push(Buffer.from(shot));
    }

    return buffers;
  } finally {
    await browser.close();
  }
}

/**
 * Load the measurement document at a given font-size and read back the footer
 * height + each unit's rendered height (keyed by its text).
 */
async function measureAtFontSize(
  page: import('puppeteer-core').Page,
  units: { key: string; text: string }[],
  fontSize: number
): Promise<{ footerHeight: number; heightByText: Map<string, number> }> {
  const html = buildMeasurementHtml(units, fontSize);
  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await page.evaluate(() => document.fonts?.ready);

  const result = await page.evaluate(() => {
    const footer = document.querySelector('.footer') as HTMLElement | null;
    const footerHeight = footer ? footer.getBoundingClientRect().height : 0;
    const heights: Record<string, number> = {};
    document.querySelectorAll<HTMLElement>('.frame p[data-k]').forEach((el) => {
      const k = el.getAttribute('data-k');
      if (k != null) heights[k] = el.getBoundingClientRect().height;
    });
    return { footerHeight, heights };
  });

  const heightByText = new Map<string, number>();
  for (const u of units) {
    const h = result.heights[u.key];
    if (typeof h === 'number') heightByText.set(u.text, h);
  }

  return { footerHeight: result.footerHeight, heightByText };
}
