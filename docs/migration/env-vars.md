# Env vars — canonical manifest

Single source of truth for every env var used by the Polemicyst stack, and where each
lives after the AWS → Cloudflare-R2 + Neon + Upstash + Vercel + Fly migration.

**Rules of the road**

- Any var used only by a client (iOS / Android) is set via `ios/project.yml` (xcodegen →
  Info.plist) or `android/app/build.gradle.kts` (`buildConfigField`). Never `.env`.
- Any var used by `src/` (Next.js) is stored in **Vercel Project Settings → Environment
  Variables**. Prod + Preview + Development scopes.
- Any var used by `backend/`, `clip-worker/`, `workers/` (Node processes running on Fly)
  is stored in **Fly secrets** via `flyctl secrets set NAME=value -a <app>`.
- Any var needed by both is set **in both places** — do not proxy through a shared secret
  manager; free-tier providers give us this for free and cross-provider secret managers
  add cost + a moving part.
- `NEXT_PUBLIC_*` vars ship in the client JS bundle. Never put a secret behind that prefix.

## Legend

- **USED_BY**: which processes read the var. `web` = Next.js in `src/`; `backend` = the
  Express service in `backend/`; `clip-worker` = the BullMQ workers in `workers/` + `clip-worker/`;
  `ios` / `android` = native clients.
- **SET_IN**: `Vercel` (project env), `Fly` (`flyctl secrets`), `Neon` (managed by Neon
  itself — connection strings), `Xcode` (via `ios/project.yml` → Info.plist), `Gradle`
  (via `android/app/build.gradle.kts`), `both` = Vercel + Fly.
- **SECRET**: `y` = must not appear in git. `n` = safe to commit (URLs, feature flags).
- **EXAMPLE**: shape of the value, not a real credential.

---

## Core infra (post-migration)

| NAME                       | USED_BY                          | SECRET | SET_IN                  | EXAMPLE                                                                                                      | AWS → new-stack                                                                                                                                 |
| -------------------------- | -------------------------------- | ------ | ----------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | web, backend, clip-worker        | y      | both (Vercel + Fly)     | `postgresql://user:pass@ep-cool-lake-1234.us-east-2.aws.neon.tech/polemicyst?sslmode=require&pgbouncer=true` | RDS → Neon. Use `-pooler` suffix in prod.                                                                                                       |
| `DIRECT_DATABASE_URL`      | web (Prisma migrations), backend | y      | both                    | `postgresql://user:pass@ep-cool-lake-1234.us-east-2.aws.neon.tech/polemicyst?sslmode=require`                | New. Neon-specific: `prisma migrate` needs the non-pooled URL.                                                                                  |
| `REDIS_URL`                | web, backend, clip-worker        | y      | both                    | `rediss://default:<token>@fond-koi-12345.upstash.io:6379`                                                    | ElastiCache → Upstash. Use the **rediss://** (TLS) URL from Upstash console.                                                                    |
| `REDIS_HOST`               | web, backend, clip-worker        | n      | both                    | `fond-koi-12345.upstash.io`                                                                                  | Legacy — kept for the ioredis config in `shared/queues.ts:22`. Set to Upstash host.                                                             |
| `REDIS_PORT`               | web, backend, clip-worker        | n      | both                    | `6379`                                                                                                       | Legacy. Upstash Redis is 6379.                                                                                                                  |
| `REDIS_PASSWORD`           | web, backend, clip-worker        | y      | both                    | `<upstash-token>`                                                                                            | New. `shared/queues.ts` needs updating to read this — see clients.md TODO.                                                                      |
| `REDIS_TLS`                | web, backend, clip-worker        | n      | both                    | `true`                                                                                                       | New. `ioredis` needs `tls: {}` for Upstash. Update `shared/queues.ts`.                                                                          |
| `UPSTASH_REDIS_REST_URL`   | web (Ratelimit only)             | n      | Vercel                  | `https://fond-koi-12345.upstash.io`                                                                          | Already used in `src/app/api/publications/*`. Keep.                                                                                             |
| `UPSTASH_REDIS_REST_TOKEN` | web (Ratelimit only)             | y      | Vercel                  | `<rest-token>`                                                                                               | Already used. Keep.                                                                                                                             |
| `S3_BUCKET`                | web, backend, clip-worker        | n      | both                    | `polemicyst-uploads`                                                                                         | Same var name — points at the R2 bucket (S3-compatible API).                                                                                    |
| `S3_REGION`                | web, backend, clip-worker        | n      | both                    | `auto`                                                                                                       | R2 uses `auto`.                                                                                                                                 |
| `S3_ENDPOINT`              | web, backend, clip-worker        | n      | both                    | `https://<account>.r2.cloudflarestorage.com`                                                                 | New. R2 needs a custom endpoint; not needed on AWS S3. `S3Client` must be configured with `{ endpoint, forcePathStyle: true, region: 'auto' }`. |
| `AWS_ACCESS_KEY_ID`        | web, backend, clip-worker        | y      | both                    | R2 access key ID                                                                                             | R2 issues S3-compatible creds. Same env-var name; different value.                                                                              |
| `AWS_SECRET_ACCESS_KEY`    | web, backend, clip-worker        | y      | both                    | R2 secret                                                                                                    | Same.                                                                                                                                           |
| `S3_TRANSFER_ACCELERATION` | web, backend                     | n      | both                    | `false`                                                                                                      | Delete after cutover — R2 has no equivalent.                                                                                                    |
| `NEXT_PUBLIC_R2_CDN_HOST`  | web, ios, android                | n      | Vercel + Xcode + Gradle | `pub-abc123.r2.dev` or `cdn.polemicyst.com`                                                                  | New. Public playback URLs. Prefer the custom domain (`cdn.polemicyst.com`) once configured; `pub-*.r2.dev` works day one.                       |

## Auth

| NAME                     | USED_BY                              | SECRET | SET_IN              | EXAMPLE                                     | Notes                                                                   |
| ------------------------ | ------------------------------------ | ------ | ------------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| `NEXTAUTH_URL`           | web                                  | n      | Vercel              | `https://polemicyst.com`                    | Prod URL. Preview deploys read `VERCEL_URL`.                            |
| `NEXTAUTH_SECRET`        | web, backend                         | y      | both                | `<random-32-bytes-base64>`                  | Shared JWT signing key — mobile Bearer tokens sign here + decode there. |
| `AUTH_SECRET`            | web (legacy)                         | y      | Vercel              | same as `NEXTAUTH_SECRET`                   | Historical alias. Prefer `NEXTAUTH_SECRET`.                             |
| `GOOGLE_CLIENT_ID`       | web                                  | n      | Vercel              | `<id>.apps.googleusercontent.com`           | Web OAuth.                                                              |
| `GOOGLE_CLIENT_SECRET`   | web                                  | y      | Vercel              | `GOCSPX-...`                                | Web OAuth.                                                              |
| `GOOGLE_IOS_CLIENT_ID`   | web (validates iOS-issued JWTs), ios | n      | Vercel + Xcode      | `<id>.apps.googleusercontent.com`           | Bundle-id-scoped iOS OAuth client.                                      |
| `APPLE_CLIENT_ID`        | web (validates Apple JWTs)           | n      | Vercel              | `com.polemicyst.app`                        | Bundle ID.                                                              |
| `AUTH_ALLOWLIST_ENABLED` | web                                  | n      | Vercel              | `true`                                      | Prod = true, dev = false.                                               |
| `AUTH_ALLOWED_EMAILS`    | web                                  | n      | Vercel              | `aconnor731@gmail.com,investor@example.com` | Pre-launch allowlist.                                                   |
| `AUTH_ALLOWED_PROVIDERS` | web                                  | n      | Vercel              | `google,apple`                              |                                                                         |
| `DEV_LOGIN_SECRET`       | web                                  | y      | Vercel (dev only)   | `<random>`                                  | Dev-only shortcut. **Never set in Production scope.**                   |
| `DEV_USER_EMAIL`         | web                                  | n      | Vercel (dev only)   | `dev@polemicyst.local`                      | Dev-only.                                                               |
| `NEXTAUTH_DEBUG`         | web                                  | n      | Vercel (never prod) | `false`                                     | Leaks tokens when true.                                                 |

## Admin / feature flags

| NAME                      | USED_BY                        | SECRET | SET_IN | EXAMPLE                |
| ------------------------- | ------------------------------ | ------ | ------ | ---------------------- |
| `ADMIN_EMAIL`             | web, backend                   | n      | both   | `aconnor731@gmail.com` |
| `NEXT_PUBLIC_ADMIN_EMAIL` | web (client-side sidenav gate) | n      | Vercel | `aconnor731@gmail.com` |
| `MIN_APP_VERSION_IOS`     | web                            | n      | Vercel | `1.4.0`                |
| `MIN_APP_VERSION_ANDROID` | web                            | n      | Vercel | `1.4.0`                |

## Billing (Stripe)

| NAME                                 | USED_BY      | SECRET | SET_IN | EXAMPLE       |
| ------------------------------------ | ------------ | ------ | ------ | ------------- |
| `STRIPE_SECRET_KEY`                  | web          | y      | Vercel | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET`              | web          | y      | Vercel | `whsec_...`   |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | web          | n      | Vercel | `pk_live_...` |
| `STRIPE_CREATOR_MONTHLY_PRICE_ID`    | web          | n      | Vercel | `price_...`   |
| `STRIPE_CREATOR_ANNUAL_PRICE_ID`     | web          | n      | Vercel | `price_...`   |
| `STRIPE_PRO_MONTHLY_PRICE_ID`        | web          | n      | Vercel | `price_...`   |
| `STRIPE_PRO_ANNUAL_PRICE_ID`         | web          | n      | Vercel | `price_...`   |
| `STRIPE_AGENCY_MONTHLY_PRICE_ID`     | web          | n      | Vercel | `price_...`   |
| `STRIPE_AGENCY_ANNUAL_PRICE_ID`      | web          | n      | Vercel | `price_...`   |
| `STRIPE_PRO_PRICE_ID`                | web (legacy) | n      | Vercel | `price_...`   |
| `STRIPE_BUSINESS_PRICE_ID`           | web (legacy) | n      | Vercel | `price_...`   |

## LLM providers

| NAME                          | USED_BY                           | SECRET | SET_IN | EXAMPLE                           |
| ----------------------------- | --------------------------------- | ------ | ------ | --------------------------------- |
| `LLM_PROVIDER`                | web, clip-worker                  | n      | both   | `gemini`                          |
| `SCORING_TYPE`                | web, clip-worker                  | n      | both   | `hybrid`                          |
| `GOOGLE_API_KEY`              | web, clip-worker                  | y      | both   | `AIza...`                         |
| `GEMINI_MODEL`                | web, clip-worker                  | n      | both   | `gemini-2.0-flash`                |
| `MODEL_NAME`                  | web, clip-worker                  | n      | both   | `gemini-2.0-flash`                |
| `ANTHROPIC_API_KEY`           | web, clip-worker                  | y      | both   | `sk-ant-...`                      |
| `OPENAI_API_KEY`              | web, clip-worker                  | y      | both   | `sk-...`                          |
| `OLLAMA_BASE_URL`             | web, clip-worker                  | n      | both   | `http://ollama.internal:11434`    |
| `OLLAMA_HOST`                 | clip-worker                       | n      | Fly    | `ollama.internal:11434`           |
| `OLLAMA_MODEL`                | web, clip-worker                  | n      | both   | `llama3`                          |
| `OLLAMA_VISION_MODEL`         | clip-worker                       | n      | Fly    | `llama3.2-vision`                 |
| `OLLAMA_MAX_TRANSCRIPT_CHARS` | clip-worker                       | n      | Fly    | `12000`                           |
| `SEGMENTATION_PROVIDER`       | clip-worker                       | n      | Fly    | `mediapipe`                       |
| `SEGMENT_VIDEO_SCRIPT`        | clip-worker                       | n      | Fly    | `/app/tools/segment_video.py`     |
| `FACE_DETECT_SCRIPT_PATH`     | clip-worker                       | n      | Fly    | `/app/tools/detect_faces.py`      |
| `REMBG_SCRIPT_PATH`           | clip-worker                       | n      | Fly    | `/app/tools/remove_background.py` |
| `REMBG_PYTHON_PATH`           | clip-worker                       | n      | Fly    | `/usr/local/bin/python3`          |
| `PYTHON_BIN`                  | clip-worker                       | n      | Fly    | `/usr/local/bin/python3`          |
| `PYTHON_PATH`                 | clip-worker                       | n      | Fly    | `/app/tools`                      |
| `PUPPETEER_EXECUTABLE_PATH`   | web (quote graphics), clip-worker | n      | both   | `/usr/bin/chromium`               |
| `YT_DLP_TIMEOUT_MS`           | clip-worker                       | n      | Fly    | `300000`                          |

## Third-party integrations

| NAME                                   | USED_BY | SECRET | SET_IN | EXAMPLE                                                                                                  |
| -------------------------------------- | ------- | ------ | ------ | -------------------------------------------------------------------------------------------------------- |
| `TWITTER_CONSUMER_KEY`                 | web     | y      | Vercel | `<key>`                                                                                                  |
| `TWITTER_CONSUMER_SECRET`              | web     | y      | Vercel | `<secret>`                                                                                               |
| `EMAIL_USER`                           | web     | n      | Vercel | `notifications@polemicyst.com`                                                                           |
| `EMAIL_PASS`                           | web     | y      | Vercel | `<app-password>`                                                                                         |
| `INSTAGRAM_SESSION_STATE_PATH`         | web     | n      | Vercel | `/tmp/ig-state.json` — plus the base64-encoded file body in a separate secret. See secrets-inventory.md. |
| `NEXT_PUBLIC_TRANSCRIPTION_WORKER_URL` | web     | n      | Vercel | `https://transcript.polemicyst.com` — the Python transcript sidecar.                                     |

## Observability

| NAME                       | USED_BY                   | SECRET                | SET_IN                | EXAMPLE                                                        |
| -------------------------- | ------------------------- | --------------------- | --------------------- | -------------------------------------------------------------- |
| `SENTRY_DSN`               | web, backend, clip-worker | n (URL, not a secret) | both                  | `https://<key>@o<org>.ingest.sentry.io/<project>`              |
| `NEXT_PUBLIC_SENTRY_DSN`   | web (client bundle)       | n                     | Vercel                | same as `SENTRY_DSN`                                           |
| `SENTRY_ENVIRONMENT`       | web, backend, clip-worker | n                     | both                  | `production`                                                   |
| `SENTRY_RELEASE`           | web, backend, clip-worker | n                     | both                  | git SHA — set in CI via `SENTRY_RELEASE=$(git rev-parse HEAD)` |
| `SENTRY_AUTH_TOKEN`        | CI (source-map upload)    | y                     | GitHub Actions secret | `sntrys_...`                                                   |
| `SENTRY_ORG`               | CI                        | n                     | GitHub Actions secret | `polemicyst`                                                   |
| `SENTRY_PROJECT`           | CI                        | n                     | GitHub Actions secret | `clipfire-web`                                                 |
| `AXIOM_TOKEN`              | backend, clip-worker      | y                     | Fly                   | `xaat-...`                                                     |
| `AXIOM_DATASET`            | backend, clip-worker      | n                     | Fly                   | `clipfire-prod`                                                |
| `NEXT_PUBLIC_POSTHOG_KEY`  | web                       | n                     | Vercel                | `phc_...`                                                      |
| `NEXT_PUBLIC_POSTHOG_HOST` | web                       | n                     | Vercel                | `https://us.i.posthog.com`                                     |
| `POSTHOG_API_KEY`          | web (server-side)         | y                     | Vercel                | `phc_...`                                                      |
| `POSTHOG_HOST`             | web                       | n                     | Vercel                | `https://us.i.posthog.com`                                     |
| `NEXT_PUBLIC_BEAM_TOKEN`   | web                       | n                     | Vercel                | `<token>`                                                      |

## Runtime

| NAME                    | USED_BY                            | SECRET | SET_IN                 | EXAMPLE                                                              |
| ----------------------- | ---------------------------------- | ------ | ---------------------- | -------------------------------------------------------------------- |
| `NODE_ENV`              | web, backend, clip-worker          | n      | Vercel + Fly           | `production`                                                         |
| `HTTP_PORT`             | backend, clip-worker (health port) | n      | Fly                    | `8080`                                                               |
| `VERCEL_URL`            | web                                | n      | Vercel (auto-injected) | `preview-xyz.vercel.app`                                             |
| `VERCEL_ENV`            | web                                | n      | Vercel (auto-injected) | `production`                                                         |
| `VERCEL_GIT_COMMIT_SHA` | web                                | n      | Vercel (auto-injected) | `<sha>` — used as `SENTRY_RELEASE` fallback + `/api/health` version. |

## Client-side (iOS)

Set via `ios/project.yml` → xcodegen → build settings → Info.plist. Read via
`AppConfiguration` in `ios/Sources/ClipfireiOS/Networking/Configuration.swift`.

| NAME                        | USED_BY | SECRET                                                                       | SET_IN                                     | EXAMPLE                                                                         |
| --------------------------- | ------- | ---------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| `API_BASE_URL`              | ios     | n                                                                            | Xcode (via project.yml, per-configuration) | `https://polemicyst.com` (Release) / `https://192.168.0.16:3000` (Debug)        |
| `GRAPHIC_RENDER_URL`        | ios     | n                                                                            | Xcode                                      | `https://polemicyst-graphic-render.vercel.app`                                  |
| `GRAPHIC_RENDER_SECRET`     | ios     | n (public gate on a stateless render, per iOS `Configuration.swift` comment) | Xcode                                      | `<shared-secret>`                                                               |
| `TRANSCRIPT_SERVICE_URL`    | ios     | n                                                                            | Xcode                                      | `http://localhost:8791` (Debug) / `https://transcript.polemicyst.com` (Release) |
| `TRANSCRIPT_SERVICE_SECRET` | ios     | n                                                                            | Xcode                                      | `<shared-secret>`                                                               |
| `GOOGLE_SERVER_CLIENT_ID`   | ios     | n                                                                            | Xcode                                      | `<id>.apps.googleusercontent.com`                                               |

## Client-side (Android)

Set via `android/app/build.gradle.kts` → `buildConfigField` per productFlavor.
Currently ships `dev` (`https://10.0.2.2:3000` — emulator loopback) and `prod`
(`https://polemicyst.com`).

| NAME           | USED_BY | SECRET | SET_IN | EXAMPLE                  |
| -------------- | ------- | ------ | ------ | ------------------------ |
| `API_BASE_URL` | android | n      | Gradle | `https://polemicyst.com` |

---

## AWS → new-stack mapping (quick reference)

| AWS var (before)                                    | New home      | Value shape (after)                                                                                           |
| --------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` (RDS)                                | Neon          | `postgresql://…neon.tech/db?sslmode=require&pgbouncer=true`                                                   |
| `REDIS_HOST` + `REDIS_PORT` (ElastiCache)           | Upstash       | Set both to the Upstash host + 6379; **also** set `REDIS_PASSWORD` + `REDIS_TLS=true`.                        |
| `S3_BUCKET` + `S3_REGION` (AWS S3)                  | R2            | `S3_BUCKET=<r2-bucket>`, `S3_REGION=auto`, plus new `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`. |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (IAM) | R2 API tokens | Reissued in Cloudflare dash. Same env var names.                                                              |
| `S3_TRANSFER_ACCELERATION`                          | (delete)      | R2 doesn't have transfer acceleration; drop the code path.                                                    |
| CloudFront distribution URL                         | R2 public URL | `NEXT_PUBLIC_R2_CDN_HOST=pub-<hash>.r2.dev` or the custom domain.                                             |

## Vars used **only by the AWS teardown / migration itself** (delete post-cutover)

- `S3_TRANSFER_ACCELERATION` — R2 has no such feature.
- Any legacy `AWS_REGION` references in code — replaced by `S3_REGION` reading `auto`. The
  fallback chain `S3_REGION || AWS_REGION || 'us-east-1'` in seven `src/app/api/*` files
  becomes `S3_REGION || 'auto'` after the storage-plane migration. Tracked as a TODO in
  `clients.md`.

## Not-yet-set-anywhere — must exist before cutover

Everything in the "Observability" section above; everything in "Core infra" except the S3
variants; the four Neon-specific URLs. compute-plane + data-plane agents will land the
values.
