/**
 * Playwright auth fixture.
 *
 * Runs `scripts/mint-test-jwt.ts` once per test, injects the resulting JWT as:
 *   1. `__Secure-next-auth.session-token` cookie — mirrors the NextAuth web
 *      session cookie (with the `__Secure-` prefix because `NEXTAUTH_URL`
 *      starts with `https://` in dev).
 *   2. `Authorization: Bearer <jwt>` header on every request — mirrors the
 *      mobile-parity path handled by `getAuthenticatedUser`.
 *
 * Both are injected because different call sites in the app pick different
 * paths (page navigations use the cookie via `getServerSession`; some
 * client-side fetches may use the bearer header explicitly).
 */

import { test as base, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

interface MintedAuth {
  token: string;
  user: { id: string; email: string; name: string | null };
}

let cachedAuth: MintedAuth | null = null;

function mintAuth(): MintedAuth {
  if (cachedAuth) return cachedAuth;

  const stdout = execFileSync('npx', ['tsx', 'scripts/mint-test-jwt.ts'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  const marker = '__MINT_JWT_JSON__';
  const idx = stdout.lastIndexOf(marker);
  if (idx < 0) {
    throw new Error(`mint-test-jwt.ts did not emit the sentinel marker; stdout:\n${stdout}`);
  }
  const json = stdout.slice(idx + marker.length).trim();
  cachedAuth = JSON.parse(json) as MintedAuth;
  return cachedAuth;
}

function cookieHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return 'localhost';
  }
}

export const test = base.extend<{ auth: MintedAuth }>({
  auth: async ({ context, browser: _browser }, provide, testInfo) => {
    const auth = mintAuth();
    const baseURL = testInfo.project.use.baseURL ?? 'https://localhost:3000';
    const domain = cookieHost(baseURL);

    // Session cookie (web).
    await context.addCookies([
      {
        name: '__Secure-next-auth.session-token',
        value: auth.token,
        domain,
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
      },
      // Also drop the non-secure name in case a downstream env flips to http.
      {
        name: 'next-auth.session-token',
        value: auth.token,
        domain,
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
        expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
      },
    ]);

    // Mobile-parity bearer header.
    await context.setExtraHTTPHeaders({
      Authorization: `Bearer ${auth.token}`,
    });

    await provide(auth);
  },
});

export { expect };
