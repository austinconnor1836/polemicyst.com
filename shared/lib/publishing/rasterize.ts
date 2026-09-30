/**
 * Rasterize self-contained HTML graphics to PNG buffers using Puppeteer.
 *
 * Called from Next.js API routes (`/api/articles/[id]/rasterize-graphics` and
 * `shared/lib/publishing/publish-service.ts`) which deploy to Vercel. Chromium
 * binary resolution — including the `@sparticuz/chromium` fallback for Vercel's
 * serverless runtime — lives in `shared/util/puppeteerLaunch.ts`.
 */

import puppeteerCore from 'puppeteer-core';
import { resolvePuppeteerLaunchOptions } from '../../util/puppeteerLaunch';

interface RasterizeOptions {
  width?: number;
  height?: number;
}

/**
 * Render an HTML string to a PNG buffer.
 *
 * Binary resolution:
 *   - On Vercel (`VERCEL === '1'`), uses `@sparticuz/chromium`.
 *   - Elsewhere, uses `PUPPETEER_EXECUTABLE_PATH` or macOS default Chrome.
 */
export async function rasterizeGraphic(
  htmlContent: string,
  options: RasterizeOptions = {}
): Promise<Buffer> {
  const { width = 1200, height = 630 } = options;
  const launchOptions = await resolvePuppeteerLaunchOptions([
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
  ]);

  const browser = await puppeteerCore.launch(
    launchOptions as Parameters<typeof puppeteerCore.launch>[0]
  );

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.setContent(htmlContent, { waitUntil: 'networkidle0', timeout: 15_000 });

    // Wait a bit for Google Fonts to load
    await page.evaluate(() => document.fonts?.ready);

    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: false,
      clip: { x: 0, y: 0, width, height },
    });

    return Buffer.from(screenshot);
  } finally {
    await browser.close();
  }
}

/**
 * Get the appropriate dimensions for a graphic type.
 */
export function getGraphicDimensions(type: string): { width: number; height: number } {
  switch (type) {
    case 'hero':
      return { width: 1200, height: 630 };
    case 'pull-quote':
      return { width: 800, height: 800 };
    case 'masthead':
      return { width: 1200, height: 200 };
    case 'divider':
      return { width: 1200, height: 100 };
    default:
      return { width: 1200, height: 630 };
  }
}
