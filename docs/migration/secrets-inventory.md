# Secrets inventory

Every secret referenced in the codebase, its home provider on the new stack, and a
rotation plan. Non-secret env vars (URLs, feature flags) are in
[`env-vars.md`](./env-vars.md).

**Discovery method** — enumerated via
`grep -rEno "process\.env\.[A-Z_]+" src backend clip-worker shared workers` for TS
consumers, plus `Bundle.main.infoDictionary` for iOS. Every unique `process.env.*` was
manually classified as secret / non-secret based on whether leaking it enables a valuable
action (log in as us, spend our money, read our data).

**`.env.example`** — the repo's canonical template is `ENV_VARS.template`, which is
already secret-free (every secret line ends `=` with no value). Verified with
`grep -E "^[A-Z_]+=.+" ENV_VARS.template` — the only lines with values are non-secret
defaults (`AWS_REGION=us-east-1`, `APPLE_CLIENT_ID=com.polemicyst.app`, allowlist
placeholders, `ADMIN_EMAIL`).

## Secrets — the full list

| NAME                                                                                     | PROVIDER                                                                              | IMPACT IF LEAKED                                                                                                                  | ROTATION PROCEDURE                                                                                                                                                                                                                                       | ROTATION CADENCE                                                                     |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                                                           | Neon                                                                                  | Full DB access.                                                                                                                   | Neon console → project → Roles → reset password for the app role. Update Vercel + Fly secrets.                                                                                                                                                           | On staff turnover; every 6 months.                                                   |
| `DIRECT_DATABASE_URL`                                                                    | Neon                                                                                  | Full DB access.                                                                                                                   | Same as `DATABASE_URL`.                                                                                                                                                                                                                                  | Same.                                                                                |
| `REDIS_URL` / `REDIS_PASSWORD`                                                           | Upstash                                                                               | Read/write access to BullMQ queues + rate-limit counters. Attacker can enqueue rogue jobs.                                        | Upstash console → database → password / TLS → reset. Update Vercel + Fly.                                                                                                                                                                                | On staff turnover; every 12 months.                                                  |
| `UPSTASH_REDIS_REST_TOKEN`                                                               | Upstash                                                                               | Same as `REDIS_URL`.                                                                                                              | Upstash console → database → REST → new token.                                                                                                                                                                                                           | Same.                                                                                |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (values are R2 credentials post-migration) | Cloudflare R2                                                                         | Read/write access to media bucket. Attacker can delete clips or exfil user uploads.                                               | Cloudflare dash → R2 → Manage R2 API Tokens → revoke + issue new. Update Vercel + Fly.                                                                                                                                                                   | On staff turnover; every 6 months. Rotate all tokens when a Cloudflare admin leaves. |
| `NEXTAUTH_SECRET` (alias `AUTH_SECRET`)                                                  | Vercel + Fly (same value in both)                                                     | JWT signing key. Attacker can mint session tokens for any user, including admin. Highest-severity secret.                         | Generate `openssl rand -base64 32`. Set on **both** Vercel and Fly **in the same deploy window**. Existing sessions invalidate — expected.                                                                                                               | Every 90 days OR on any breach signal.                                               |
| `DEV_LOGIN_SECRET`                                                                       | Vercel (Development scope only — **never** Production)                                | Dev-only login shortcut. Not present in prod.                                                                                     | Regenerate on-demand; no rotation needed.                                                                                                                                                                                                                | N/a — never in prod.                                                                 |
| `GOOGLE_CLIENT_SECRET`                                                                   | Vercel                                                                                | OAuth impersonation of the web-client OAuth app; can be used to phish users into granting the attacker their Google data.         | Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client → Reset Secret. Update Vercel.                                                                                                                                                   | Every 12 months.                                                                     |
| `GOOGLE_API_KEY`                                                                         | Vercel + Fly                                                                          | Charges accrue to our Google billing account (Gemini API + YouTube Data API). Leak can cost $/day.                                | Google Cloud Console → APIs & Services → Credentials → API Keys → regenerate. Restrict by IP + referrer.                                                                                                                                                 | Every 6 months. Rotate immediately on billing anomaly.                               |
| `ANTHROPIC_API_KEY`                                                                      | Vercel + Fly                                                                          | Charges to our Anthropic account.                                                                                                 | Anthropic Console → Keys → revoke + issue new.                                                                                                                                                                                                           | Every 6 months.                                                                      |
| `OPENAI_API_KEY`                                                                         | Vercel + Fly                                                                          | Charges to our OpenAI account.                                                                                                    | OpenAI dashboard → API keys → revoke + issue new.                                                                                                                                                                                                        | Every 6 months.                                                                      |
| `STRIPE_SECRET_KEY`                                                                      | Vercel                                                                                | Full Stripe account access — refund/charge on our behalf, read all customer data. Highest financial impact.                       | Stripe Dashboard → Developers → API keys → Roll → confirm new. Update Vercel Production. **Do not** roll without a maintenance window — in-flight webhooks fail while the old key is live but the new is set on our side.                                | Every 90 days. Roll immediately on leak.                                             |
| `STRIPE_WEBHOOK_SECRET`                                                                  | Vercel                                                                                | Attacker can forge webhook events (e.g. mark subscription active without paying).                                                 | Stripe Dashboard → Webhooks → endpoint → reveal + roll. Update Vercel.                                                                                                                                                                                   | Every 12 months. Roll on any suspicious webhook activity.                            |
| `TWITTER_CONSUMER_KEY` / `TWITTER_CONSUMER_SECRET`                                       | Vercel                                                                                | Attacker can impersonate the app to Twitter, potentially posting on connected users' behalf if OAuth tokens are also compromised. | Twitter Developer Portal → App → Keys and Tokens → Regenerate. Update Vercel.                                                                                                                                                                            | Every 12 months.                                                                     |
| `EMAIL_PASS`                                                                             | Vercel                                                                                | Send email as our system inbox. Phishing risk.                                                                                    | Google Workspace (or IMAP host) → Security → App Passwords → revoke + create new. Update Vercel.                                                                                                                                                         | Every 12 months.                                                                     |
| `INSTAGRAM_SESSION_STATE_PATH` **file body**                                             | Fly (uploaded as a base64-encoded secret and decoded to `/tmp/ig-state.json` at boot) | Attacker can pose as our Instagram scraper account — 24h-shelf-life at best; Instagram will lock the account.                     | Regenerate on the dev machine via `scripts/generate-ig-state.ts`, base64 the resulting JSON, `flyctl secrets set IG_STATE_JSON=$(base64 <file>) -a clip-worker`. Worker's start-up hook decodes it to the path. Not a real "rotation" — it's a re-login. | Every time IG blocks the scraper (weekly-ish).                                       |
| `SENTRY_AUTH_TOKEN`                                                                      | GitHub Actions repo secret (**not** Vercel/Fly — build-time only)                     | Attacker can upload source maps or manipulate our Sentry project. Not runtime-critical.                                           | Sentry → Settings → Auth Tokens → revoke + issue new with `project:releases` scope only. Update GitHub Actions secret `SENTRY_AUTH_TOKEN`.                                                                                                               | Every 12 months.                                                                     |
| `AXIOM_TOKEN`                                                                            | Fly                                                                                   | Attacker can write logs to our dataset (spam) or read prod logs (data-leak risk).                                                 | Axiom dashboard → Settings → Access tokens → revoke + new (with only `ingest` scope). Update Fly.                                                                                                                                                        | Every 12 months.                                                                     |
| `POSTHOG_API_KEY` (server-side project key)                                              | Vercel                                                                                | Can write events on our behalf; attacker can pollute analytics.                                                                   | PostHog → Project → Settings → API Keys → rotate. Update Vercel.                                                                                                                                                                                         | Every 12 months.                                                                     |

## NEXT*PUBLIC*\* keys (client-bundle) — not secrets, worth noting

These ship in the JS bundle sent to every visitor. They **are** rotatable but they are
not "secrets" in the security sense — they're public identifiers.

- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — designed to be public.
- `NEXT_PUBLIC_POSTHOG_KEY` — designed to be public (project-scoped write-only).
- `NEXT_PUBLIC_SENTRY_DSN` — designed to be public (project ingest URL).
- `NEXT_PUBLIC_BEAM_TOKEN` — verify: this is a rate-limited public token. If it's the
  server-side Beam AI key, **move it out of `NEXT_PUBLIC_*` immediately**. Owner: TBD.
- `NEXT_PUBLIC_ADMIN_EMAIL` — not a secret; used to gate a client-side sidenav link. The
  real gate is server-side.
- `NEXT_PUBLIC_TRANSCRIPTION_WORKER_URL` — public URL of the transcript sidecar.
- `NEXT_PUBLIC_R2_CDN_HOST` — public CDN hostname.

## Client-side (iOS) — `Bundle.main.infoDictionary`

Discovered via `grep -rEn 'infoDictionary\?\[' ios/Sources`.

| Key                         | Sensitive?      | Notes                                                                                                                                                                                           |
| --------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_BASE_URL`              | no              | Backend URL.                                                                                                                                                                                    |
| `GOOGLE_SERVER_CLIENT_ID`   | no              | Public Google OAuth client ID.                                                                                                                                                                  |
| `GRAPHIC_RENDER_URL`        | no              | Public sidecar URL.                                                                                                                                                                             |
| `GRAPHIC_RENDER_SECRET`     | **soft-secret** | Ships in the app binary (comment in `Configuration.swift:31` acknowledges this). It gates a public stateless render endpoint — no user data, no auth. Rotate + re-ship a new build when leaked. |
| `TRANSCRIPT_SERVICE_URL`    | no              | Public sidecar URL.                                                                                                                                                                             |
| `TRANSCRIPT_SERVICE_SECRET` | **soft-secret** | Same story as `GRAPHIC_RENDER_SECRET`.                                                                                                                                                          |

Both soft-secrets should be paired with server-side origin allowlisting so an extracted
value from the IPA is not sufficient to abuse the endpoint.

## Client-side (Android) — `BuildConfig.*`

- `BuildConfig.API_BASE_URL` — non-secret URL. No client-embedded secrets today.

## `.env.example` hygiene

`ENV_VARS.template` (the repo's canonical template):

- **Passes** — no secret values, only names + non-secret defaults.
- **Add** — the new observability + R2 vars from `env-vars.md`. This PR appends them to
  the template.

`.gitignore` verified — `.env`, `.env.local`, `.env.*.local` all ignored.

## Storage rules (repeat, for the audit trail)

1. **Never** commit secrets. `ENV_VARS.template` is the only committed env-shape file.
2. **Never** put a secret behind `NEXT_PUBLIC_*` — it ships to every user.
3. **Fly secrets** for anything read by the Express backend or the BullMQ workers.
4. **Vercel Project Env Vars** for anything read by Next.js (`src/`).
5. When both need the same secret (JWT signing key, DB URL, R2 creds), **set it in both
   places** with the same value. No cross-provider secret manager — the added moving
   part costs more than the ergonomic win.
6. **GitHub Actions repo secrets** for CI-only credentials (`SENTRY_AUTH_TOKEN`,
   Fly deploy token, Vercel deploy token).
