/**
 * Rasterize self-contained HTML graphics to PNG buffers using Puppeteer.
 */

import puppeteerCore from 'puppeteer-core';

function getChromiumPath(): string | undefined {
  return process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
}

interface RasterizeOptions {
  width?: number;
  height?: number;
}

/**
 * Render an HTML string to a PNG buffer.
 * Uses system Chromium in production (PUPPETEER_EXECUTABLE_PATH env var)
 * or bundled Chromium in development.
 */
export async function rasterizeGraphic(
  htmlContent: string,
  options: RasterizeOptions = {}
): Promise<Buffer> {
  const { width = 1200, height = 630 } = options;
  const launchOptions: Record<string, unknown> = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };

  const executablePath = getChromiumPath();
  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

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
