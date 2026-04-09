/**
 * Screenshot a quoted passage from an article/webpage.
 *
 * Uses Puppeteer to navigate to the source URL, locate the quoted text,
 * highlight it, and capture a viewport screenshot at the target video
 * dimensions (mobile 720x1280 or landscape 1280x720).
 */

import puppeteerCore from 'puppeteer-core';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function getChromiumPath(): string | undefined {
  return process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
}

export interface ScreenshotQuoteOptions {
  /** URL of the article/webpage containing the quote */
  sourceUrl: string;
  /** The quoted text to find and highlight on the page */
  quoteText: string;
  /** Viewport width (e.g. 720 for mobile, 1280 for landscape) */
  width: number;
  /** Viewport height (e.g. 1280 for mobile, 720 for landscape) */
  height: number;
  /** Attribution text to overlay at the bottom of the screenshot */
  attribution?: string | null;
}

export interface ScreenshotResult {
  /** Path to the generated PNG file (temp) */
  imagePath: string;
  width: number;
  height: number;
  /** Whether the exact quote text was found on the page */
  textFound: boolean;
}

/**
 * Navigate to a URL, find and highlight the quoted text, and take a screenshot.
 *
 * The screenshot is taken at the exact video canvas dimensions so it can be
 * overlaid directly in the FFmpeg filter graph or drawn on the client canvas.
 */
export async function screenshotQuoteFromUrl(
  opts: ScreenshotQuoteOptions
): Promise<ScreenshotResult> {
  const { sourceUrl, quoteText, width, height, attribution } = opts;

  const launchOptions: Record<string, unknown> = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
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

    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log(`[quoteScreenshot] Navigating to ${sourceUrl}...`);
    await page.goto(sourceUrl, {
      waitUntil: 'networkidle2',
      timeout: 20_000,
    });

    await page.evaluate(() => document.fonts?.ready);

    // Dismiss common cookie/popup overlays
    await page
      .evaluate(() => {
        const selectors = [
          '[class*="cookie"] button',
          '[class*="consent"] button',
          '[id*="cookie"] button',
          '[class*="popup"] [class*="close"]',
          '[class*="modal"] [class*="close"]',
          '[class*="overlay"] [class*="close"]',
          'button[aria-label="Close"]',
          'button[aria-label="Accept"]',
          'button[aria-label="Accept all"]',
        ];
        for (const sel of selectors) {
          const btn = document.querySelector(sel) as HTMLElement;
          if (btn) {
            btn.click();
            break;
          }
        }
      })
      .catch(() => {});

    await new Promise((r) => setTimeout(r, 500));

    // Search for the quoted text on the page and highlight it
    const textFound = await page.evaluate(
      (searchText: string) => {
        function findTextNode(
          root: Node,
          text: string
        ): { node: Text; offset: number } | null {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          let accumulated = '';
          const nodes: { node: Text; start: number }[] = [];

          let current: Text | null;
          while ((current = walker.nextNode() as Text | null)) {
            const parent = current.parentElement;
            if (parent) {
              const style = window.getComputedStyle(parent);
              if (style.display === 'none' || style.visibility === 'hidden') continue;
            }
            nodes.push({ node: current, start: accumulated.length });
            accumulated += current.textContent || '';
          }

          const normalized = accumulated
            .replace(/\s+/g, ' ')
            .toLowerCase();
          const searchNorm = text.replace(/\s+/g, ' ').toLowerCase();

          const idx = normalized.indexOf(searchNorm);
          if (idx === -1) return null;

          for (const entry of nodes) {
            const nodeEnd = entry.start + (entry.node.textContent || '').length;
            if (nodeEnd > idx) {
              return { node: entry.node, offset: idx - entry.start };
            }
          }
          return null;
        }

        // Try progressively shorter substrings (articles may have slight text differences)
        const attempts = [
          searchText,
          searchText.slice(0, Math.floor(searchText.length * 0.8)),
          searchText.slice(0, Math.floor(searchText.length * 0.6)),
          searchText.split(/[.!?]/)[0],
        ].filter((t) => t.length > 20);

        let found: { node: Text; offset: number } | null = null;
        for (const attempt of attempts) {
          found = findTextNode(document.body, attempt);
          if (found) break;
        }

        if (!found) return false;

        // Scroll the found text into view (centered)
        const range = document.createRange();
        range.setStart(found.node, Math.max(0, found.offset));
        range.setEnd(
          found.node,
          Math.min(
            (found.node.textContent || '').length,
            found.offset + searchText.length
          )
        );

        const rect = range.getBoundingClientRect();
        const scrollY = window.scrollY + rect.top - window.innerHeight * 0.3;
        window.scrollTo({ top: Math.max(0, scrollY), behavior: 'instant' });

        // Highlight the text with a styled overlay
        const mark = document.createElement('mark');
        mark.style.cssText = `
          background: linear-gradient(135deg, rgba(226, 183, 20, 0.35), rgba(226, 183, 20, 0.25));
          border-left: 4px solid #e2b714;
          padding: 4px 8px;
          border-radius: 4px;
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
        `;

        try {
          range.surroundContents(mark);
        } catch {
          // If surroundContents fails (spans multiple elements), use an overlay approach
          const rects = range.getClientRects();
          for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            const overlay = document.createElement('div');
            overlay.style.cssText = `
              position: absolute;
              top: ${r.top + window.scrollY}px;
              left: ${r.left}px;
              width: ${r.width}px;
              height: ${r.height}px;
              background: rgba(226, 183, 20, 0.3);
              border-left: ${i === 0 ? '4px solid #e2b714' : 'none'};
              pointer-events: none;
              z-index: 99999;
            `;
            document.body.appendChild(overlay);
          }
        }

        return true;
      },
      quoteText
    );

    if (textFound) {
      console.log('[quoteScreenshot] Quote text found and highlighted');
    } else {
      console.warn('[quoteScreenshot] Quote text not found — taking page screenshot as-is');
    }

    await new Promise((r) => setTimeout(r, 300));

    // Add a subtle attribution bar at the bottom
    if (attribution) {
      await page.evaluate(
        (attr: string, h: number) => {
          const bar = document.createElement('div');
          bar.style.cssText = `
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            height: ${Math.round(h * 0.04)}px;
            min-height: 28px;
            background: rgba(0, 0, 0, 0.85);
            color: #e2b714;
            font: 600 ${Math.max(11, Math.round(h * 0.014))}px -apple-system, "Segoe UI", sans-serif;
            display: flex;
            align-items: center;
            padding: 0 16px;
            z-index: 999999;
            letter-spacing: 0.3px;
          `;
          bar.textContent = `📖 SOURCE: ${attr}`;
          document.body.appendChild(bar);
        },
        attribution,
        height
      );
    }

    // Take the screenshot
    const screenshotBuffer = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width, height },
    });

    const imagePath = path.join(
      os.tmpdir(),
      `quote-screenshot-${Date.now()}-${Math.random().toString(36).slice(2)}.png`
    );
    fs.writeFileSync(imagePath, Buffer.from(screenshotBuffer));

    console.log(`[quoteScreenshot] Screenshot saved: ${imagePath} (${width}x${height})`);

    return { imagePath, width, height, textFound };
  } finally {
    await browser.close();
  }
}

/**
 * Take screenshots of a quote from its source URL at both mobile and landscape sizes.
 */
export async function screenshotQuoteBothLayouts(opts: {
  sourceUrl: string;
  quoteText: string;
  attribution?: string | null;
}): Promise<{ mobile: ScreenshotResult; landscape: ScreenshotResult }> {
  const mobile = await screenshotQuoteFromUrl({
    ...opts,
    width: 720,
    height: 1280,
  });

  const landscape = await screenshotQuoteFromUrl({
    ...opts,
    width: 1280,
    height: 720,
  });

  return { mobile, landscape };
}
