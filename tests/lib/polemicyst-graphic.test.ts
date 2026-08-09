import { describe, it, expect } from 'vitest';
import {
  parseInput,
  escapeHtml,
  splitIntoSentences,
  paginate,
  buildPageHtml,
  buildMeasurementUnits,
  computeAvailableHeight,
  selectFontSizeAndPaginate,
  shouldStopShrinking,
  type Block,
  type ParagraphMeasurer,
  CARD_HEIGHT,
  CARD_PADDING,
  FRAME_CHROME,
  POLEMICYST_HANDLE,
} from '@shared/util/polemicystGraphic';

// A synthetic measurer: paragraph "height" == its character length. Keeps the
// pagination arithmetic trivial to reason about, no browser needed.
const measureByLength: ParagraphMeasurer = (t) => t.length;

describe('escapeHtml', () => {
  it('escapes the HTML-unsafe characters', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    expect(escapeHtml('a < b > c')).toBe('a &lt; b &gt; c');
    expect(escapeHtml('say "hi"')).toBe('say &quot;hi&quot;');
    expect(escapeHtml("it's fine")).toBe('it&#39;s fine');
  });

  it('leaves ordinary prose untouched', () => {
    expect(escapeHtml('The rule of law matters.')).toBe('The rule of law matters.');
  });
});

describe('parseInput — paragraph splitting on blank lines', () => {
  it('splits on blank lines and collapses single newlines to spaces', () => {
    const blocks = parseInput('Line one\nstill one\n\nParagraph two');
    expect(blocks).toEqual<Block[]>([
      { type: 'paragraph', text: 'Line one still one' },
      { type: 'paragraph', text: 'Paragraph two' },
    ]);
  });

  it('drops empty paragraphs and normalizes CRLF', () => {
    const blocks = parseInput('One\r\n\r\n\r\n\r\nTwo\n\n   \n\nThree');
    expect(blocks).toEqual<Block[]>([
      { type: 'paragraph', text: 'One' },
      { type: 'paragraph', text: 'Two' },
      { type: 'paragraph', text: 'Three' },
    ]);
  });

  it('returns no paragraph blocks for whitespace-only input', () => {
    expect(parseInput('   \n\n  \t ').some((b) => b.type === 'paragraph')).toBe(false);
  });
});

describe('parseInput — explicit page-break markers', () => {
  it('treats a lone --- line as a page break, even without surrounding blank lines', () => {
    const blocks = parseInput('Panel one\n---\nPanel two');
    expect(blocks).toEqual<Block[]>([
      { type: 'paragraph', text: 'Panel one' },
      { type: 'break' },
      { type: 'paragraph', text: 'Panel two' },
    ]);
  });

  it('also accepts === as a break marker', () => {
    const blocks = parseInput('A\n\n===\n\nB');
    expect(blocks.filter((b) => b.type === 'break')).toHaveLength(1);
  });

  it('does not treat inline dashes as a break', () => {
    const blocks = parseInput('a — b --- c');
    expect(blocks).toEqual<Block[]>([{ type: 'paragraph', text: 'a — b --- c' }]);
  });
});

describe('splitIntoSentences', () => {
  it('splits at sentence boundaries keeping terminal punctuation', () => {
    expect(splitIntoSentences('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?']);
  });

  it('returns the whole string when there is no boundary', () => {
    expect(splitIntoSentences('no terminal punctuation here')).toEqual([
      'no terminal punctuation here',
    ]);
  });
});

describe('paginate — greedy paragraph packing', () => {
  it('fills a page until the next paragraph would overflow, then starts a new one', () => {
    const blocks: Block[] = [
      { type: 'paragraph', text: 'a'.repeat(40) },
      { type: 'paragraph', text: 'b'.repeat(40) },
      { type: 'paragraph', text: 'c'.repeat(40) },
    ];
    // page 1: 40 + gap(5) + 40 = 85 <= 100; adding c → 85+5+40=130 > 100.
    const pages = paginate(blocks, measureByLength, { availableHeight: 100, gap: 5 });
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(2);
    expect(pages[1]).toHaveLength(1);
  });

  it('puts everything on one page when it all fits', () => {
    const blocks: Block[] = [
      { type: 'paragraph', text: 'short' },
      { type: 'paragraph', text: 'also short' },
    ];
    const pages = paginate(blocks, measureByLength, { availableHeight: 1000, gap: 5 });
    expect(pages).toHaveLength(1);
    expect(pages[0]).toEqual(['short', 'also short']);
  });
});

describe('paginate — explicit breaks', () => {
  it('forces a new page at a break block regardless of remaining space', () => {
    const blocks: Block[] = [
      { type: 'paragraph', text: 'one' },
      { type: 'break' },
      { type: 'paragraph', text: 'two' },
    ];
    const pages = paginate(blocks, measureByLength, { availableHeight: 10_000, gap: 5 });
    expect(pages).toEqual([['one'], ['two']]);
  });

  it('does not emit empty pages for leading / doubled breaks', () => {
    const blocks: Block[] = [
      { type: 'break' },
      { type: 'paragraph', text: 'one' },
      { type: 'break' },
      { type: 'break' },
      { type: 'paragraph', text: 'two' },
    ];
    const pages = paginate(blocks, measureByLength, { availableHeight: 10_000, gap: 5 });
    expect(pages).toEqual([['one'], ['two']]);
  });
});

describe('paginate — sentence-level fallback', () => {
  it('splits a paragraph taller than a page at sentence boundaries', () => {
    // Whole paragraph length is 16 (> available 8); sentence heights are
    // 4 ("one."), 4 ("two."), 6 ("three.").
    const blocks: Block[] = [{ type: 'paragraph', text: 'one. two. three.' }];
    const pages = paginate(blocks, measureByLength, { availableHeight: 8, gap: 1 });
    // Page 1 packs "one." + "two." (4+4=8), page 2 gets "three.".
    expect(pages).toEqual([['one. two.'], ['three.']]);
  });

  it('places an un-splittable over-tall paragraph alone rather than dropping it', () => {
    const blocks: Block[] = [{ type: 'paragraph', text: 'x'.repeat(100) }];
    const pages = paginate(blocks, measureByLength, { availableHeight: 10, gap: 1 });
    expect(pages).toEqual([['x'.repeat(100)]]);
  });
});

describe('buildMeasurementUnits', () => {
  it('includes every paragraph plus each of its sentence fragments, de-duped', () => {
    const blocks = parseInput('First. Second.\n\nOnly one');
    const units = buildMeasurementUnits(blocks);
    const texts = units.map((u) => u.text);
    expect(texts).toContain('First. Second.');
    expect(texts).toContain('First.');
    expect(texts).toContain('Second.');
    expect(texts).toContain('Only one');
    // keys are unique
    expect(new Set(units.map((u) => u.key)).size).toBe(units.length);
  });
});

describe('buildPageHtml — slot injection + chrome', () => {
  it('escapes paragraphs and injects them as <p> slots inside the frame', () => {
    const html = buildPageHtml({
      paragraphs: ['Tom & Jerry <b>', 'Second line'],
      pageIndex: 0,
      pageCount: 1,
      fontSize: 44,
      showPageIndicator: true,
    });
    expect(html).toContain('<p>Tom &amp; Jerry &lt;b&gt;</p>');
    expect(html).toContain('<p>Second line</p>');
    expect(html).toContain(POLEMICYST_HANDLE);
    expect(html).toContain('font-size:44px');
  });

  it('shows no page indicator on single-page output', () => {
    const html = buildPageHtml({
      paragraphs: ['solo'],
      pageIndex: 0,
      pageCount: 1,
      fontSize: 44,
      showPageIndicator: true,
    });
    // The .pageIndicator CSS class is always defined in <style>; assert the
    // rendered indicator DIV is absent for single-page output.
    expect(html).not.toContain('class="pageIndicator"');
  });

  it('shows the "i / N" indicator on multi-page output when enabled', () => {
    const html = buildPageHtml({
      paragraphs: ['p'],
      pageIndex: 1,
      pageCount: 3,
      fontSize: 44,
      showPageIndicator: true,
    });
    expect(html).toContain('class="pageIndicator"');
    expect(html).toContain('2 / 3');
    expect(html).toContain('#8a2b1e'); // maroon, styled like the old .edition
  });

  it('omits the indicator when the toggle is off, even for multi-page', () => {
    const html = buildPageHtml({
      paragraphs: ['p'],
      pageIndex: 1,
      pageCount: 3,
      fontSize: 44,
      showPageIndicator: false,
    });
    expect(html).not.toContain('2 / 3');
  });
});

describe('computeAvailableHeight', () => {
  it('subtracts padding, footer, and frame chrome from the card height', () => {
    const footer = 49;
    expect(computeAvailableHeight(footer)).toBe(
      CARD_HEIGHT - CARD_PADDING * 2 - footer - FRAME_CHROME
    );
  });
});

describe('shouldStopShrinking', () => {
  it('stops when the carousel fits within the page cap', () => {
    expect(shouldStopShrinking(3, 44, { maxPages: 10, minFontSize: 22 })).toBe(true);
  });
  it('stops at the font-size floor even if still over the cap', () => {
    expect(shouldStopShrinking(15, 22, { maxPages: 10, minFontSize: 22 })).toBe(true);
  });
  it('keeps shrinking when over the cap and above the floor', () => {
    expect(shouldStopShrinking(15, 44, { maxPages: 10, minFontSize: 22 })).toBe(false);
  });
});

describe('selectFontSizeAndPaginate — uniform shrink loop', () => {
  const blocks: Block[] = Array.from({ length: 20 }, (_, i) => ({
    type: 'paragraph' as const,
    text: `paragraph ${i}`,
  }));

  // Synthetic layout: bigger font ⇒ taller paragraphs ⇒ fewer per page ⇒ more
  // pages. Available height is fixed; per-paragraph height scales with font.
  const layoutFor = (fontSize: number) => ({
    availableHeight: 100,
    measure: (() => fontSize) as ParagraphMeasurer,
  });

  it('keeps the comfortable font-size when the carousel is already within the cap', () => {
    const result = selectFontSizeAndPaginate(blocks.slice(0, 4), layoutFor, {
      startFontSize: 44,
      maxPages: 10,
    });
    expect(result.fontSize).toBe(44);
    expect(result.pages.length).toBeLessThanOrEqual(10);
  });

  it('shrinks the font-size until the page count falls within the cap', () => {
    // At font 44, 20 paragraphs → 20 pages (>10). Shrinking increases how many
    // fit per page until pages <= maxPages.
    const result = selectFontSizeAndPaginate(blocks, layoutFor, {
      startFontSize: 44,
      minFontSize: 10,
      fontStep: 2,
      maxPages: 10,
    });
    expect(result.fontSize).toBeLessThan(44);
    expect(result.pages.length).toBeLessThanOrEqual(10);
  });

  it('never shrinks below the floor', () => {
    // Impossible cap (0 pages allowed) — the loop must bottom out at the floor.
    const result = selectFontSizeAndPaginate(blocks, layoutFor, {
      startFontSize: 44,
      minFontSize: 22,
      fontStep: 2,
      maxPages: 0,
    });
    expect(result.fontSize).toBe(22);
  });
});
