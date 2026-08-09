import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const uri = (p: string) => `data:image/png;base64,${readFileSync(join(OUT, p)).toString('base64')}`;

function zoomRegion(
  png: string,
  outName: string,
  cx: number,
  cy: number,
  cw: number,
  ch: number,
  scale: number
) {
  const dispW = cw * scale,
    dispH = ch * scale;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${dispW}" height="${dispH}">
    <rect width="${dispW}" height="${dispH}" fill="#f5f2e9"/>
    <image x="${-cx * scale}" y="${-cy * scale}" width="${2160 * scale}" height="${2700 * scale}" href="${uri(png)}"/>
  </svg>`;
  writeFileSync(join(OUT, outName), Buffer.from(new Resvg(svg).render().asPng()));
  console.log('wrote', outName);
}

// Footer double-border region (full-res 2160x2700). Footer top rule sits a bit
// above the @polemicyst handle near the bottom padding edge (~y 2470).
// Zoom the left half at 5x so the two 1px lines + gap are unambiguous.
zoomRegion('1-short-satori-1.png', 'footer-zoom-satori.png', 290, 2430, 420, 130, 5);
zoomRegion('1-short-chromium-1.png', 'footer-zoom-chromium.png', 290, 2430, 420, 130, 5);
