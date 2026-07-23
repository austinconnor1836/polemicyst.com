import { test, expect } from './fixtures/auth';

test.describe('E2E smoke', () => {
  test('renders home page with correct title', async ({ page }) => {
    await page.goto('/');
    const title = await page.title();
    expect(title).toMatch(/Clipfire|Polemicyst/i);
  });

  test('auth fixture yields an authenticated session', async ({ page, auth }) => {
    // NextAuth's built-in `/api/auth/session` echoes the current user when the
    // session cookie is valid — proves the cookie half of the fixture works.
    const sessionRes = await page.request.get('/api/auth/session');
    expect(sessionRes.status()).toBe(200);
    const sessionBody = await sessionRes.json();
    expect(sessionBody?.user?.email).toBe(auth.user.email);

    // `/api/user/subscription` uses `getAuthenticatedUser` (cookie OR bearer).
    // A 200 here proves the app-side auth helper accepts the fixture too.
    const subRes = await page.request.get('/api/user/subscription');
    expect(subRes.status(), await subRes.text()).toBe(200);
    const subBody = await subRes.json();
    expect(subBody?.plan?.id).toBe('pro');
  });
});
