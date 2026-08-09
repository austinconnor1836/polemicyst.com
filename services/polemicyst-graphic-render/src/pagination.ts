/**
 * Pure text -> layout pipeline for the Polemicyst brand graphic.
 *
 * This is a verbatim port of the PURE parts of the monolith's
 * `shared/util/polemicystGraphic.ts` — `parseInput`, `escapeHtml`,
 * `splitIntoSentences`, `paginate`, `shouldStopShrinking`,
 * `selectFontSizeAndPaginate`, `buildMeasurementUnits`,
 * `computeAvailableHeight`, and the brand constants.
 *
 * NOTHING here touches a browser or Satori. The measurement callback is
 * injected, so the greedy packing / `---` breaks / sentence fallback / MAX_PAGES
 * behaviour is identical to the Chromium version and unit-testable without any
 * renderer. Only the MEASURE + RENDER backend (Satori) lives elsewhere.
 */

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
// Pure text -> blocks parsing
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
 * - A line containing only `---` (or `===`) is an EXPLICIT page break.
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

    // Fresh page and STILL too tall -> split at sentence boundaries.
    if (page.length === 0 && height > availableHeight) {
      const sentences = splitIntoSentences(text);
      if (sentences.length > 1) {
        let chunk: string[] = [];
        let chunkHeight = 0;
        for (const sentence of sentences) {
          const sh = measure(sentence);
          if (chunk.length > 0 && chunkHeight + sh > availableHeight) {
            pages.push([chunk.join(' ')]);
            chunk = [sentence];
            chunkHeight = sh;
          } else {
            chunk.push(sentence);
            chunkHeight += sh;
          }
        }
        if (chunk.length > 0) {
          page.push(chunk.join(' '));
          pageHeight = chunkHeight;
        }
        return;
      }
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
 * within the page cap, OR we've hit the font-size floor.
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
 * the page cap, stepping DOWN only when the page count would exceed it.
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
// Measurement-unit assembly + available-height math
// ---------------------------------------------------------------------------

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
