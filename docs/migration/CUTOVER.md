# Clipfire Cutover Runbook

The single, ordered runbook for moving Clipfire off AWS onto the new stack.
Synthesizes:

- [`data-plane.md`](./data-plane.md) — Neon, R2, Upstash provisioning
- [`compute-plane.md`](./compute-plane.md) — Vercel, Fly.io, DNS
- [`llm-strategy.md`](./llm-strategy.md) — Groq / Gemini / DeepInfra fallback chain
- [`aws-teardown.md`](./aws-teardown.md) — sunset checklist (14 phases)
- [`README.md`](./README.md) + [`env-vars.md`](./env-vars.md) + [`clients.md`](./clients.md) + [`secrets-inventory.md`](./secrets-inventory.md) + [`observability.md`](./observability.md) — clients + observability + hardening + env-var manifest
- PR #333 — pre-cutover code fixes (Redis TLS+auth, Puppeteer→@sparticuz/chromium, IG session off local disk, BEAM_TOKEN audit)

If the sibling docs disagree, this runbook is the source of truth for _order_; the sibling doc is the source of truth for _what a step actually does_. Reconciliations are noted inline.

---

## Target state

**Runtime:** Vercel Pro (Next.js @ `iad1`) + Fly.io Machines (`iad`) + Neon Postgres 16 (`us-east-2`) + Cloudflare R2 (ENAM) + Upstash Redis (`us-east-1`) + Groq → Gemini → DeepInfra LLM chain. Zero AWS runtime. Cloudflare DNS.

**Estimated wall-clock:** ~5-7 hours across Phases 1-5 (Austin at the keyboard for signups + verification), plus a 7-day soak, plus ~2 hours for Phases 6-7 (AWS teardown + cost verification). Total elapsed from kick-off to zero AWS spend: **~9 days**.

**Estimated cost after:**

| Line                                    | Monthly           |
| --------------------------------------- | ----------------- |
| Vercel Pro                              | $20               |
| Fly.io `polemicyst-clip-worker` (min=1) | ~$5.70            |
| Neon Launch                             | $19               |
| Cloudflare R2 (~50 GB, no egress)       | ~$0.60            |
| Upstash Redis (pay-as-you-go)           | ~$0-0.30          |
| Cloudflare DNS                          | $0                |
| Groq / Gemini Lite / DeepInfra          | ~$0 pre-launch    |
| Sentry / Axiom / Better Stack / Grafana | $0 (all free tier)|
| **Total**                               | **~$46-58/mo**    |

vs. current AWS bill of ~$57/mo compute-plane subtotal alone (excluding RDS + NAT + S3 + CloudWatch). Realistic monthly savings: **$60-90/mo**.

---

## Reconciliations across the source docs

| Topic                          | env-vars.md (canonical)            | Other doc says                                        | Winner                                                                         |
| ------------------------------ | ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| Neon direct URL env-var name   | `DIRECT_DATABASE_URL`              | `compute-plane.md` uses `DIRECT_URL`                  | `DIRECT_DATABASE_URL` (matches `prisma/schema.prisma` `directUrl` binding).    |
| R2 credentials env-var names   | `AWS_ACCESS_KEY_ID`/`_SECRET_ACCESS_KEY` (reused)  | `data-plane.md` proposes `R2_ACCESS_KEY_ID`/`_SECRET_ACCESS_KEY`  | Reuse the `AWS_*` names — the S3 client resolves creds from `AWS_*` by convention; renaming would touch every S3 call site. |
| R2 S3 endpoint env-var         | `S3_ENDPOINT`                      | `compute-plane.md` uses `R2_S3_ENDPOINT` placeholder  | `S3_ENDPOINT` (matches `src/app/api/health/route.ts:process.env.S3_ENDPOINT`). |
| R2 bucket name                 | `clipfire-uploads`                 | Teardown README default: `clipfire-media`             | `clipfire-uploads` (data-plane.md is authoritative for provisioning).          |
| Fly clip-worker app name       | `polemicyst-clip-worker`           | Task prompt mentions `clipfire-clip-worker`           | `polemicyst-clip-worker` (matches `fly/clip-worker/fly.toml` `app = ...`).     |
| `LLM_PROVIDER_CHAIN` env-var   | Not in env-vars.md                 | `llm-strategy.md` introduces it                       | Add to Vercel + Fly during Phase 3; env-vars.md follow-up.                     |
| Redis auth                    | `REDIS_URL` (rediss://) OR host+port+password+TLS  | data-plane.md + PR #333 use host+port+password+TLS    | Split-fields (`REDIS_HOST`+`REDIS_PORT`+`REDIS_PASSWORD`+`REDIS_TLS=true`). Matches shipped `shared/queues.ts` shape from PR #333. |
| IG session state              | file on disk                       | PR #333 adds R2 + Neon KV fallback                    | R2 primary → Neon KV → local disk (dev only). PR #333 must be merged first.   |
| Puppeteer on Vercel           | `PUPPETEER_EXECUTABLE_PATH`        | PR #333 adds `@sparticuz/chromium` under `VERCEL='1'` | PR #333 approach (dynamic-import, no bloat on Fly/local).                     |

---

## Prerequisites — one-time signups Austin does BEFORE any cutover step

Everything below is a browser click-through by Austin. Nothing here executes any migration — it just gets the accounts + credentials into 1Password so the cutover steps have values to paste. Do these in order; some later signups depend on earlier ones (Cloudflare zone must exist before R2 bucket lifecycle rules; Neon project must exist before Vercel env vars).

Estimated total: **~90 minutes**.

### Cloudflare (DNS + R2 + zone)

- [ ] **1a.** Sign up / log in at <https://dash.cloudflare.com/sign-up>. Free plan is enough.
- [ ] **1b.** Add the `polemicyst.com` zone (DNS-only, **do NOT change the registrar's nameservers yet** — that happens in Phase 2). Import existing Route 53 records via the "Copy from" wizard OR re-key them by hand:
  - MX, SPF TXT, DMARC TXT — copy exactly (preserves email deliverability).
  - Any current `A @` / `CNAME www` records — copy but don't cut over; they'll be replaced in Phase 2.
- [ ] **1c.** (Optional) If `clipfire.app` is owned, repeat 1b for that zone. Skip if not owned. See `compute-plane.md` §DNS zones.
- [ ] **1d.** R2 → **Create bucket** `clipfire-uploads`, location `Eastern North America (ENAM)`. See `data-plane.md` §Signup checklist step 5.
- [ ] **1e.** R2 → Bucket → Settings → **Versioning: on**. Recovery from accidental delete.
- [ ] **1f.** R2 → **Manage R2 API Tokens → Create API token**, scope `Object Read & Write` on `clipfire-uploads` bucket only. **Record**: `Access Key ID`, `Secret Access Key`, `Endpoint URL` (looks like `https://<accountId>.r2.cloudflarestorage.com`).
- [ ] **1g.** Note the **account ID** (bottom-right of any Cloudflare dash page). **Record**: `R2_ACCOUNT_ID`.
- [ ] **1h.** R2 → Bucket → **Settings → Public access → allow** (only if you want `pub-<hash>.r2.dev` playback URLs day one; otherwise stay presigned). Current server code uses presigned URLs — this is opt-in.
  - If yes: record the `NEXT_PUBLIC_R2_CDN_HOST` = `pub-<hash>.r2.dev`.
  - If deferred: leave off; use presigned URLs for now, add custom domain (`cdn.polemicyst.com`) later.

Values to paste later: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `S3_ENDPOINT`, `S3_BUCKET=clipfire-uploads`, `S3_REGION=auto`, optional `NEXT_PUBLIC_R2_CDN_HOST`.

### Neon (Postgres)

- [ ] **2a.** Sign up at <https://console.neon.tech/signup>.
- [ ] **2b.** Create project `clipfire`, region `us-east-2` (matches current RDS + Vercel `iad1`). Postgres **16**. See `data-plane.md` §Neon signup steps 1-3.
- [ ] **2c.** Upgrade to **Launch tier ($19/mo)**. Free tier's 0.5 GB will not fit the first backfill.
- [ ] **2d.** Copy **Pooled** connection string → `DATABASE_URL`. Ends with `-pooler.<region>.aws.neon.tech/...` and `?pgbouncer=true&sslmode=require`.
- [ ] **2e.** Toggle "Pooler" off → copy **Direct** connection string → `DIRECT_DATABASE_URL`. No `-pooler`, no `pgbouncer=true`. Needed for `prisma migrate` (advisory locks don't work through pgbouncer transaction pooling).
- [ ] **2f.** Verify **PITR = 7 days** on Launch tier (default). Settings → Backups.

Values to paste later: `DATABASE_URL`, `DIRECT_DATABASE_URL`.

### Upstash (Redis)

- [ ] **3a.** Sign up at <https://console.upstash.com/redis>.
- [ ] **3b.** Create Redis database, type **Global**, primary region `us-east-1` (matches Vercel + Fly `iad`).
- [ ] **3c.** From the DB Details page → **Endpoint** tab → note the TLS TCP endpoint: `<slug>.upstash.io:6379` + password.
- [ ] **3d.** Same page → **REST API** tab → note `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (separate from the TCP creds; used by `src/lib/rate-limit.ts`).

Values to paste later: `REDIS_HOST=<slug>.upstash.io`, `REDIS_PORT=6379`, `REDIS_PASSWORD=<pwd>`, `REDIS_TLS=true`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`. See `data-plane.md` §Signup checklist steps 9-11.

### Vercel (Next.js web)

- [ ] **4a.** Sign up / log in at <https://vercel.com>. **Upgrade to Pro ($20/mo)** — Hobby's 10 s function timeout will 504 the Gemini + Puppeteer routes. See `compute-plane.md` §Vercel Project Configuration.
- [ ] **4b.** New Project → Import Git Repository → `austinconnor1836/polemicyst.com`. **Do NOT deploy yet** — env vars land first (Phase 1 step 1.1).
- [ ] **4c.** Project Settings → General → **Root Directory:** `.` (default). Framework preset: Next.js (auto-detected).
- [ ] **4d.** Project Settings → General → **Function Region:** `iad1` (Washington DC — must match Neon `us-east-2` for latency). Not the default; change explicitly.
- [ ] **4e.** Project Settings → Git → **Production Branch:** `main`. `develop` was retired at v0.5.0 (per repo CLAUDE.md); trunk-based.
- [ ] **4f.** Verify install command: `npm ci`. Build command: `npx prisma generate && next build`. Both should auto-populate from `package.json` scripts and `vercel.json`.

### Fly.io (workers)

- [ ] **5a.** Sign up at <https://fly.io/app/sign-up> + add a credit card (required even for the hobby tier).
- [ ] **5b.** Install / update `flyctl` locally: `curl -L https://fly.io/install.sh | sh`.
- [ ] **5c.** `flyctl auth login` — opens browser, log in.
- [ ] **5d.** Create the three apps (two are stubs — no deploy yet, just reserved names):

  ```bash
  flyctl apps create polemicyst-clip-worker --org personal
  flyctl apps create polemicyst-provocativeness --org personal
  flyctl apps create polemicyst-comedic --org personal
  ```
- [ ] **5e.** Generate a personal API token for CI: `flyctl auth token`. Copy the value.

Values to paste later: `FLY_API_TOKEN` → GitHub repo Actions secret.

### Groq (primary LLM)

- [ ] **6a.** Sign up at <https://console.groq.com>. Free tier is enough pre-launch.
- [ ] **6b.** API Keys → Create Key. Copy the value.

Values to paste later: `GROQ_API_KEY` → Vercel + Fly. See `llm-strategy.md` §Signup checklist.

### DeepInfra (tertiary LLM fallback)

- [ ] **7a.** Sign up at <https://deepinfra.com>.
- [ ] **7b.** Prepay $10 (unlocks higher rate limits above the default).
- [ ] **7c.** Copy API key.

Values to paste later: `DEEPINFRA_API_KEY` → Vercel + Fly. Gemini is already set (`GOOGLE_API_KEY` exists in prod today — no action needed).

### Sentry (errors)

- [ ] **8a.** Sign up at <https://sentry.io/signup/> — Developer plan (free, 5k errors/mo).
- [ ] **8b.** Create org `polemicyst`. Create project `clipfire-web` (Next.js platform). Create project `clipfire-workers` (Node platform).
- [ ] **8c.** Copy web project's DSN → `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` for Vercel.
- [ ] **8d.** Copy workers project's DSN → `SENTRY_DSN` for Fly `polemicyst-clip-worker`.
- [ ] **8e.** Settings → Auth Tokens → new token, scope `project:releases`. Copy → `SENTRY_AUTH_TOKEN` for GitHub Actions.

Values to paste later: `SENTRY_DSN` (both), `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG=polemicyst`, `SENTRY_PROJECT=clipfire-web`, `SENTRY_AUTH_TOKEN`. See `observability.md` §Signup checklist.

### Axiom (logs)

- [ ] **9a.** Sign up at <https://app.axiom.co/register> — Personal plan (free, 500 GB/mo, 30-day retention, no credit card).
- [ ] **9b.** Create dataset `clipfire-prod`.
- [ ] **9c.** Settings → API Tokens → new ingest-only token. Copy value.

Values to paste later: `AXIOM_TOKEN`, `AXIOM_DATASET=clipfire-prod` → Fly `polemicyst-clip-worker`. Wire Vercel Log Drain in Phase 5.

### Better Stack (uptime)

- [ ] **10a.** Sign up at <https://betterstack.com> — Uptime free tier (10 monitors, 30 s intervals).
- [ ] **10b.** No values to copy — the monitors are created in Phase 5, after the new stack is live.

### Grafana Cloud (metrics)

- [ ] **11a.** Sign up at <https://grafana.com/products/cloud/> — free tier (10k active series, 50 GB logs/traces).
- [ ] **11b.** Create stack `polemicyst`. Copy the Prometheus **remote-write** endpoint + a token from the stack settings.

Values to paste later: wired in Phase 5.

### OAuth registrar updates (Austin-only, done in existing consoles)

- [ ] **12a.** Google Cloud Console → APIs & Services → Credentials → OAuth Client → add redirect URI `https://polemicyst.com/api/auth/callback/google` and `https://polemicyst.vercel.app/api/auth/callback/google` (preview alias). See `compute-plane.md` §Signup checklist.
- [ ] **12b.** Apple Developer portal → Certificates, Identifiers & Profiles → App ID → Sign in with Apple → verify `polemicyst.com` is listed. Add if missing.
- [ ] **12c.** Stripe Dashboard → Developers → Webhooks → the current endpoint. Reveal the signing secret. Post-cutover in Phase 2, add a NEW endpoint at `https://polemicyst.com/api/stripe/webhook`, revoke the old ECS-hosted one.
- [ ] **12d.** Generate a fresh `NEXTAUTH_SECRET`: `openssl rand -base64 32`. Every logged-in session invalidates at cutover — expected pre-launch.

### GitHub Actions repo secrets (Austin sets in the GitHub UI)

Set in `austinconnor1836/polemicyst.com` → **Settings → Secrets and variables → Actions**:

- [ ] **13a.** `FLY_API_TOKEN` — from step 5e.
- [ ] **13b.** `NEON_DATABASE_URL_DIRECT` — from step 2e (used by the deploy-fly.yml migrate job; separate from `DIRECT_DATABASE_URL` in Vercel/Fly secrets).
- [ ] **13c.** `SENTRY_AUTH_TOKEN` — from step 8e.
- [ ] **13d.** `SENTRY_ORG=polemicyst`, `SENTRY_PROJECT=clipfire-web`.

Full secret catalog: `secrets-inventory.md`.

---

## Cutover Sequence

Execute in order. Each phase has a preflight, each step has a command + a verify. Do not proceed past a failed verify.

Phases 1-5 land the new stack. Phase 6 tears down AWS **only after** a 7-day soak. Phase 7 confirms the AWS bill actually goes to zero.

### Phase 0 — Merge the migration PRs to main (est 15 min)

The migration PRs (`#327` data-plane, `#328` compute-plane, `#329` llm-strategy, `#330` aws-teardown, `#331` clients-observability, `#333` pre-cutover-fixes) must land on `main` in this order — PR #333 has code changes the other PRs depend on (Redis TLS+auth, Puppeteer/Vercel, IG session store). Vercel does NOT auto-deploy yet (no project connected).

- [ ] **0.1** Merge PR #333 (`migrate/pre-cutover-fixes`).
  Command: `gh pr merge 333 --squash --admin`
  Verify: `gh pr view 333 --json state,mergedAt` shows `MERGED`.
- [ ] **0.2** Merge PR #327 (`migrate/data-plane`) — adds R2 adapter, migration scripts, `directUrl` in `prisma/schema.prisma`.
  Command: `gh pr merge 327 --squash --admin`
  Verify: `gh pr view 327 --json state` shows `MERGED`.
- [ ] **0.3** Merge PR #329 (`migrate/llm-strategy`) — adds `shared/lib/llm/` provider chain.
  Command: `gh pr merge 329 --squash --admin`
  Verify: `gh pr view 329 --json state` shows `MERGED`.
- [ ] **0.4** Merge PR #328 (`migrate/compute-plane`) — adds `vercel.json`, `fly/*/fly.toml`, `.github/workflows/deploy-fly.yml`.
  Command: `gh pr merge 328 --squash --admin`
  Verify: `gh pr view 328 --json state` shows `MERGED`. `test -f fly/clip-worker/fly.toml` on a fresh `git pull`.
- [ ] **0.5** Merge PR #331 (`migrate/clients-observability`) — adds `docs/migration/README.md`, env-vars, secrets-inventory, observability, CI hardening, `backend/lib/sentry.ts`, `src/app/api/health/route.ts`.
  Command: `gh pr merge 331 --squash --admin`
  Verify: `curl -s https://raw.githubusercontent.com/austinconnor1836/polemicyst.com/main/docs/migration/env-vars.md | head -1` returns the doc title.
- [ ] **0.6** Merge PR #330 (`migrate/aws-teardown`) — adds `scripts/aws-teardown/*` (used in Phase 6).
  Command: `gh pr merge 330 --squash --admin`
  Verify: `test -x scripts/aws-teardown/preflight.sh` locally.

**Note:** the existing AWS deploy pipeline (`.github/workflows/deploy.yml`) keeps working through this whole runbook. It does NOT get touched until Phase 6.4 (aws-teardown Phase 2 deletes ECS services). Keep it running as a fallback until DNS flips.

---

### Phase 1 — Data plane (est 60 min)

Provisions Neon + R2 + Upstash values into Vercel + Fly. Bulk-copies data from AWS. All AWS resources remain live.

**Preflight:** All Prerequisites (steps 1-13 above) complete. `.env` file locally has every value from those signups so scripts can source it.

- [ ] **1.1** Set core-infra env vars in Vercel (Prod + Preview scopes).
  Command: use Vercel dashboard → Project → Settings → Environment Variables. For each of the following, set for both **Production** and **Preview**:

  | Var                        | Value                                                         |
  | -------------------------- | ------------------------------------------------------------- |
  | `DATABASE_URL`             | Neon pooled URL (step 2d)                                     |
  | `DIRECT_DATABASE_URL`      | Neon direct URL (step 2e)                                     |
  | `REDIS_HOST`               | `<slug>.upstash.io` (step 3c)                                 |
  | `REDIS_PORT`               | `6379`                                                        |
  | `REDIS_PASSWORD`           | Upstash password (step 3c)                                    |
  | `REDIS_TLS`                | `true`                                                        |
  | `UPSTASH_REDIS_REST_URL`   | step 3d                                                       |
  | `UPSTASH_REDIS_REST_TOKEN` | step 3d                                                       |
  | `S3_BUCKET`                | `clipfire-uploads`                                            |
  | `S3_REGION`                | `auto`                                                        |
  | `S3_ENDPOINT`              | `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` (step 1f) |
  | `AWS_ACCESS_KEY_ID`        | R2 access key (step 1f)                                       |
  | `AWS_SECRET_ACCESS_KEY`    | R2 secret (step 1f)                                           |
  | `AWS_REGION`               | `auto`                                                        |
  | `STORAGE_PROVIDER`         | `r2`                                                          |

  Verify: `vercel env ls` shows all 15 vars in both scopes.

- [ ] **1.2** Set core-infra env vars in Fly `polemicyst-clip-worker`.
  Command:
  ```bash
  flyctl secrets set --app polemicyst-clip-worker \
    DATABASE_URL="<neon-pooled>" \
    DIRECT_DATABASE_URL="<neon-direct>" \
    REDIS_HOST="<slug>.upstash.io" \
    REDIS_PORT=6379 \
    REDIS_PASSWORD="<upstash-pwd>" \
    REDIS_TLS=true \
    S3_BUCKET=clipfire-uploads \
    S3_REGION=auto \
    S3_ENDPOINT="https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com" \
    AWS_ACCESS_KEY_ID="<r2-key>" \
    AWS_SECRET_ACCESS_KEY="<r2-secret>" \
    AWS_REGION=auto \
    STORAGE_PROVIDER=r2
  ```
  Verify: `flyctl secrets list --app polemicyst-clip-worker` shows all 13 names (values hidden).

- [ ] **1.3** Prisma migration probe against Neon (uses direct URL — pgbouncer breaks advisory locks).
  Command: `DATABASE_URL="<neon-direct>" npx prisma migrate deploy`
  Verify: last line prints `X migrations applied` (X = current migration count in `prisma/migrations/`). No errors.

- [ ] **1.4** Run the RDS → Neon pg_dump/pg_restore.
  Command:
  ```bash
  brew install postgresql@16 && export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
  RDS_URL="<current-RDS-prod-URL>" NEON_URL="<neon-direct-URL>" \
    bash scripts/migrate-rds-to-neon.sh
  ```
  Verify: script prints `Restore complete.` Then: `psql "<neon-direct>" -c 'SELECT count(*) FROM "User"; SELECT count(*) FROM "Video"; SELECT count(*) FROM "Clip";'` — all three counts must match RDS pre-migration counts. See `data-plane.md` §Migration order step 3.

- [ ] **1.5** Bulk-copy S3 → R2 (resumable).
  Command:
  ```bash
  AWS_ACCESS_KEY_ID="<AWS-prod-key>" AWS_SECRET_ACCESS_KEY="<AWS-prod-secret>" \
  R2_ACCOUNT_ID="<r2-account>" R2_ACCESS_KEY_ID="<r2-key>" R2_SECRET_ACCESS_KEY="<r2-secret>" \
    npx tsx scripts/migrate-s3-to-r2.ts \
      --src-bucket polemicyst-uploads-prod \
      --src-region us-east-1 \
      --dst-bucket clipfire-uploads \
      --manifest ./tmp/migrate-s3-to-r2.manifest.json
  ```
  Verify: final line prints `Copied N of N objects (0 skipped, 0 failed)`. Re-run the same command — should immediately print `N of N complete (from manifest), 0 to copy`.

- [ ] **1.6** Verify Neon pool health from the runtime path (BullMQ workers rely on this).
  Command: `psql "<neon-pooled>" -c 'SELECT 1'`
  Verify: returns `1`. Same for direct URL: `psql "<neon-direct>" -c 'SELECT 1'`.

- [ ] **1.7** Verify Upstash Redis accepts a BullMQ-style TCP connect.
  Command:
  ```bash
  node -e "const IORedis = require('ioredis'); const r = new IORedis({host: process.env.REDIS_HOST, port: 6379, password: process.env.REDIS_PASSWORD, tls: {}}); r.ping().then(x => { console.log(x); r.quit(); });"
  ```
  Verify: prints `PONG`.

- [ ] **1.8** Verify R2 with a HeadBucket probe.
  Command:
  ```bash
  AWS_ACCESS_KEY_ID="<r2-key>" AWS_SECRET_ACCESS_KEY="<r2-secret>" AWS_REGION=auto \
    aws s3api head-bucket --bucket clipfire-uploads --endpoint-url "$S3_ENDPOINT"
  ```
  Verify: exit 0 (no output on success).

---

### Phase 2 — Compute plane (est 90 min)

Deploy Vercel prod + Fly clip-worker + flip DNS.

**Preflight:** Phase 1 complete + verified. Neon has row-parity with RDS. R2 has object-parity with S3 (re-run `migrate-s3-to-r2.ts` shows 0 to copy).

- [ ] **2.1** Set the remaining Vercel env vars (auth, Stripe, LLM, observability, admin).
  Command: paste from `env-vars.md` §Auth / §Billing / §LLM providers / §Third-party integrations / §Observability. All secrets from Prerequisites step 12.
  Values to set (Prod + Preview):
  ```
  NEXTAUTH_URL=https://polemicyst.com  (Preview: leave unset — Vercel injects VERCEL_URL)
  NEXTAUTH_SECRET=<new 32-byte from step 12d>
  AUTH_SECRET=<same as NEXTAUTH_SECRET>
  GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_IOS_CLIENT_ID / APPLE_CLIENT_ID  (existing values)
  AUTH_ALLOWLIST_ENABLED=true  (Prod only, App Store review lockdown)
  AUTH_ALLOWED_EMAILS=<current list>
  AUTH_ALLOWED_PROVIDERS=google,apple
  ADMIN_EMAIL=aconnor731@gmail.com
  NEXT_PUBLIC_ADMIN_EMAIL=aconnor731@gmail.com
  STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET (existing live for Prod, test for Preview)
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  STRIPE_CREATOR_MONTHLY_PRICE_ID / STRIPE_CREATOR_ANNUAL_PRICE_ID / STRIPE_PRO_MONTHLY_PRICE_ID / STRIPE_PRO_ANNUAL_PRICE_ID / STRIPE_AGENCY_MONTHLY_PRICE_ID / STRIPE_AGENCY_ANNUAL_PRICE_ID
  LLM_PROVIDER=gemini  (keep for backwards-compat; new chain reads LLM_PROVIDER_CHAIN below)
  LLM_PROVIDER_CHAIN=groq,gemini,deepinfra  (Phase 3 activates)
  GROQ_API_KEY=<step 6b>
  GEMINI_MODEL=gemini-2.5-flash-lite
  GOOGLE_API_KEY=<existing>
  DEEPINFRA_API_KEY=<step 7c>
  DEEPINFRA_MODEL=meta-llama/Llama-3.3-70B-Instruct-Turbo
  ANTHROPIC_API_KEY / OPENAI_API_KEY  (existing, if used)
  TWITTER_CONSUMER_KEY / TWITTER_CONSUMER_SECRET / EMAIL_USER / EMAIL_PASS  (existing)
  SENTRY_DSN=<step 8c web DSN>
  NEXT_PUBLIC_SENTRY_DSN=<same>
  SENTRY_ENVIRONMENT=production  (Preview: preview)
  NEXT_PUBLIC_POSTHOG_KEY / NEXT_PUBLIC_POSTHOG_HOST / POSTHOG_API_KEY / POSTHOG_HOST  (existing)
  NEXT_PUBLIC_BEAM_TOKEN=<existing>  (public token per PR #333 audit — no rotation needed)
  MIN_APP_VERSION_IOS / MIN_APP_VERSION_ANDROID  (existing)
  IG_SESSION_R2_BUCKET=clipfire-uploads  (PR #333 — IG session state lives in R2 now)
  SESSION_ENCRYPTION_KEY=<openssl rand -hex 32>  (optional, encrypts IG state at rest)
  ```
  Verify: `vercel env ls | wc -l` shows ~50 vars per scope.

- [ ] **2.2** Set the remaining Fly `polemicyst-clip-worker` env vars.
  Command:
  ```bash
  flyctl secrets set --app polemicyst-clip-worker \
    NEXTAUTH_SECRET="<same as Vercel>" \
    GOOGLE_API_KEY="<existing>" \
    LLM_PROVIDER=gemini \
    LLM_PROVIDER_CHAIN=groq,gemini,deepinfra \
    GROQ_API_KEY="<step 6b>" \
    GEMINI_MODEL=gemini-2.5-flash-lite \
    DEEPINFRA_API_KEY="<step 7c>" \
    DEEPINFRA_MODEL=meta-llama/Llama-3.3-70B-Instruct-Turbo \
    OPENAI_API_KEY="<existing>" \
    ANTHROPIC_API_KEY="<existing>" \
    SENTRY_DSN="<step 8d workers DSN>" \
    SENTRY_ENVIRONMENT=production \
    AXIOM_TOKEN="<step 9c>" \
    AXIOM_DATASET=clipfire-prod \
    POSTHOG_API_KEY="<existing>" \
    IG_SESSION_R2_BUCKET=clipfire-uploads \
    SESSION_ENCRYPTION_KEY="<same as Vercel>" \
    NODE_ENV=production \
    HTTP_PORT=3001
  ```
  Verify: `flyctl secrets list --app polemicyst-clip-worker` shows ~30 total names.

- [ ] **2.3** Deploy Vercel production (initial deploy).
  Command: from the repo root, `vercel --prod` (or push to `main`; the Git integration deploys automatically once the project is connected). Vercel runs `npx prisma generate && next build` on its own build image.
  Verify: `vercel ls --scope <team>` shows the newest deployment status = `Ready`. Direct URL check: `curl -sS -I https://<project>.vercel.app | head -1` returns `HTTP/2 200`.

- [ ] **2.4** Deploy Fly `polemicyst-clip-worker`.
  Command: `flyctl deploy --config fly/clip-worker/fly.toml`
  Verify: `flyctl status --app polemicyst-clip-worker` shows one running machine, health check `passing`. `flyctl logs --app polemicyst-clip-worker | head -50` shows BullMQ consumer registering with Upstash (`Worker <name> started`).

- [ ] **2.5** Probe the app-level health endpoint on Vercel (not yet on the apex domain).
  Command: `curl -sS https://<project>.vercel.app/api/health | jq .`
  Verify: response has `"status":"ok"` and all sub-checks (`db`, `redis`, `s3`) = `"ok"`. See `src/app/api/health/route.ts` — the S3 check reads `S3_ENDPOINT` and probes R2 via `HeadBucketCommand`.

- [ ] **2.6** Probe Fly worker healthz.
  Command: `curl -sS https://polemicyst-clip-worker.fly.dev/healthz`
  Verify: HTTP 200. If 404: the clip-worker exposes `/health` (not `/healthz`) per `compute-plane.md` §Health checks — try `/health`. Reconcile the observability signup checklist accordingly.

- [ ] **2.7** Update the registrar's nameservers to Cloudflare.
  Command: go to the domain registrar (GoDaddy / Namecheap / wherever `polemicyst.com` is registered) → change nameservers to the two Cloudflare NS records shown in the Cloudflare zone dashboard.
  Verify: `dig +short NS polemicyst.com @8.8.8.8` returns nameservers ending in `.ns.cloudflare.com`. Propagation can take up to 24 h but usually resolves in minutes.

- [ ] **2.8** In Cloudflare DNS, add the Vercel records.
  Command: Cloudflare dashboard → `polemicyst.com` → DNS → Records. Add:
  - `A @ 76.76.21.21` — Proxied: OFF (Vercel needs the real client IP)
  - `CNAME www cname.vercel-dns.com` — Proxied: OFF
  - `TXT _vercel <value from Vercel Domains tab>` — for ownership verification.
  Preserve existing MX + SPF + DMARC TXT records. See `compute-plane.md` §DNS records.
  Verify: `dig +short A polemicyst.com @8.8.8.8` returns `76.76.21.21`. `dig +short TXT _vercel.polemicyst.com` returns the expected value.

- [ ] **2.9** Add domain to Vercel project → wait for Vercel to issue Let's Encrypt cert.
  Command: Vercel Project → Domains → Add → `polemicyst.com` + `www.polemicyst.com`.
  Verify: Vercel shows both domains as "Valid Configuration". `curl -sS -I https://polemicyst.com/api/health` returns HTTP 200 with a valid Let's Encrypt cert (`openssl s_client -connect polemicyst.com:443 -servername polemicyst.com </dev/null 2>/dev/null | openssl x509 -noout -issuer`). Cloudflare zone SSL/TLS mode: **Full** (Overview → SSL/TLS → Overview panel).

- [ ] **2.10** Verify `/api/health` on the apex domain.
  Command: `curl -sS https://polemicyst.com/api/health | jq .`
  Verify: `status:"ok"`, all sub-checks `ok`. Response includes `version` field (git SHA from `VERCEL_GIT_COMMIT_SHA`).

- [ ] **2.11** Repoint Stripe webhook to the new URL.
  Command: Stripe Dashboard → Developers → Webhooks → the current endpoint. Change URL to `https://polemicyst.com/api/stripe/webhook`. Copy the (unchanged) signing secret if you kept the same endpoint; if you created a new endpoint, copy the new secret → update `STRIPE_WEBHOOK_SECRET` in Vercel Production.
  Verify: Stripe → Webhooks → the endpoint → "Send test webhook" → success 200 within 3 s.

- [ ] **2.12** Verify Android assetlinks.json still 200 from Vercel.
  Command: `curl -sSL https://polemicyst.com/.well-known/assetlinks.json | jq '.[0].target.package_name'`
  Verify: returns `"com.polemicyst.android"`. See `clients.md` §Android action items.

---

### Phase 3 — LLM cutover (est 20 min)

New chain is already in envs (Phase 2 steps 2.1/2.2) but call sites still hit Ollama directly. Flip the flag; the unified `shared/lib/llm` router activates.

**Preflight:** Phase 2 complete. All three provider keys reachable from the runtime.

- [ ] **3.1** Set `LLM_UNIFIED_CHAIN=true` on both Vercel and Fly.
  Command:
  ```bash
  vercel env add LLM_UNIFIED_CHAIN production   # then answer: true
  vercel env add LLM_UNIFIED_CHAIN preview      # then answer: true
  flyctl secrets set --app polemicyst-clip-worker LLM_UNIFIED_CHAIN=true
  ```
  Verify: `vercel env ls | grep LLM_UNIFIED_CHAIN`, `flyctl secrets list --app polemicyst-clip-worker | grep LLM_UNIFIED_CHAIN`.

- [ ] **3.2** Trigger a redeploy so the new secret is picked up.
  Command: `vercel --prod` + `flyctl deploy --config fly/clip-worker/fly.toml`
  Verify: `curl -sS https://polemicyst.com/api/health` still 200.

- [ ] **3.3** Fire a text-only LLM call end-to-end (a `truth-analysis` or `generate-metadata` request) and confirm the chain hits Groq first.
  Command: hit the endpoint from `curl` (auth required — use a test user from `AUTH_ALLOWED_EMAILS`). Alternatively, tail `flyctl logs --app polemicyst-clip-worker` and trigger a queued job.
  Verify: Sentry breadcrumbs / worker logs show `LLM: provider=groq model=llama-3.1-8b-instant` (or the fallback message if Groq is rate-limited). Cost accounting shows `usage.estimatedCostUsd` populated. See `llm-strategy.md` §Fallback chain.

- [ ] **3.4** Confirm Ollama is unused post-flip.
  Command: `flyctl logs --app polemicyst-clip-worker | grep -c 'ollama' | tail -1`
  Verify: `0` new occurrences during a 5-min sample window (log entries older than the flip are fine).

---

### Phase 4 — Full user-flow smoke test (est 45 min)

End-to-end from the same iOS build users will run.

**Preflight:** Phases 2-3 complete. DNS propagated (dig from a fresh network returns Vercel IPs).

- [ ] **4.1** Auth: sign up as a fresh user via iOS.
  Command: Xcode → run Debug build on paired iPhone → complete Sign in with Google (or Apple) using an email on `AUTH_ALLOWED_EMAILS`.
  Verify: iOS lands on the authenticated home screen. Vercel logs show `POST /api/auth/mobile/google 200`. Prisma `User` row created (verify in Neon: `SELECT id, email, createdAt FROM "User" ORDER BY createdAt DESC LIMIT 1`).

- [ ] **4.2** Upload: pick or paste a YouTube URL, kick a transcript.
  Command: in iOS, Upload → paste `https://www.youtube.com/watch?v=<short-video>` → confirm.
  Verify: iOS transitions to the "Transcribing…" state. Fly worker logs (`flyctl logs --app polemicyst-clip-worker`) show BullMQ job pickup + Whisper progress.

- [ ] **4.3** Transcribe: wait for completion.
  Verify: iOS surfaces the transcript. Neon `FeedVideo` + `Transcript` rows populated. Vercel logs show the `POST /api/feedVideos/<id>/transcribe` returned 200 (or 202 async).

- [ ] **4.4** Clip: fire the auto-clipping flow.
  Command: from iOS's clip-generation UI, tap Generate.
  Verify: Fly worker logs show `clip-generation` job dequeued + FFmpeg output. Neon `Clip` rows populated. R2 receives the clip mp4 objects (`aws s3 ls s3://clipfire-uploads/clips/ --endpoint-url $S3_ENDPOINT` shows the new keys).

- [ ] **4.5** Play: tap a clip in the app.
  Verify: `AVPlayer` streams from the R2-served URL. Video plays, no CORS errors in Vercel logs. `curl -I` the same URL returns HTTP 206 with `Content-Range` (presigned URL, R2 supports Range).

- [ ] **4.6** Export: fire a share/export.
  Verify: iOS Share sheet appears. On desktop-web, hitting `/api/clips/<id>/export` returns the same R2 URL with a presigned query.

- [ ] **4.7** Rate limit sanity (fail-open contract from `README.md`).
  Command: rapid-fire 50 requests to `/api/auth/mobile/google` from `curl` (deliberately trip the 10/min rate limit).
  Verify: some responses are HTTP 429 with `Retry-After` header + `{ error: 'rate_limited', retryAfterSeconds }` body. Then kill Upstash (Upstash dashboard → pause DB, or simulate by setting a bad password on `REDIS_PASSWORD` briefly) and verify the same route still returns 200 (fail-open) with a Sentry error logged. **Undo the sabotage after** the check.

---

### Phase 5 — Observability wired + 7-day soak (est 60 min setup + 7 days elapsed)

**Preflight:** Phase 4 green. iOS-observed pipeline is working through Vercel + Fly + Neon + R2 + Upstash.

- [ ] **5.1** Wire Vercel Log Drain → Axiom.
  Command: Vercel → Dashboard → Integrations → Log Drains → Axiom (or manual: `AXIOM_TOKEN` + dataset `clipfire-prod`).
  Verify: after 5 min, Axiom's `clipfire-prod` dataset shows Vercel log rows. Filter `service:vercel` and confirm.

- [ ] **5.2** Verify Fly → Axiom log shipping.
  Command: Fly has first-class Axiom integration via `flyctl logs ship`. Alternative: `axiom-cloud` vector on each machine.
  Verify: Axiom dataset shows both `service:vercel` AND `app:polemicyst-clip-worker` rows.

- [ ] **5.3** Create the 6 Better Stack uptime monitors.
  Command: Better Stack dashboard → Monitors → New. Create the six checks from `observability.md` §Better Stack:
  1. `GET https://polemicyst.com/api/health` — expect 200, body contains `"status":"ok"`, 30 s interval.
  2. `GET https://polemicyst.com` — expect 200, 30 s.
  3. `GET https://polemicyst-clip-worker.fly.dev/healthz` — expect 200, 30 s. (Or `/health` — see 2.6 reconciliation.)
  4. `GET https://polemicyst.com/.well-known/assetlinks.json` — expect 200, JSON body, 30 s.
  5. TCP `polemicyst.com:443` — port-open ping, 30 s.
  6. (Optional) `GET https://polemicyst.com/api/health?test=sentry` — synthetic Sentry error probe.

  Alert routing: email `aconnor731@gmail.com`. Save.
  Verify: all six monitors show "Up" (green) within 2 min.

- [ ] **5.4** Sentry test-error probe.
  Command: `curl -sS 'https://polemicyst.com/api/health?test=sentry'`
  Verify: Sentry `clipfire-web` project → Issues shows a new synthetic error within 30 s.

- [ ] **5.5** Grafana Cloud metrics wiring.
  Command: Grafana Cloud stack → Integrations → Vercel (built-in) + Fly (Prometheus remote-write; get the endpoint from the stack settings, set `PROMETHEUS_REMOTE_WRITE_URL` as a Fly secret).
  Verify: Grafana → Explore → data source `Metrics` → query `up{job=~"vercel|fly"}` returns non-empty in the last 5 min.

- [ ] **5.6** Wire the weekly `pg_dump → R2` backup cron.
  Command: `scripts/backup-neon-to-r2.ts` (from PR #331). Add to `.github/workflows/backup.yml` on a `cron: '0 5 * * 0'` schedule (Sunday 05:00 UTC).
  Verify: manually dispatch the workflow, check R2 `clipfire-backups/` (or same bucket, prefixed) for the `.pgcustom` file.

- [ ] **5.7** Enable Neon → PR preview branching via CI.
  Command: Add [`neondatabase/create-branch-action`](https://github.com/neondatabase/create-branch-action) to a new `.github/workflows/preview.yml` (per README.md §Backup strategy — data-plane owns).
  Verify: open a throwaway PR against `main`; CI creates a branch DB; the Vercel preview deploy connects to it (`DATABASE_URL` for preview is the branch URL).

- [ ] **5.8** Soak — leave the stack running for **7 days** with normal dev activity (small commits, PR previews, manual smoke traffic).
  Verify daily: Better Stack dashboard shows 100% uptime. Sentry has no new production errors trending upward. Axiom log volume trend is flat (< 500 MB/day pre-launch). AWS bill starts trending down (CloudWatch metrics from ECS + RDS drop as the runtime idles).

  **Do not start Phase 6 until 7 days have elapsed AND every monitor is green for the whole window.**

---

### Phase 6 — AWS teardown (est 3-4 h Austin at keyboard, spread over 1 day)

Executes `docs/migration/aws-teardown.md` Phases 0-14. Every command is defensively idempotent; every step has a verify. Full authoritative sequence is in that doc — this section drives it.

**Preflight (gate on this):**

- [ ] **6.0.a** New stack green for 7+ days (Phase 5.8 confirmed).
- [ ] **6.0.b** All migration PRs merged (Phase 0 confirmed).
- [ ] **6.0.c** AWS creds point at account `746669200861`, region `us-east-1`.
  Command: `aws sts get-caller-identity` + `aws configure get region`.
  Verify: `Account=746669200861`, `us-east-1`.
- [ ] **6.0.d** Environment for the preflight script is populated (source your teardown-secrets file).
  Vars needed: `NEW_STACK_URL=https://polemicyst.com`, `FLY_HEALTH_URL=https://polemicyst-clip-worker.fly.dev/healthz`, `NEON_PROD_URL=<neon-direct>`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=clipfire-uploads`, `UPSTASH_REDIS_URL=rediss://default:<pwd>@<slug>.upstash.io:6379`.
- [ ] **6.0.e** Run preflight.
  Command: `bash scripts/aws-teardown/preflight.sh`
  Verify: exit code 0, every check `[PASS]`. STOP if any `[FAIL]`.

Now execute `aws-teardown.md` Phases 1-14 verbatim. The condensed order:

- [ ] **6.1** aws-teardown Phase 1 — **Backup**. Snapshot RDS prod + dev; export prod snapshot to S3 as parquet + download to `~/backups/`; re-sync S3→R2 for parity; inventory ECR tags; export Route 53 zone records.
  Command: sequence `bash scripts/aws-teardown/rds-snapshot.sh prod` → `bash scripts/aws-teardown/rds-snapshot.sh dev` → `bash scripts/aws-teardown/rds-export.sh prod` → `aws s3 sync s3://clipfire-teardown-exports/prod/ ~/backups/clipfire/rds-prod-final/` → `bash scripts/aws-teardown/s3-to-r2-sync.sh` → `bash scripts/aws-teardown/ecr-inventory.sh > ~/backups/clipfire/ecr-inventory-$(date +%Y-%m-%d).json` → export Route 53 records.
  Verify: each per `aws-teardown.md` Phase 1 verifies.

- [ ] **6.2** aws-teardown Phase 2 — **App layer down**. Disable auto-scaling → scale services to 0 → wait for tasks to drain → delete services → deregister task defs → delete service-discovery namespace.
  Command: `bash scripts/aws-teardown/disable-autoscaling.sh` → `bash scripts/aws-teardown/ecs-scale-to-zero.sh` → `bash scripts/aws-teardown/ecs-delete-services.sh` → `bash scripts/aws-teardown/ecs-deregister-task-defs.sh` → service-discovery deletion loop from `aws-teardown.md` step 2.6.
  Verify: `aws ecs list-services --cluster polemicyst-cluster --query 'serviceArns'` returns `[]`.

- [ ] **6.3** aws-teardown Phase 3 — **Delete ALB**. Delete both listeners → delete LB → delete both target groups.
  Verify: `aws elbv2 describe-load-balancers --names polemicyst-alb 2>&1 | grep -q LoadBalancerNotFound`.

- [ ] **6.4** aws-teardown Phase 4 — **Delete ECS cluster**.
  Command: `aws ecs delete-cluster --cluster polemicyst-cluster`.

- [ ] **6.5** aws-teardown Phase 5 — **Delete RDS instances**. Disable deletion protection on prod → wait → delete prod → delete dev → wait for both `deleted` → delete DB subnet group.

- [ ] **6.6** aws-teardown Phase 6 — **NAT + release EIP**. Kills the largest hourly cost line. Delete NAT → wait for `deleted` → **release the Elastic IP** (this is the $3.60/mo trap — do NOT skip).

- [ ] **6.7** aws-teardown Phase 7 — **VPC teardown**. VPC endpoints → route tables → subnets → IGW → security groups → VPC.

- [ ] **6.8** aws-teardown Phase 8 — **Empty + delete S3 bucket**. Re-verify R2 parity → empty `polemicyst-uploads-prod` (all versions + delete-markers) → delete bucket. Repeat for `polemicyst-uploads-dev` if it exists.

- [ ] **6.9** aws-teardown Phase 9 — **Delete ECR repos**. `polemicyst-web`, `polemicyst-clip-worker`, `polemicyst-llm-worker` with `--force`.

- [ ] **6.10** aws-teardown Phase 10 — **Delete CloudWatch log groups**. All `/ecs/polemicyst-*`.

- [ ] **6.11** aws-teardown Phase 11 — **Delete IAM roles**. Detach policies → delete `polemicyst-ecs-task-execution-role` + `polemicyst-ecs-task-role`.

- [ ] **6.12** aws-teardown Phase 12 — **Route 53**. **STOP** — verify `dig +short NS polemicyst.com @8.8.8.8` returns Cloudflare nameservers (Phase 2.7 was 7+ days ago; propagation is definitely complete). Delete non-NS/non-SOA records → delete hosted zone.

- [ ] **6.13** aws-teardown Phase 13 — **ACM cert**. Delete `polemicyst.com` cert (must be uninstalled from ALB, which was deleted in 6.3).

- [ ] **6.14** aws-teardown Phase 14 — **Post-teardown cost verification**. See Phase 7 below.

---

### Phase 7 — 24h cost check + orphan sweep (est 30 min after 24h wait)

**Preflight:** Phase 6 complete. Wait 24 h for AWS Cost Explorer to reflect zero-usage.

- [ ] **7.1** Run the cost check.
  Command: `bash scripts/aws-teardown/cost-check.sh`
  Verify: exit 0. Script prints per-service spend for the last 3 days; only `Tax` and `AWS Support` should be non-zero, and both should be trending to $0 as the invoice cycle rolls.

- [ ] **7.2** Orphan sweep for stragglers (EIPs, EBS, forgotten snapshots).
  Command: `bash scripts/aws-teardown/orphan-sweep.sh`
  Verify: exit 0 with output `no orphan resources found`. If it flags an EIP, EBS volume, or snapshot, delete it via the console + re-run.

- [ ] **7.3** Calendar-reminder yourself: `+90 days`, delete the final RDS snapshots.
  Command: (calendar entry) `aws rds delete-db-snapshot --db-snapshot-identifier clipfire-final-prod-<date>` + same for `-dev-`.
  Verify: On the day, snapshot list is empty.

- [ ] **7.4** Archive the Terraform config.
  Command: `git mv infrastructure/ infrastructure.archive/ && git commit -m 'archive: infra terraform (AWS teardown complete)'`. Per `aws-teardown.md` §Terraform state fate.
  Verify: `test -d infrastructure.archive && ! test -d infrastructure`.

- [ ] **7.5** Delete the Terraform state file from the other MacBook (once you've confirmed everything on this Mac).
  Command: (manual step on the other Mac) `rm -f infrastructure/terraform.tfstate*`. Only after 7.1-7.4 all green.

---

## Rollback

Every phase has a rollback. The blast radius shrinks as you progress.

| Phase | Rollback                                                                                                                     |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1     | Undo Vercel/Fly secret sets; keep RDS + S3 + ElastiCache live. Zero user impact.                                             |
| 2     | Vercel: Deployments → prior deploy → "Promote to Production". Fly: `flyctl releases rollback <version> --app polemicyst-clip-worker`. DNS: edit A/CNAME back to the AWS ALB. TTL 300 s. |
| 3     | Flip `LLM_UNIFIED_CHAIN=false`; call sites fall back to their direct Ollama path.                                            |
| 4     | Detect via smoke fails → back to Phase 2 rollback.                                                                           |
| 5     | Observability failure doesn't take the app down; delete monitors + re-add.                                                   |
| 6     | **Not rollbackable** — this is the destructive phase. Rely on the RDS snapshots (Phase 6.1) + R2 parity (Phase 1.5 + 6.1.6) + Route 53 record export (Phase 6.1.8). Restoring RDS from snapshot is ~30 min; re-hydrating S3 from R2 is ~10 min for 50 GB. |
| 7     | Nothing to roll back — just verification.                                                                                    |

**Do not proceed past Phase 5 unless you're ready to accept Phase 6 as one-way.** Everything before Phase 6 is a coexistence — AWS is still running, you can revert DNS and keep going on the old stack indefinitely.

---

## Blast-radius map — what breaks when

| Failure                              | Blast radius                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Neon down                            | `/api/health` returns 503. Login + all authenticated routes fail. Fly workers can't dequeue new jobs (they need Neon). |
| Upstash Redis down                   | Rate limiter fails open (per `README.md` contract). BullMQ producers block. Fly workers idle (no new jobs picked up). |
| R2 down                              | New uploads fail. Playback of already-cached clips continues from iOS's `AVPlayer` local cache. Sentry sees `S3` errors from health checks. |
| Vercel outage                        | Web + API down. iOS gets 5xx from `/api/*`. Fly workers keep processing (they don't need Vercel for the queue). |
| Fly worker outage                    | Transcription + clip generation stalls. Web still serves + auth works. Recovery: `flyctl deploy` from CI or manual.    |
| Groq down                            | LLM chain advances to Gemini automatically (transient error). No user-visible impact.                                  |
| Groq + Gemini both down              | LLM chain advances to DeepInfra. No user-visible impact.                                                               |
| All 3 LLM providers down             | LLM-dependent flows throw. Non-LLM routes (auth, uploads, playback) unaffected.                                        |
| Cloudflare DNS down                  | `polemicyst.com` unreachable. iOS `AppConfiguration.API_BASE_URL` fails. Recovery: switch registrar back to Route 53 (kept exported in Phase 6.1.8). |

---

## What this runbook does NOT do

- Does not fire ANY of the commands. Everything is written for Austin to execute at the keyboard.
- Does not push to Vercel or Fly. All deploys are triggered by `git push origin main` + `flyctl deploy` + `vercel --prod`.
- Does not touch the existing AWS deploy pipeline (`.github/workflows/deploy.yml`). It keeps working through Phase 5 as a fallback; Phase 6.2-6.4 makes it stop being useful (ECS gone).
- Does not commit secrets. Every real value comes out of 1Password/console and lands in Vercel Env Vars / Fly secrets / GitHub Actions secrets.
- Does not verify AWS teardown here — that's `aws-teardown.md` Phases 1-14 which this doc drives sequentially in Phase 6.

---

## Cross-references

- Data plane details + backups: [`data-plane.md`](./data-plane.md)
- Compute plane vercel.json + fly.toml details: [`compute-plane.md`](./compute-plane.md) + [`../architecture/vercel-migration.md`](../architecture/vercel-migration.md)
- LLM chain implementation: [`llm-strategy.md`](./llm-strategy.md) + `shared/lib/llm/`
- Env-var manifest (source of truth for names): [`env-vars.md`](./env-vars.md)
- Secrets rotation + inventory: [`secrets-inventory.md`](./secrets-inventory.md)
- Observability free-tier limits + alert rules: [`observability.md`](./observability.md)
- iOS/Android client audit (nothing to change): [`clients.md`](./clients.md)
- AWS teardown detail (Phases 1-14): [`aws-teardown.md`](./aws-teardown.md)
- Prod-hardening checklist (security headers, rate limits, CORS): [`README.md`](./README.md)
