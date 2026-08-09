/**
 * Fidelity verification harness.
 *
 * Renders three canonical cases through BOTH backends:
 *   - Satori + resvg (this service)  -> the browserless candidate
 *   - Puppeteer + system Chrome (the monolith's reference renderer) -> ground truth
 *
 * and writes per-case side-by-side contact sheets (Satori left, Chromium right)
 * plus the individual page PNGs, into ./out/.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

import { renderPolemicystGraphic as renderSatori } from '../src/render.ts';

// Ground truth: the monolith's Chromium renderer, pointed at system Chrome.
process.env.PUPPETEER_EXECUTABLE_PATH =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { renderPolemicystGraphic: renderChromium } =
  await import('../../../shared/util/polemicystGraphic.ts');

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const FONT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'fonts',
  'RobotoCondensed-Bold.ttf'
);

interface Case {
  id: string;
  title: string;
  text: string;
  showPageIndicator?: boolean;
}

const longText = Array.from(
  { length: 14 },
  (_, i) =>
    `Paragraph number ${i + 1}. This is a reasonably long political argument sentence that takes up multiple lines when typeset into the Spectral serif brand card so pagination kicks in and produces a carousel of pages.`
).join('\n\n');

const cases: Case[] = [
  {
    id: '1-short',
    title: 'Case 1 - single short post (expect 1 page, no indicator)',
    text: "It's irrational to trust a man who talks election interference when he sided with the Russians in 2018 at Helsinki.",
  },
  {
    id: '2-long',
    title: 'Case 2 - long auto-paginated carousel (expect ~6-8 pages, i/N indicators)',
    text: longText,
  },
  {
    id: '3-explicit',
    title: 'Case 3 - explicit --- breaks forcing a 3-panel carousel',
    text: 'Panel one text here. The first premise of the argument.\n\n---\n\nPanel two text here. The second premise builds on it.\n\n---\n\nPanel three text here. Therefore the conclusion follows.',
  },
];

// --- PNG helpers ------------------------------------------------------------

function pngSize(buf: Buffer): { w: number; h: number } {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function dataUri(buf: Buffer): string {
  return `data:image/png;base64,${buf.toString('base64')}`;
}

/** Compose a two-column contact sheet (Satori | Chromium) via resvg. */
function contactSheet(title: string, left: Buffer[], right: Buffer[]): Buffer {
  const dw = 520;
  const dh = 650; // 2160x2700 -> 520x650 keeps aspect
  const margin = 24;
  const gap = 24;
  const headerH = 96;
  const rows = Math.max(left.length, right.length);
  const width = margin * 2 + dw * 2 + gap;
  const height = headerH + rows * (dh + gap) + margin;

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`);
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  parts.push(
    `<text x="${margin}" y="40" font-family="Roboto Condensed" font-weight="700" font-size="26" fill="#161512">${esc(title)}</text>`
  );
  parts.push(
    `<text x="${margin}" y="76" font-family="Roboto Condensed" font-weight="700" font-size="22" fill="#8a2b1e">SATORI + resvg (browserless)</text>`
  );
  parts.push(
    `<text x="${margin + dw + gap}" y="76" font-family="Roboto Condensed" font-weight="700" font-size="22" fill="#5c5850">CHROMIUM (ground truth)</text>`
  );

  for (let i = 0; i < rows; i++) {
    const y = headerH + i * (dh + gap);
    const cells: [Buffer | undefined, number][] = [
      [left[i], margin],
      [right[i], margin + dw + gap],
    ];
    for (const [buf, x] of cells) {
      if (buf) {
        parts.push(
          `<image x="${x}" y="${y}" width="${dw}" height="${dh}" href="${dataUri(buf)}"/>`
        );
        parts.push(
          `<rect x="${x}" y="${y}" width="${dw}" height="${dh}" fill="none" stroke="#c9c0ad"/>`
        );
      } else {
        parts.push(
          `<rect x="${x}" y="${y}" width="${dw}" height="${dh}" fill="#f0efe9" stroke="#c9c0ad"/>`
        );
        parts.push(
          `<text x="${x + dw / 2}" y="${y + dh / 2}" text-anchor="middle" font-family="Roboto Condensed" font-size="22" fill="#8a2b1e">(no page ${i + 1})</text>`
        );
      }
    }
  }
  parts.push('</svg>');

  const resvg = new Resvg(parts.join('\n'), {
    background: '#ffffff',
    font: { fontFiles: [FONT], loadSystemFonts: true, defaultFontFamily: 'Roboto Condensed' },
  });
  return Buffer.from(resvg.render().asPng());
}

// --- run --------------------------------------------------------------------

for (const c of cases) {
  process.stdout.write(`\n=== ${c.title} ===\n`);

  const satori = await renderSatori({ text: c.text, showPageIndicator: c.showPageIndicator });
  process.stdout.write(`  Satori:   ${satori.pageCount} page(s), fontSize ${satori.fontSize}\n`);
  satori.buffers.forEach((b, i) => {
    const { w, h } = pngSize(b);
    writeFileSync(join(OUT, `${c.id}-satori-${i + 1}.png`), b);
    if (i === 0) process.stdout.write(`  Satori dims: ${w}x${h}\n`);
  });

  const chromium = await renderChromium({ text: c.text, showPageIndicator: c.showPageIndicator });
  process.stdout.write(`  Chromium: ${chromium.length} page(s)\n`);
  chromium.forEach((b: Buffer, i: number) => {
    writeFileSync(join(OUT, `${c.id}-chromium-${i + 1}.png`), b);
  });

  const sheet = contactSheet(c.title, satori.buffers, chromium);
  writeFileSync(join(OUT, `${c.id}-compare.png`), sheet);
  process.stdout.write(`  wrote ${c.id}-compare.png\n`);
}

process.stdout.write('\nverify complete.\n');
