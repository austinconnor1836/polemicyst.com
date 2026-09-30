# AWS → Cloudflare R2 + Neon + Upstash + Vercel + Fly.io — Migration Docs

Living index for the migration off AWS onto a cheaper managed stack. Each doc below is
authoritative for its slice; when in doubt, this README is a table of contents, not the
truth.

## Docs

| File                                             | Owner       | What it is                                                                                                                                                                         |
| ------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`env-vars.md`](./env-vars.md)                   | clients-obs | Canonical env var manifest for the whole stack (web + backend + workers + iOS + Android). AWS → new-stack mapping. Where each is stored (Vercel / Fly / Neon / xcconfig / gradle). |
| [`clients.md`](./clients.md)                     | clients-obs | Audit of iOS + Android hardcoded URLs. file:line for every hit, with a recommendation (leave / parameterize / delete).                                                             |
| [`secrets-inventory.md`](./secrets-inventory.md) | clients-obs | Every secret in the codebase, its home provider, rotation plan.                                                                                                                    |
| [`observability.md`](./observability.md)         | clients-obs | Decision doc for Sentry + Axiom + Better Uptime + Grafana Cloud. Free-tier limits with pricing-page citations.                                                                     |

Data plane (Neon, R2, Upstash provisioning), compute plane (Vercel + Fly.io), LLM strategy
(Ollama on Fly vs Gemini), and AWS teardown are owned by their respective agents. Their
docs land next to this one.

---

## Prod-hardening checklist

The migration is not "done" when the app boots on the new stack — it's done when the checks
below are all green. Grouped by owner. clients-obs items are checked here; others are
tracked in their sibling docs.

### Security headers (Next.js middleware) — clients-obs

- [ ] `src/middleware.ts` sets `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` on all responses.
- [ ] CSP header emitted on HTML routes only (not on `/api/*`), with per-request nonce.
  - `default-src 'self'`
  - `script-src 'self' 'nonce-<nonce>' https://apis.google.com https://www.googletagmanager.com https://us-assets.i.posthog.com` (extend as third-party scripts require).
  - `style-src 'self' 'unsafe-inline'` (Tailwind + shadcn/ui require inline styles at build time).
  - `img-src 'self' data: blob: https://*.r2.dev https://<R2_CDN_HOST> https://img.youtube.com https://yt3.googleusercontent.com https://<S3_BUCKET>.s3.<S3_REGION>.amazonaws.com` (drop the S3 host once R2 migration lands).
  - `connect-src 'self' https://us.i.posthog.com https://o<ORG>.ingest.sentry.io` — Sentry + PostHog.
  - `media-src 'self' https://<R2_CDN_HOST>` — clip playback.
  - `frame-ancestors 'none'` (equivalent to legacy X-Frame-Options: DENY).
  - `object-src 'none'`.
  - `upgrade-insecure-requests`.
- [ ] `X-Content-Type-Options: nosniff`.
- [ ] `Referrer-Policy: strict-origin-when-cross-origin`.
- [ ] `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(self)`.

### Rate limiting — clients-obs

- [ ] Public API routes (anything reachable without a session) rate-limited via
      `@upstash/ratelimit` + Upstash Redis REST client. - `/api/health` — 60/min per IP (public but cheap). - `/api/auth/mobile/*` — 10/min per IP (login is expensive + abuse-prone). - `/api/uploads/from-url` — 20/hour per user (once authed) OR per IP for anon. - `/api/polemicyst-graphic/render` — 30/hour per user (Puppeteer is expensive).
- [ ] Rate-limit response is HTTP 429 with `Retry-After` header + JSON `{ error: 'rate_limited', retryAfterSeconds }`.
- [ ] Rate-limit failures ("Redis down") **fail open** (allow the request, log to Sentry) — a
      broken limiter must not take the site down.

### CORS — clients-obs

- [ ] `/api/*` allows only: - `https://polemicyst.com` - `https://*.polemicyst.com` (subdomains — Vercel preview URLs match this or the
      `*.vercel.app` alias below). - `https://polemicyst-*.vercel.app` (preview deploys). - iOS + Android clients send no `Origin` header (native `URLSession` / `OkHttp`),
      so they bypass CORS entirely — do **not** allow `*`.

### Prisma logs off in prod — clients-obs

- [ ] `shared/lib/prisma.ts` conditionally enables `log: ['query', 'info', 'warn', 'error']`
      only when `NODE_ENV !== 'production'`. In prod, only `['error']`.

### Health checks + smoke tests — clients-obs (already partially done)

- [x] `src/app/api/health/route.ts` — Neon + Upstash + storage reachability, 200/503. **Already exists.** Migration diff: swap `S3Client` for the R2 client once the storage-plane agent lands the R2 adapter.
- [ ] Fly workers expose an HTTP health port (`GET /healthz` → 200 if BullMQ queue accessible + Prisma reachable). Owner: compute-plane agent.
- [ ] Better Uptime pings `/api/health` + Fly `/healthz` every 3 min.

### Observability — clients-obs

- [x] Sentry: `@sentry/nextjs` already installed. Configs at `sentry.server.config.ts` +
      `sentry.edge.config.ts` + `instrumentation.ts` + `instrumentation-client.ts`. Need:
      DSN env var on Vercel + Fly, source map upload wired in build, alert rules configured.
- [ ] Backend Express + workers Sentry init (see `backend/lib/sentry.ts` in this PR).
- [ ] Log shipping: Axiom vector installed on Fly, Vercel log drain to Axiom.
- [ ] Uptime monitors created (see `observability.md` signup checklist).
- [ ] Grafana Cloud stack created; Vercel Metrics + Fly metrics scrape endpoints wired.

### Backup strategy — split ownership

- [ ] Neon PITR: enabled on Pro (7 days). Verified retention setting. Owner: data-plane.
- [x] Weekly `pg_dump` → R2 offsite backup: `scripts/backup-neon-to-r2.ts` (in this PR).
      Runs from GitHub Actions cron.
- [ ] R2 bucket versioning ON, lifecycle rule to delete non-current versions >30 days.
      Owner: data-plane.
- [ ] Upstash daily backups: accept queue loss on free tier. Workers idempotent on
      `jobId = feedVideoId` so BullMQ re-enqueue is safe. Documented in `observability.md`.

### CI/CD hardening — clients-obs

- [x] `.github/workflows/ci.yml` — see this PR. lint + typecheck + test + prisma validate +
      build, with `node_modules` + Next.js build cache. Existing `ci.yml` upgraded, not
      replaced.
- [ ] Preview DBs on PR via Neon branch — Owner: data-plane. Wired via
      [`neondatabase/create-branch-action`](https://github.com/neondatabase/create-branch-action)
      into `preview.yml` (new).

### Client (iOS + Android) migration — clients-obs

- [ ] iOS `Configuration.swift` already reads `API_BASE_URL` from Info.plist. No code
      change needed — only `ios/project.yml` release value needs to move from
      `https://polemicyst.com` to the new prod URL (unchanged if we keep the apex on
      Vercel, which is the default plan).
- [ ] Android `build.gradle.kts` `prod` flavor `API_BASE_URL` — same story, unchanged if
      apex stays on Vercel.
- [ ] iOS `.entitlements` — add `com.apple.developer.associated-domains` with
      `applinks:polemicyst.com` **only when** we ship Universal Links (not shipped yet, no
      AASA file served, no code path). See `clients.md`.
- [ ] Android `AndroidManifest.xml` — `assetlinks.json` already served from
      `public/.well-known/assetlinks.json` (Vercel serves it, unchanged). Verify after
      Vercel cutover: `curl -sSL https://polemicyst.com/.well-known/assetlinks.json`.

---

## Migration cutover order

1. Data plane green (Neon reachable, R2 reachable). — data-plane.
2. Compute plane green (Vercel deploy of `main` boots + `/api/health` returns 200). — compute-plane.
3. Workers green on Fly (health endpoint 200, BullMQ jobs draining). — compute-plane.
4. DNS flip (polemicyst.com → Vercel). Confirm assetlinks.json still 200. — clients-obs.
5. Observability green (Sentry receiving events, uptime pings green, Axiom ingesting). — clients-obs.
6. AWS teardown (7-day soak first). — aws-teardown.
