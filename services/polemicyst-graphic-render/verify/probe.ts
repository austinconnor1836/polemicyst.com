import satori from 'satori';
import { loadFonts } from '../src/fonts';
import { card, measureParagraph, measureFooter } from '../src/template';
import { renderPolemicystGraphic } from '../src/render';
import { FRAME_CONTENT_WIDTH } from '../src/pagination';
import { writeFileSync } from 'node:fs';

const fonts = loadFonts();

// 1) auto-height (width-only) support
const pSvg = await satori(measureParagraph('The quick brown fox jumps.', 46) as never, {
  width: FRAME_CONTENT_WIDTH,
  fonts: fonts as never,
});
const fSvg = await satori(measureFooter() as never, {
  width: FRAME_CONTENT_WIDTH,
  fonts: fonts as never,
});
console.log('paragraph SVG root:', pSvg.slice(0, pSvg.indexOf('>') + 1));
console.log('footer SVG root:   ', fSvg.slice(0, fSvg.indexOf('>') + 1));

// 2) full card SVG — inspect for gradient + double border
const cardSvg = await satori(
  card({
    paragraphs: ['It is irrational to trust a man who talks election interference.'],
    fontSize: 46,
    pageIndex: 0,
    pageCount: 1,
    showPageIndicator: false,
  }) as never,
  { width: 1080, height: 1350, fonts: fonts as never }
);
writeFileSync(new URL('./out/probe-card.svg', import.meta.url), cardSvg);
console.log(
  'gradient present in SVG:',
  /linearGradient|repeating/i.test(cardSvg) || cardSvg.includes('pattern')
);
console.log('svg length:', cardSvg.length);

// 3) full pipeline -> PNG
const res = await renderPolemicystGraphic({
  text: 'It is irrational to trust a man who talks election interference.',
  showPageIndicator: false,
});
writeFileSync(new URL('./out/probe.png', import.meta.url), res.buffers[0]!);
console.log(
  'PNG pages:',
  res.pageCount,
  'fontSize:',
  res.fontSize,
  'bytes:',
  res.buffers[0]!.length
);
