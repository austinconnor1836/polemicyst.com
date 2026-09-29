/**
 * Shared Puppeteer launch helper.
 *
 * Chrome/Chromium binary resolution across every environment where Polemicyst
 * currently runs a headless browser (all inside Next.js API routes today —
 * quote screenshots, Polemicyst brand-graphic render, publish-graphic
 * rasterization). Callers pass through their existing launch args; this helper
 * only fills in the `executablePath` + serverless-only extras.
 *
 * Environment matrix:
 *
 *   1. **Vercel serverless** (`process.env.VERCEL === '1'`) → Chromium binary
 *      shipped by `@sparticuz/chromium`. Vercel's Node runtime has no system
 *      Chrome, so this is the only working option. `chromium.args` +
 *      `chromium.headless` + `chromium.defaultViewport` are honored.
 *
 *   2. **Fly / Docker containers with `PUPPETEER_EXECUTABLE_PATH` set** →
 *      point directly at that binary. This is how `Dockerfile` installs
 *      Chromium today, and it's also the escape hatch for CI.
 *
 *   3. **Local dev on macOS/Linux** → use whatever `puppeteer-core` resolves
 *      via `PUPPETEER_EXECUTABLE_PATH` (documented in `ENV_VARS.template`),
 *      or fall back to a system Chrome binary at the well-known macOS path.
 *      `puppeteer-core` requires an executablePath — it does NOT bundle a
 *      Chromium (that's what full `puppeteer` is for; we intentionally use
 *      `-core` to keep node_modules small).
 *
 * `@sparticuz/chromium` is a serverless-optimized Chromium build. Its entry
 * points are dynamically imported so the tarball (~50MB compressed) never
 * ships in local dev or worker Docker images.
 */

import type puppeteerCore from 'puppeteer-core';

type LaunchArg0 = Parameters<typeof puppeteerCore.launch>[0];

/**
 * Extra launch args we merge in on Vercel. `@sparticuz/chromium` publishes a
 * curated arg list that's known to work inside AWS Lambda / Vercel Serverless.
 */
export interface ResolvedLaunchOptions {
  headless: boolean | 'shell';
  args: string[];
  executablePath: string;
  defaultViewport: NonNullable<LaunchArg0>['defaultViewport'];
}

/**
 * Merge the caller's launch options with the resolved Chromium binary.
 *
 * `callerArgs` are appended AFTER the platform args so that caller-specific
 * flags (`--no-sandbox` etc.) win. The caller's own `headless` value is used
 * verbatim (all our callers pass `true`).
 */
export async function resolvePuppeteerLaunchOptions(
  callerArgs: string[] = []
): Promise<ResolvedLaunchOptions> {
  const isVercel = process.env.VERCEL === '1';

  if (isVercel) {
    // Dynamic import so the @sparticuz/chromium tarball only ends up in the
    // Vercel bundle — workers + local dev never pull it.
    const chromiumMod = await import('@sparticuz/chromium');
    // Depending on how it's bundled, it can be default or namespace.
    const chromium: any = (chromiumMod as any).default ?? chromiumMod;

    // Merge: platform args first, then caller args (so caller wins on dupes).
    const args: string[] = [...chromium.args, ...callerArgs];
    const executablePath: string = await chromium.executablePath();
    return {
      headless: true,
      args,
      executablePath,
      defaultViewport: chromium.defaultViewport,
    };
  }

  // Non-Vercel: rely on PUPPETEER_EXECUTABLE_PATH or macOS default Chrome.
  const executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

  return {
    headless: true,
    args: callerArgs,
    executablePath,
    defaultViewport: null,
  };
}
