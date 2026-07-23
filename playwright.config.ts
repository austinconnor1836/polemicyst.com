import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config for polemicyst.com / Clipfire.
 *
 * The dev server is expected to already be running on `PLAYWRIGHT_BASE_URL`
 * (defaults to https://localhost:3000 — the `next dev --experimental-https`
 * URL managed by the `/dev` skill). We do NOT spawn a `webServer` here so
 * that Playwright doesn't accidentally boot a second Next instance and fight
 * with the dev server the human already owns.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://localhost:3000',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  outputDir: 'test-results',
});
