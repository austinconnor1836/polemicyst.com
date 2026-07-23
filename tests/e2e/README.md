# E2E tests (Playwright)

Chromium-only Playwright suite for the Next.js app. Assumes the dev server is
already running on `PLAYWRIGHT_BASE_URL` (default `https://localhost:3000`).

## Run

```
# start the dev server first (self-signed HTTPS)
npm run dev

# in another shell
npm run test:e2e
# or a single spec:
npx playwright test tests/e2e/smoke.spec.ts
# open the HTML report after a failure
npx playwright show-report
```

## Auth

Tests import `test` from `tests/e2e/fixtures/auth.ts`. The fixture shells out
to `scripts/mint-test-jwt.ts` — which idempotently seeds `e2e-test@polemicyst.local`
(plan `pro`) via `scripts/seed-test-user.ts` and mints a NextAuth-compatible
JWT with `NEXTAUTH_SECRET`. The JWT is injected as both the
`__Secure-next-auth.session-token` cookie (web) and the `Authorization: Bearer`
header (mobile-parity, matches `shared/lib/auth-helpers.ts`).
