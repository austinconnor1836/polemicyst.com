import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInput,
  escapeHtml,
  splitIntoSentences,
  paginate,
  shouldStopShrinking,
  selectFontSizeAndPaginate,
  buildMeasurementUnits,
  computeAvailableHeight,
  type Block,
  type ParagraphMeasurer,
  CARD_HEIGHT,
  CARD_PADDING,
  FRAME_CHROME,
} from '../src/pagination.ts';

// --- parseInput -------------------------------------------------------------

test('parseInput splits paragraphs on blank lines', () => {
  const blocks = parseInput('First para.\n\nSecond para.');
  assert.deepEqual(blocks, [
    { type: 'paragraph', text: 'First para.' },
    { type: 'paragraph', text: 'Second para.' },
  ]);
});

test('parseInput collapses single newlines within a paragraph to spaces', () => {
  const blocks = parseInput('line one\nline two');
  assert.deepEqual(blocks, [{ type: 'paragraph', text: 'line one line two' }]);
});

test('parseInput honors --- explicit page breaks', () => {
  const blocks = parseInput('A\n\n---\n\nB');
  assert.deepEqual(blocks, [
    { type: 'paragraph', text: 'A' },
    { type: 'break' },
    { type: 'paragraph', text: 'B' },
  ]);
});

test('parseInput honors === explicit page breaks', () => {
  const blocks = parseInput('A\n\n===\n\nB');
  assert.equal(blocks.filter((b) => b.type === 'break').length, 1);
});

test('parseInput drops empty paragraphs and trims', () => {
  const blocks = parseInput('  \n\n  hello  \n\n\n\n');
  assert.deepEqual(blocks, [{ type: 'paragraph', text: 'hello' }]);
});

test('parseInput normalizes CRLF', () => {
  const blocks = parseInput('A\r\n\r\nB');
  assert.equal(blocks.length, 2);
});

// --- escapeHtml -------------------------------------------------------------

test('escapeHtml escapes all unsafe characters', () => {
  assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});

// --- splitIntoSentences -----------------------------------------------------

test('splitIntoSentences splits on sentence boundaries keeping punctuation', () => {
  assert.deepEqual(splitIntoSentences('One. Two! Three?'), ['One.', 'Two!', 'Three?']);
});

test('splitIntoSentences returns single element when no boundary', () => {
  assert.deepEqual(splitIntoSentences('no terminal punctuation here'), [
    'no terminal punctuation here',
  ]);
});

// --- paginate ---------------------------------------------------------------

/** Each paragraph is a fixed 100px tall for deterministic packing. */
const fixed100: ParagraphMeasurer = () => 100;

test('paginate greedily packs paragraphs until overflow', () => {
  const blocks: Block[] = [
    { type: 'paragraph', text: 'a' },
    { type: 'paragraph', text: 'b' },
    { type: 'paragraph', text: 'c' },
  ];
  // avail 250, gap 34: a(100) + 34 + b(100) = 234 fits; + 34 + c would be 368 -> page 2
  const pages = paginate(blocks, fixed100, { availableHeight: 250, gap: 34 });
  assert.deepEqual(pages, [['a', 'b'], ['c']]);
});

test('paginate starts a new page on an explicit break', () => {
  const blocks: Block[] = [
    { type: 'paragraph', text: 'a' },
    { type: 'break' },
    { type: 'paragraph', text: 'b' },
  ];
  const pages = paginate(blocks, fixed100, { availableHeight: 1000, gap: 34 });
  assert.deepEqual(pages, [['a'], ['b']]);
});

test('paginate splits an over-tall paragraph at sentence boundaries', () => {
  // paragraph taller than the page as a whole, but sentences fit
  const long = 'Sentence one is here. Sentence two is here. Sentence three is here.';
  const measure: ParagraphMeasurer = (t) => (t === long ? 500 : 120);
  const pages = paginate([{ type: 'paragraph', text: long }], measure, {
    availableHeight: 260,
    gap: 34,
  });
  // 260 avail, each sentence 120: two sentences (240) per page -> page1 two, page2 one
  assert.equal(pages.length, 2);
  assert.ok(pages[0]!.length === 1); // rejoined chunk string
});

test('paginate places an un-splittable over-tall paragraph alone', () => {
  const measure: ParagraphMeasurer = () => 999;
  const pages = paginate([{ type: 'paragraph', text: 'unsplittable' }], measure, {
    availableHeight: 200,
    gap: 34,
  });
  assert.deepEqual(pages, [['unsplittable']]);
});

// --- shouldStopShrinking ----------------------------------------------------

test('shouldStopShrinking stops when within page cap', () => {
  assert.equal(shouldStopShrinking(5, 44, { maxPages: 10, minFontSize: 22 }), true);
});

test('shouldStopShrinking stops at the font floor even if over cap', () => {
  assert.equal(shouldStopShrinking(20, 22, { maxPages: 10, minFontSize: 22 }), true);
});

test('shouldStopShrinking continues when over cap and above floor', () => {
  assert.equal(shouldStopShrinking(20, 44, { maxPages: 10, minFontSize: 22 }), false);
});

// --- selectFontSizeAndPaginate ---------------------------------------------

test('selectFontSizeAndPaginate keeps comfortable size when it fits', () => {
  const blocks: Block[] = [{ type: 'paragraph', text: 'a' }];
  const { fontSize, pages } = selectFontSizeAndPaginate(
    blocks,
    () => ({ availableHeight: 1000, measure: fixed100 }),
    { startFontSize: 44 }
  );
  assert.equal(fontSize, 44);
  assert.equal(pages.length, 1);
});

test('selectFontSizeAndPaginate shrinks when carousel exceeds the page cap', () => {
  const blocks: Block[] = Array.from({ length: 30 }, (_, i) => ({
    type: 'paragraph' as const,
    text: `p${i}`,
  }));
  // Height shrinks with font size, so fewer pages as we step down.
  const { fontSize, pages } = selectFontSizeAndPaginate(
    blocks,
    (fs) => ({ availableHeight: 200, measure: () => fs * 2 }),
    { startFontSize: 44, minFontSize: 22, fontStep: 2, maxPages: 5, gap: 0 }
  );
  assert.ok(fontSize < 44, 'should have shrunk');
  assert.ok(pages.length <= 5 || fontSize === 22);
});

// --- buildMeasurementUnits + computeAvailableHeight -------------------------

test('buildMeasurementUnits includes paragraphs and their sentence fragments, deduped', () => {
  const blocks = parseInput('One. Two.\n\nOne. Two.');
  const units = buildMeasurementUnits(blocks);
  const texts = units.map((u) => u.text);
  assert.ok(texts.includes('One. Two.'));
  assert.ok(texts.includes('One.'));
  assert.ok(texts.includes('Two.'));
  // dedupe: 'One. Two.' appears once despite two identical paragraphs
  assert.equal(texts.filter((t) => t === 'One. Two.').length, 1);
});

test('computeAvailableHeight subtracts padding, footer, and frame chrome', () => {
  const footerH = 49;
  const expected = CARD_HEIGHT - CARD_PADDING * 2 - footerH - FRAME_CHROME;
  assert.equal(computeAvailableHeight(footerH), expected);
});
