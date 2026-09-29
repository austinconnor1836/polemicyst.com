# Compute-Plane Migration Runbook (AWS ECS → Vercel + Fly.io)

Owner: `@compute-plane` migration agent.
Companion docs: `docs/architecture/vercel-migration.md` (design rationale, kept as prior art), `docs/migration/data-plane.md` (Neon + R2 + Upstash env names — WHEN IT LANDS).

**Scope of this doc:** everything that runs code. The Next.js web app moves to Vercel; the BullMQ workers move to Fly.io Machines; DNS moves to Cloudflare (fits with R2). It does **not** cover Neon (Postgres), R2 (S3-compat storage), Upstash (Redis), or Ollama sidecar deployment — those are separate agents.

---

## Target topology

```
   ┌──────────────────────────────────────────────────────────────┐
   │  Cloudflare DNS                                              │
   │    polemicyst.com  ─── A/CNAME ──▶  Vercel  (Next.js app)    │
   │    www.polemicyst.com                                        │
   │    clipfire.app / clipfire.co (if registered)                │
   └───────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
   ┌─────────────────────────────────────────────┐
   │  Vercel (Next.js @ iad1)                    │
   │   - Web UI + API routes                     │
   │   - NextAuth session cookies                │
   │   - Stripe webhooks                         │
   │   - Enqueues BullMQ jobs to Upstash (TCP)   │
   └───────────────┬─────────────────────────────┘
                   │  (Upstash Redis TCP endpoint, TLS)
                   ▼
   ┌─────────────────────────────────────────────┐
   │  Fly.io Machines (iad)                      │
   │   - polemicyst-clip-worker    (min=1, hot)  │
   │   - polemicyst-provocativeness (stub, min=0)│
   │   - polemicyst-comedic         (stub, min=0)│
   └─────────────────────────────────────────────┘

   Data plane (owned by data-plane agent, NOT this doc):
   ┌─────────┐  ┌────────────────┐  ┌────────────────┐  ┌─────────┐
   │ Neon PG │  │ Upstash Redis  │  │ Cloudflare R2  │  │ Ollama? │
   └─────────┘  └────────────────┘  └────────────────┘  └─────────┘
```

---

## Vercel setup — Next.js web

### Project configuration

| Field                | Value                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Framework preset     | Next.js                                                                                                                                  |
| Root directory       | `.` (the repo root — Next.js source is under `src/`, but `package.json` + `next.config.js` sit at repo root, which is what Vercel needs) |
| Build command        | `npx prisma generate && next build` (from `package.json`)                                                                                |
| Install command      | `npm ci`                                                                                                                                 |
| Output directory     | `.next` (default; `next.config.js` uses `output: 'standalone'` for Docker — Vercel ignores it)                                           |
| Node version         | 20.x                                                                                                                                     |
| Function region      | `iad1` (Washington DC — must co-locate with Neon primary; adjust when data-plane confirms)                                               |
| Git branch → prod    | `main` (trunk-based; `develop` was retired at v0.5.0, per repo CLAUDE.md)                                                                |
| Git branch → preview | every PR against `main` gets a unique preview URL (Vercel default)                                                                       |

The `vercel.json` at the repo root pins these + configures per-route `maxDuration` and `memory` overrides for LLM/render routes that exceed the default 10 s / 1024 MB.

### Per-route timeout budget

`vercel.json` sets `maxDuration` on hot routes based on observed p95:

| Route                                              | maxDuration | Memory | Why                             |
| -------------------------------------------------- | ----------- | ------ | ------------------------------- |
| `/api/feedVideos/[id]/truth-analysis` (POST)       | 60 s        | 1024   | Gemini analysis, p95 ~15-30 s   |
| `/api/feedVideos/[id]/truth-analysis/chat` (POST)  | 60 s        | 1024   | Multi-turn Gemini chat          |
| `/api/feedVideos/[id]/generate-metadata` (POST)    | 60 s        | 1024   | Gemini + Prisma writes          |
| `/api/feedVideos/[id]/transcribe` (POST)           | 30 s        | 1024   | Enqueues, occasionally slow     |
| `/api/feedVideos/[id]/innertube-transcribe` (POST) | 60 s        | —      | Fetches YouTube captions inline |
| `/api/clips/[id]/export` (POST)                    | 60 s        | 1024   | S3 signed URL + Prisma          |
| `/api/polemicyst-graphic/render` (POST)            | 60 s        | 1024   | Puppeteer HTML→PNG (heavy)      |
| `/api/trigger-clip` (POST)                         | 30 s        |        | Enqueues to BullMQ              |
| `/api/uploads/from-url` (POST)                     | 60 s        |        | May resolve IG/YouTube inline   |
| `/api/connected-accounts` (POST)                   | 60 s        |        | Polls channel metadata          |
| `/api/stripe/webhook` (POST)                       | 30 s        |        | Stripe idempotency; keep <30 s  |

All other routes inherit Vercel's default (10 s Hobby / 15 s Pro on Fluid Compute; we assume Pro).

**Vercel Pro is required**, not Hobby — Hobby caps at 10 s on functions and the Puppeteer / Gemini routes above will 504.

### Vercel Cron

`vercel.json` schedules a `*/15 * * * *` (every 15 min) probe on `/api/health` — this keeps the DB pool warm and gives us a Vercel-side heartbeat if the app is idle. Additional crons (feed polling? currently a Fargate worker — see "Open questions" below) can be added here without any code changes.

### Environment variables (Vercel dashboard)

All variables in the table below need to be set in the Vercel project's **Environment Variables** panel across **Production**, **Preview**, and **Development** scopes. The `SOURCE` column lists where the value comes from.

| Var                                  | Scope        | Source                                                                               |
| ------------------------------------ | ------------ | ------------------------------------------------------------------------------------ |
| `DATABASE_URL`                       | Prod+Preview | data-plane manifest (`NEON_DATABASE_URL_POOLED`)                                     |
| `DIRECT_URL`                         | Prod+Preview | data-plane manifest (`NEON_DATABASE_URL_DIRECT`) — for Prisma migrations             |
| `REDIS_HOST`                         | Prod+Preview | data-plane manifest (`UPSTASH_REDIS_HOST`)                                           |
| `REDIS_PORT`                         | Prod+Preview | data-plane manifest (`UPSTASH_REDIS_PORT`)                                           |
| `REDIS_PASSWORD` **(NEW)**           | Prod+Preview | data-plane manifest (`UPSTASH_REDIS_PASSWORD`) — code change required, see below     |
| `REDIS_TLS` **(NEW)**                | Prod+Preview | `true` (Upstash TCP endpoint is TLS) — code change required                          |
| `UPSTASH_REDIS_REST_URL`             | Prod+Preview | data-plane manifest — for rate-limit shim in `src/lib/rate-limit.ts`                 |
| `UPSTASH_REDIS_REST_TOKEN`           | Prod+Preview | data-plane manifest                                                                  |
| `S3_BUCKET`                          | Prod+Preview | data-plane manifest (`R2_BUCKET`)                                                    |
| `S3_REGION`                          | Prod+Preview | `auto` (R2 convention)                                                               |
| `S3_ENDPOINT` **(NEW)**              | Prod+Preview | data-plane manifest (`R2_S3_ENDPOINT`) — code change required, see below             |
| `S3_PREFIX`                          | Prod+Preview | `prod/` (Preview: `preview/`)                                                        |
| `AWS_ACCESS_KEY_ID`                  | Prod+Preview | data-plane manifest (`R2_ACCESS_KEY_ID`) — reused for R2                             |
| `AWS_SECRET_ACCESS_KEY`              | Prod+Preview | data-plane manifest (`R2_SECRET_ACCESS_KEY`)                                         |
| `AWS_REGION`                         | Prod+Preview | `auto`                                                                               |
| `NEXTAUTH_URL`                       | Prod         | `https://polemicyst.com`                                                             |
| `NEXTAUTH_URL`                       | Preview      | `https://$VERCEL_URL` (auto)                                                         |
| `NEXTAUTH_SECRET`                    | Prod+Preview | rotate on migration; 32-byte random                                                  |
| `AUTH_SECRET`                        | Prod+Preview | same as `NEXTAUTH_SECRET`                                                            |
| `GOOGLE_CLIENT_ID`                   | Prod+Preview | current value                                                                        |
| `GOOGLE_CLIENT_SECRET`               | Prod+Preview | current value                                                                        |
| `GOOGLE_IOS_CLIENT_ID`               | Prod+Preview | current value                                                                        |
| `APPLE_CLIENT_ID`                    | Prod+Preview | `com.clipfire.app`                                                                   |
| `AUTH_ALLOWLIST_ENABLED`             | Prod         | `true` (App Store review lockdown)                                                   |
| `AUTH_ALLOWED_EMAILS`                | Prod         | current allowlist                                                                    |
| `AUTH_ALLOWED_PROVIDERS`             | Prod         | `google,apple`                                                                       |
| `ADMIN_EMAIL`                        | Prod+Preview | `aconnor731@gmail.com`                                                               |
| `NEXT_PUBLIC_ADMIN_EMAIL`            | Prod+Preview | `aconnor731@gmail.com`                                                               |
| `STRIPE_SECRET_KEY`                  | Prod         | live key                                                                             |
| `STRIPE_SECRET_KEY`                  | Preview      | test key                                                                             |
| `STRIPE_WEBHOOK_SECRET`              | Prod         | live webhook secret (re-issued when the URL changes)                                 |
| `STRIPE_WEBHOOK_SECRET`              | Preview      | test webhook secret                                                                  |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Prod+Preview | corresponding publishable                                                            |
| `STRIPE_CREATOR_MONTHLY_PRICE_ID`    | Prod+Preview | current values                                                                       |
| `STRIPE_CREATOR_ANNUAL_PRICE_ID`     | Prod+Preview | current values                                                                       |
| `STRIPE_PRO_MONTHLY_PRICE_ID`        | Prod+Preview | current values                                                                       |
| `STRIPE_PRO_ANNUAL_PRICE_ID`         | Prod+Preview | current values                                                                       |
| `STRIPE_AGENCY_MONTHLY_PRICE_ID`     | Prod+Preview | current values                                                                       |
| `STRIPE_AGENCY_ANNUAL_PRICE_ID`      | Prod+Preview | current values                                                                       |
| `LLM_PROVIDER`                       | Prod+Preview | `gemini`                                                                             |
| `GOOGLE_API_KEY`                     | Prod+Preview | current value                                                                        |
| `ANTHROPIC_API_KEY`                  | Prod+Preview | current value (if used)                                                              |
| `OPENAI_API_KEY`                     | Prod+Preview | current value (if used)                                                              |
| `GEMINI_MODEL`                       | Prod+Preview | current default                                                                      |
| `OLLAMA_BASE_URL`                    | Prod+Preview | **placeholder — LLM-strategy agent**                                                 |
| `OLLAMA_MODEL`                       | Prod+Preview | **placeholder — LLM-strategy agent**                                                 |
| `POSTHOG_API_KEY`                    | Prod+Preview | current value                                                                        |
| `NEXT_PUBLIC_POSTHOG_KEY`            | Prod+Preview | current value                                                                        |
| `POSTHOG_HOST`                       | Prod+Preview | current value                                                                        |
| `NEXT_PUBLIC_POSTHOG_HOST`           | Prod+Preview | current value                                                                        |
| `SENTRY_DSN`                         | Prod+Preview | current value                                                                        |
| `NEXT_PUBLIC_SENTRY_DSN`             | Prod+Preview | current value                                                                        |
| `SENTRY_ORG` / `SENTRY_PROJECT`      | Prod         | current values (Preview optional)                                                    |
| `SENTRY_AUTH_TOKEN`                  | Prod         | current value — enables source-map upload                                            |
| `INSTAGRAM_SESSION_STATE_PATH`       | Prod+Preview | **N/A on Vercel** — IG import path won't work on serverless; see "Known limitations" |
| `MIN_APP_VERSION_IOS`                | Prod         | current value                                                                        |
| `MIN_APP_VERSION_ANDROID`            | Prod         | current value                                                                        |

### Code changes required (BEFORE Vercel cutover)

These are surfaces where the current code assumes an ECS/private-VPC environment and needs a small change so it works from Vercel:

1. **Redis auth + TLS support** — `shared/queues.ts:20` and `src/lib/rate-limit.ts` construct `new Redis({ host, port })` with no password or TLS. Upstash's TCP endpoint requires both. Extend to read `REDIS_PASSWORD` + `REDIS_TLS` (or a single `REDIS_URL`) and pass through to `ioredis`. This is a small PR; land it before flipping DNS.
2. **S3 endpoint override for R2** — `shared/lib/storage/s3-adapter.ts` uses `@aws-sdk/client-s3`. R2 is S3-compatible but needs `endpoint: process.env.S3_ENDPOINT` on the client config. Data-plane agent will provide `R2_S3_ENDPOINT`.
3. **Puppeteer on Vercel** — `polemicyst-graphic` renders HTML→PNG with Puppeteer. Vercel's serverless functions can't run full Chromium. Two options: (a) swap to `@sparticuz/chromium` + `puppeteer-core` (works on Vercel), or (b) move the render call to the Fly.io clip-worker via an internal HTTP endpoint. Cheaper to land option (a) first; escalate to (b) only if bundle size trips Vercel's 250 MB limit.
4. **Instagram resolver (`INSTAGRAM_SESSION_STATE_PATH`)** — reads a JSON session file from disk. Vercel functions have no persistent filesystem. Move the session state to Vercel Blob or R2 and fetch on demand, OR move the entire IG resolver into the Fly.io worker (it doesn't need to be in-request; it's a one-shot import).

Each of the above is a follow-up PR — do not block the compute-plane migration on them, but do flag them in `TODO.md` before merging this PR.

---

## Fly.io setup — workers

### App creation (Austin does this one time)

```
flyctl apps create polemicyst-clip-worker --org personal
flyctl apps create polemicyst-provocativeness --org personal  # stub; won't launch
flyctl apps create polemicyst-comedic --org personal          # stub; won't launch
```

### Secrets (per app)

```
flyctl secrets set --app polemicyst-clip-worker \
  DATABASE_URL="$NEON_DATABASE_URL_POOLED" \
  DIRECT_URL="$NEON_DATABASE_URL_DIRECT" \
  REDIS_HOST="$UPSTASH_REDIS_HOST" \
  REDIS_PORT="$UPSTASH_REDIS_PORT" \
  REDIS_PASSWORD="$UPSTASH_REDIS_PASSWORD" \
  REDIS_TLS=true \
  S3_BUCKET="$R2_BUCKET" \
  S3_REGION=auto \
  S3_ENDPOINT="$R2_S3_ENDPOINT" \
  S3_PREFIX=prod/ \
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  AWS_REGION=auto \
  GOOGLE_API_KEY="$GOOGLE_API_KEY" \
  LLM_PROVIDER=gemini \
  GEMINI_MODEL="$GEMINI_MODEL" \
  OLLAMA_BASE_URL="$OLLAMA_BASE_URL_PLACEHOLDER" \
  OLLAMA_MODEL="$OLLAMA_MODEL_PLACEHOLDER" \
  SENTRY_DSN="$SENTRY_DSN" \
  POSTHOG_API_KEY="$POSTHOG_API_KEY"
```

Note: `INSTAGRAM_SESSION_STATE_PATH` on Fly points at a file baked into the image at build time (or fetched from R2 in a startup hook) — this is where IG imports should ultimately live per code-change note (4) above.

### Ollama sidecar hole

`fly/provocativeness/fly.toml` and `fly/comedic/fly.toml` reference `OLLAMA_HOST` as a Fly secret. **Whatever the LLM-strategy agent decides** — self-hosted Ollama Machine, Replicate, Together, etc. — the endpoint gets stuffed into that secret. The `.toml` files intentionally do not deploy an Ollama sidecar; there is no docker-compose-style "co-located container" on Fly Machines. If a Fly-hosted Ollama is chosen, it's a separate `fly/ollama/fly.toml` app that these workers dial over the private 6PN network.

### Sizing decisions (baseline)

| Worker            | VM size         | RAM  | Region | Min | Rationale                                            |
| ----------------- | --------------- | ---- | ------ | --- | ---------------------------------------------------- |
| `clip-worker`     | `shared-cpu-2x` | 2 GB | `iad`  | 1   | Matches ECS 1024/2048; FFmpeg + Whisper CPU-bound    |
| `provocativeness` | `shared-cpu-2x` | 4 GB | `iad`  | 0   | Stub — matches ECS 1024/4096 for parity when revived |
| `comedic`         | `shared-cpu-2x` | 4 GB | `iad`  | 0   | ditto                                                |

**Why `min = 1` on clip-worker**: BullMQ workers hold a blocking Redis connection (`BRPOPLPUSH`). Fly's autoscale-to-zero + auto-start-machines only kicks a machine when TCP traffic arrives on the exposed port, but nothing HTTP-triggers a BullMQ consumer — Redis is the queue, not Fly's proxy. Two paths forward:

- **Chosen (v1)**: `min = 1`, always warm. Costs ~$5.70/mo for `shared-cpu-2x` + 2 GB. Simple, no code changes.
- **Follow-up (v2)**: replace BullMQ with **Upstash QStash** for the top-level `clip-generation` and `transcription` queues. QStash POSTs to an HTTP endpoint on the Fly worker, which lets `min = 0` + `auto_start_machines`. Migration effort: rewrite `shared/queues.ts` producer side + expose HTTP handlers on the worker. Deferred — not required for AWS exit.

### Health checks

All three fly.toml define a TCP health check on the exposed port (3001 for clip-worker, 3000 for the two stubs). The clip-worker's `http-server.ts` already exposes `/health` — the fly.toml also configures an HTTP check on that path. `/metrics` referenced in `[metrics]` doesn't exist yet — add a Prometheus scrape endpoint in a follow-up PR or drop the block; leaving it in is a placeholder that Fly ignores if the endpoint 404s.

---

## DNS — Cloudflare

All zones move to Cloudflare (it colocates with R2 for zero-egress-to-workers). Austin's existing Route 53 records need to be shadowed then cut over.

### Zones to add

| Zone             | Owner status                                                        |
| ---------------- | ------------------------------------------------------------------- |
| `polemicyst.com` | Registered; DNS on Route 53 today                                   |
| `clipfire.app`   | **Verify with Austin — does he own it?** If yes: add. If no: don't. |

### Records (per zone)

For `polemicyst.com`:

| Type  | Name             | Target                             | Proxied | Notes                           |
| ----- | ---------------- | ---------------------------------- | ------- | ------------------------------- |
| A     | `@`              | `76.76.21.21` (Vercel)             | No      | Vercel auto-provisions ACM cert |
| CNAME | `www`            | `cname.vercel-dns.com`             | No      | Vercel handles www redirect     |
| TXT   | `_vercel`        | (Vercel dashboard shows the value) | —       | Ownership proof                 |
| MX    | (existing)       | (unchanged)                        | —       | Preserve mail                   |
| TXT   | `@` (SPF, DMARC) | (unchanged)                        | —       | Preserve email deliverability   |

Cloudflare Proxy is **off** for the apex Vercel record — Vercel needs to see the real client IP for its own edge/CDN. Turning it on breaks Vercel Analytics + Incapsula-style protection loops.

### TLS

- Vercel auto-issues Let's Encrypt certs for verified domains — no action needed once DNS points at Vercel.
- Cloudflare zone's SSL/TLS mode should be **"Full"** (not Flexible; not Full-strict, since Vercel's cert is Let's Encrypt and Cloudflare will trust the chain).

### Cutover order (zero-user downtime is fine per pre-launch scope)

1. Add zones to Cloudflare; import existing records.
2. Update registrar (GoDaddy? Namecheap? — Austin check) to Cloudflare nameservers.
3. Once Cloudflare is authoritative, add the Vercel A/CNAME records.
4. Add the domain to the Vercel project; wait for the green "valid" state on the Domains panel.
5. Add MX/TXT-SPF/DMARC records back if the Cloudflare import missed any — verify email deliverability with a test send.

---

## Deploy pipeline

### Vercel (auto, no CI code)

- Push to `main` → Vercel deploys **production**.
- Open a PR against `main` → Vercel deploys a **preview** and comments with the URL.
- No GitHub Actions workflow needed; Vercel installs its own GitHub App at project connect time.

### Fly (GitHub Actions)

`.github/workflows/deploy-fly.yml` deploys the clip-worker (and, if manually triggered, the two dormant workers) on every push to `main` that touches worker code. Matrix job with per-worker `enabled` flag — the dormant workers skip by default unless the workflow is manually dispatched with `worker: provocativeness` or `worker: all`.

The workflow also runs `prisma migrate deploy` from the Actions runner using `NEON_DATABASE_URL_DIRECT` (Neon's non-pooled URL — Prisma migrations don't work through pgbouncer transaction pooling). Gate: only on `push` to `main`.

### GitHub secrets required

Set in the repo's **Settings → Secrets and variables → Actions**:

| Secret                     | Source                                                |
| -------------------------- | ----------------------------------------------------- |
| `FLY_API_TOKEN`            | `flyctl auth token` (personal, or a scoped org token) |
| `NEON_DATABASE_URL_DIRECT` | data-plane manifest — for the migrate job             |

The existing `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` secrets can be removed once the AWS deploy pipeline is torn down (out of scope for this doc — that's the AWS-teardown agent).

---

## Rollback

### Vercel

1. Vercel dashboard → Deployments → prior "Ready" deploy → three-dot menu → **Promote to Production**. Takes ~5 s.
2. Or via CLI: `vercel rollback <deployment-url>`.
3. Env var rollback is manual — Vercel doesn't version env vars. Keep a snapshot of the env panel in 1Password before cutover.

### Fly

```
flyctl releases --app polemicyst-clip-worker
flyctl releases rollback <version> --app polemicyst-clip-worker
```

Each `flyctl deploy` creates an immutable release. Rollbacks re-provision Machines from the prior image — takes 30-60 s.

### DNS

Cloudflare records are edit-in-place. To revert to AWS, edit the A/CNAME records back to the ALB DNS name. TTL is 300 s by default — plan for 5 min of DNS propagation.

---

## Observability tie-in (placeholder — owned by observability agent)

- **Vercel**: built-in Analytics + Logs. Sentry is already wired (`SENTRY_DSN` env var).
- **Fly**: `flyctl logs` + Fly's built-in Grafana. If the observability agent picks Sentry or Datadog, both accept env-var config from the secrets we already set.
- **PostHog** continues to work unchanged (public URL, works from any client).

The observability agent may want to add a `[metrics]` scrape endpoint on the Fly worker + a Grafana Cloud shipper. Compute-plane owns the `[metrics]` block in `fly/clip-worker/fly.toml` shape; owner agent fills in the exporter.

---

## Cost estimate

| Line item                                 | Before (AWS) | After (Vercel + Fly) |
| ----------------------------------------- | ------------ | -------------------- |
| Web (ECS prod + dev)                      | ~$15/mo      | Vercel Pro flat      |
| ALB                                       | ~$18/mo      | $0 (Vercel edge)     |
| NAT Gateway (shared, prorated to compute) | ~$16/mo      | $0                   |
| Clip worker (Fargate Spot)                | ~$8-12/mo    | Fly $5.70/mo (min=1) |
| Provocativeness (dormant)                 | $0           | $0 (stub, min=0)     |
| Comedic (dormant)                         | $0           | $0 (stub, min=0)     |
| Vercel Pro                                | —            | $20/mo               |
| Cloudflare DNS                            | ($6/yr R53)  | $0                   |
| **Total compute-plane subtotal**          | **~$57/mo**  | **~$26/mo**          |

Net savings: **~$31/mo** on compute alone, before data-plane savings. That's a lowball — the AWS number excludes ECR storage, CloudWatch logs, and NAT allocations that get released with the workers. Realistic delta is **$35-50/mo**.

Data-plane savings (Neon free tier vs RDS $30, R2 zero-egress vs S3 $variable) stack on top — see the data-plane agent's estimate.

---

## Signup checklist for Austin

- [ ] **Vercel** — create/log into account at https://vercel.com. Upgrade to **Pro ($20/mo)** — Hobby's 10 s function timeout blocks Gemini routes. Connect GitHub, import `austinconnor1836/polemicyst.com` repo, DON'T deploy yet — env vars land first.
- [ ] **Fly.io** — sign up at https://fly.io, add credit card. Run `flyctl auth signup` locally, then `flyctl apps create polemicyst-clip-worker --org personal`. Generate an API token: `flyctl auth token` → paste into GitHub Secret `FLY_API_TOKEN`.
- [ ] **Cloudflare** — sign up (Free plan is enough for DNS-only). Add `polemicyst.com` zone. Update registrar's nameservers to the two Cloudflare NS records the dashboard shows. **Do NOT delete Route 53 records yet** — leave them in place until Cloudflare is authoritative + verified.
- [ ] Update `clipfire.app` (if owned) at the registrar the same way — otherwise, skip.
- [ ] Rotate `NEXTAUTH_SECRET` (any 32-byte hex string) — every logged-in session gets invalidated at cutover, which is fine pre-launch.
- [ ] Re-issue Stripe webhook secrets for the new webhook URL: `https://polemicyst.com/api/stripe/webhook`.
- [ ] Update Google OAuth redirect URIs at https://console.cloud.google.com/apis/credentials — add `https://polemicyst.com/api/auth/callback/google` (and preview URLs use `*.vercel.app` — Google allows wildcard-ish patterns for dev, add `https://polemicyst.vercel.app/api/auth/callback/google` too).
- [ ] Update Apple Sign-In domain in the Apple Developer portal — add `polemicyst.com` if not already listed.

---

## Open questions

1. **Feed polling worker**: `workers/poller-worker/` polls YouTube + C-SPAN feeds every 60 s. On ECS this is a separate service (not in this scope's 5 services, but it exists). Two options: (a) run it as a fourth Fly Machine (`fly/poller/fly.toml`, min=1), (b) rewrite as a Vercel Cron job at `/api/poller/tick` running every minute. Vercel Pro allows unlimited crons at 1-min granularity — this is probably the cleaner path. **Not addressed in this PR**; flag for a follow-up.
2. **Root directory on Vercel**: `next.config.js` is at repo root, `src/` holds the App Router. Vercel's Next.js preset expects this shape natively — confirmed by inspecting the `next dev` script in `package.json`. If Vercel's autodetection fails, override root directory to `.` explicitly.
3. **Preview branch strategy**: `vercel.json`'s `git.deploymentEnabled` enables `main` only (trunk-based repo — `develop` was retired at v0.5.0). PRs against `main` get preview URLs automatically.
4. **Data-plane manifest**: `docs/migration/data-plane.md` doesn't exist yet. This runbook uses placeholder env-var names (`NEON_DATABASE_URL_POOLED`, `UPSTASH_REDIS_HOST`, `R2_BUCKET`, etc.) that match the _pattern_ the data-plane agent is expected to use. Once their manifest lands, do a find-replace pass through this doc's env-var table.
5. **Puppeteer on Vercel**: `/api/polemicyst-graphic/render` uses full Puppeteer. Needs the `@sparticuz/chromium` swap. Simple PR, but blocks any user-triggered graphic rendering post-cutover. Flag as required-before-launch in `TODO.md`.
6. **Instagram resolver**: relies on a persisted disk file. Same deferral — move to R2 before shipping IG imports.

---

## What this PR does NOT do

- No API calls to Vercel or Fly.io — design only.
- No AWS teardown — a separate teardown agent handles ECS/RDS/S3 sunset after we're happy on the new stack.
- No secrets committed — every real value lives in Vercel dashboard, Fly secrets, or GitHub secrets.
- No changes to the current AWS deploy pipeline — `deploy.yml` continues to work in parallel until cutover.
