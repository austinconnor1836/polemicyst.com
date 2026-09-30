# Data Plane Migration — AWS → Neon + Cloudflare R2 + Upstash Redis

Owner: data-plane agent. Consumers: compute-plane agent, Austin (for signups + cutover).

## Why

We're pre-launch. No live users, so downtime is free. The current AWS bill is
dominated by managed data plane infrastructure — 2× RDS Postgres (prod + dev),
2× ECS Fargate Redis tasks, S3 traffic + NAT gateway egress. We can replace all
of it with cheaper, serverless-billed managed services that also happen to be
easier to operate.

**Target monthly bill (data plane only): ~$10–20/mo pre-launch, elastic up.**

## Target stack

| Concern           | From                                | To                        |
| ----------------- | ----------------------------------- | ------------------------- |
| Object storage    | AWS S3 (`clips-genie-uploads`)      | Cloudflare R2             |
| Prod database     | AWS RDS (Postgres 15)               | Neon Postgres 16          |
| Dev database      | AWS RDS (Postgres 15)               | Local docker-compose      |
| Queue backend     | 2× ECS Fargate `redis:alpine` tasks | Upstash Redis             |
| Local dev storage | N/A (dev used cloud S3 too)         | MinIO (S3 compat) locally |

## Neon Postgres

### Tier + pricing math

- **Assumed usage pre-launch**: 5–20 GB db, ~10k queries/day, 1 primary reader.
- **Free tier** (`Neon Free`): 0.5 GB storage, 1 project, autosuspend after 5 min.
  Too small — we'll blow past 0.5 GB on our first backfill.
- **Launch tier**: `$19/mo` — 10 GB storage, 300 compute-hour/mo, autoscaling on,
  point-in-time restore (7 days), branching. Fits us today.
- **Scale tier**: `$69/mo` — 50 GB storage, PITR 30 days. Move here if we cross
  10 GB. Overage on Launch is +$0.30/GB/mo which is fine to burn briefly.
- **Compute**: pre-launch traffic is <10k queries/day → we sit at ~0.25 CU
  (compute unit) and autosuspend most of the day. 300 CU-hours easily covers it.
  If we go serverless + we get a query burst, Neon autoscales CUs up to the
  configured max (start at 2 CU, ~$0.16/hr max).
- **Regional**: pick `us-east-2` to match current RDS + minimize latency to the
  Vercel + Fly.io compute.

**Estimate**: $19/mo (Launch) + ~$0 overages pre-launch = **~$19/mo**.

### Connection strings — `directUrl` vs `url`

Neon fronts every project with a **pgBouncer** pool at the `-pooler` hostname:

- `postgres://…@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb?pgbouncer=true&sslmode=require`
  — POOLED. Runtime app + workers use this. Short-lived connections, safe from
  serverless (Vercel, Fly Machines).
- `postgres://…@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`
  — DIRECT. `prisma migrate` uses this because pgBouncer's transaction pooling
  breaks the advisory locks Prisma uses during migrations.

Prisma reads these as separate env vars via the `datasource` block (see
`prisma/schema.prisma`):

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")         // pooled
  directUrl = env("DIRECT_DATABASE_URL")  // direct — migrations only
}
```

### Schema audit for Postgres 16

Current schema (`prisma/schema.prisma`) is vanilla Prisma against a `postgresql`
provider. No PG15-specific features are used:

- No `pg_trgm` or other extensions declared.
- No custom `type` / `enum` / stored procedures.
- JSON columns are Prisma's built-in `Json` type — portable.
- Full-text search columns (`descriptionTsvector`) are declared as `Unsupported("tsvector")`.
  PG16 handles `tsvector` identically to PG15.
- No `DEFAULT current_timestamp(3)` precision quirks — Prisma emits standard
  `now()` calls.

**Verdict: no schema changes required for Neon (PG16).** The only change to
`schema.prisma` is the `directUrl` addition above.

### Backups

- **PITR** included on Launch tier — 7 days of restore-any-second.
- **Branching** — Neon lets you fork the DB at any timestamp for testing.
- We ALSO run a nightly `pg_dump` (custom format) to R2 as belt-and-braces —
  see `scripts/migrate-rds-to-neon.sh` for the exact dump invocation; a
  scheduled Fly.io machine or Vercel Cron will run it post-cutover.

## Cloudflare R2

### Tier + pricing math

R2 pricing is **capacity + operations, no egress**. This is the single biggest
win vs S3 — Clipfire's S3 bill is dominated by egress (video playback), which is
literally $0 on R2.

- **Storage**: $0.015/GB/mo. Free tier: first 10 GB free.
- **Class A ops** (writes / list / mutate): $4.50 per million. Free tier: 1M/mo.
- **Class B ops** (reads / head): $0.36 per million. Free tier: 10M/mo.
- **Egress**: $0. Always. Even to non-Cloudflare networks.

**Estimate at current usage** (~50 GB video, growing):

| Line                          | Volume/mo  | Cost          |
| ----------------------------- | ---------- | ------------- |
| Storage (50 GB, 10 GB free)   | 40 GB paid | $0.60         |
| Class A (uploads + multipart) | ~50k       | Free (<1M)    |
| Class B (playback + head)     | ~500k      | Free (<10M)   |
| Egress (playback)             | any        | $0            |
| **Total**                     |            | **~$0.60/mo** |

At 500 GB storage + 5M Class B / mo (post-launch scaling target): ~$8/mo.

### Signup + token creation

Do this in the Cloudflare dashboard:

1. Create the R2 bucket in the us-east region for lowest latency to Vercel/Fly.
2. Under R2 → Manage R2 API Tokens → Create API token, scope `Object Read & Write`
   to the single bucket. Save the Access Key ID + Secret Key — these become
   `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`.
3. Note the account ID (bottom of the R2 dashboard) — this becomes `R2_ACCOUNT_ID`.
4. (Optional) Enable "Public Bucket" and note the `pub-<hash>.r2.dev` URL if you
   want to serve some assets without presigned URLs. Clipfire currently uses
   presigned URLs for all user content, so leave it off.

### Backups + durability

- R2 objects are stored across 3+ AZs; Cloudflare quotes 99.999999999% (eleven
  nines) durability.
- Enable **object versioning** on the bucket for accidental-delete recovery.
- **Cross-region backup**: not built-in. If we want a cold copy, we pipe the
  nightly rclone sync to a second R2 bucket in a different jurisdiction. Not
  urgent pre-launch.

### Adapter

The runtime code path is `shared/lib/storage/r2-adapter.ts`, a full implementation
of the existing `StorageProvider` port. `getStorage()` in
`shared/lib/storage/index.ts` picks R2 vs S3 based on the `STORAGE_PROVIDER` env
var (default: `s3`, or auto-detected if `R2_ACCOUNT_ID` is present).

Migration script for existing objects: `scripts/migrate-s3-to-r2.ts` (resumable,
JSON-manifest checkpointed).

## Upstash Redis

### Tier + pricing math

Upstash Redis is priced per-request + storage. Free tier goes far pre-launch.

- **Free tier**: 10,000 commands/day, 256 MB, single region.
- **Pay-as-you-go**: $0.20 per 100k commands, $0.25/GB/mo storage. No fixed fee.
- **Fixed tier** ("Pro 2K"): $0.28/hr = ~$200/mo for 2000 concurrent conns +
  unlimited commands. Overkill for us.

**Estimate**: pre-launch BullMQ traffic is a few hundred jobs/day. 1 job ≈ 10
commands (LPUSH, BRPOPLPUSH, HGETALL, LREM…). ~5k commands/day. **We fit in
free tier.** Once we cross 10k/day, we're on pay-as-you-go at ~$0.30/mo.

### BullMQ compatibility

BullMQ requires:

- **Blocking commands** — `BRPOPLPUSH`, `BZPOPMIN`, `XREADGROUP BLOCK`. Upstash
  supports blocking commands on their `redis://` (TCP) protocol. (The `REST`
  protocol does NOT support blocking — but BullMQ over `ioredis` uses TCP, so
  we're fine.) Ref: https://upstash.com/docs/redis/features/restapi#blocking-commands
- **Redis Streams** (BullMQ uses `XADD`, `XREADGROUP`, `XACK` for the
  events stream). Fully supported on Upstash.
- **Lua scripts** (BullMQ's core is Lua). Fully supported.
- **Pub/Sub** for QueueEvents. Supported on Upstash's TCP protocol.
- **Client-side caching / RESP3** — not required by BullMQ.

**Verified via**:

- BullMQ docs on Upstash: https://docs.bullmq.io/guide/going-to-production#upstash
  ("Upstash Redis is fully compatible with BullMQ. Use the TCP endpoint, not REST.")
- Upstash's own BullMQ example: https://upstash.com/docs/redis/quickstarts/bullmq

Our `shared/queues.ts` already uses `ioredis` with `host` + `port` + `maxRetriesPerRequest: null`
(BullMQ's required setting). On Upstash we swap to their TLS TCP endpoint:

```ts
new Redis({
  host: process.env.REDIS_HOST, // e.g. flying-cat-12345.upstash.io
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  tls: {}, // required for Upstash TLS endpoint
  maxRetriesPerRequest: null,
});
```

The TLS + password fields are new; we update `shared/queues.ts` in the compute-plane
port. Rate limiter in `src/lib/rate-limit.ts` continues to use `@upstash/redis` (REST) —
that's the OTHER Upstash SDK for the OTHER concern; unchanged.

### Backups

Upstash Redis Global Database includes:

- **Daily backups** to Cloudflare R2 (Upstash uses R2 internally). Retained 7 days.
- Point-in-time restore is available via a support ticket, not self-serve.

For BullMQ, backups matter less — the queue is ephemeral state. Losing it means
in-flight jobs stall until re-enqueued; nothing durable is lost.

## Env var manifest

**For compute-plane agent.** Every env var that CHANGES name or value.

| OLD_NAME                   | NEW_NAME                   | NEW_VALUE_TEMPLATE                                                                                   | USED_BY                                       |
| -------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `DATABASE_URL`             | `DATABASE_URL`             | `postgres://<user>:<pw>@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb?pgbouncer=true&sslmode=require` | Next web, all workers, `shared/lib/prisma.ts` |
| _(new)_                    | `DIRECT_DATABASE_URL`      | `postgres://<user>:<pw>@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`                       | `prisma migrate deploy` (CI + entrypoint)     |
| `REDIS_HOST`               | `REDIS_HOST`               | `flying-cat-12345.upstash.io` (Upstash TCP endpoint host)                                            | `shared/queues.ts`, workers                   |
| `REDIS_PORT`               | `REDIS_PORT`               | `6379`                                                                                               | `shared/queues.ts`, workers                   |
| _(new)_                    | `REDIS_PASSWORD`           | `<upstash-password>`                                                                                 | `shared/queues.ts`, workers                   |
| _(new)_                    | `REDIS_TLS`                | `true` (adapter reads this to enable `tls: {}`)                                                      | `shared/queues.ts`, workers                   |
| `S3_BUCKET`                | `R2_BUCKET`                | `clipfire-uploads`                                                                                   | R2 adapter, `scripts/migrate-s3-to-r2.ts`     |
| `S3_REGION`                | _(removed)_                | R2 is regionless — SDK client uses `region: 'auto'`                                                  | R2 adapter                                    |
| `AWS_REGION`               | _(removed for storage)_    | Same — R2 doesn't use it                                                                             | R2 adapter                                    |
| `AWS_ACCESS_KEY_ID`        | `R2_ACCESS_KEY_ID`         | R2 API token access key                                                                              | R2 adapter, migration script                  |
| `AWS_SECRET_ACCESS_KEY`    | `R2_SECRET_ACCESS_KEY`     | R2 API token secret                                                                                  | R2 adapter, migration script                  |
| _(new)_                    | `R2_ACCOUNT_ID`            | Cloudflare account id (32 hex chars, bottom of R2 dashboard)                                         | R2 adapter (derives endpoint)                 |
| _(new; optional)_          | `R2_ENDPOINT`              | Override: `https://<accountId>.r2.cloudflarestorage.com`                                             | R2 adapter                                    |
| _(new; optional)_          | `R2_PUBLIC_BASE_URL`       | `https://pub-<hash>.r2.dev` if bucket is public; otherwise unset                                     | R2 adapter                                    |
| _(new)_                    | `STORAGE_PROVIDER`         | `r2` (default: `s3`, auto-detected if `R2_ACCOUNT_ID` set)                                           | `shared/lib/storage/index.ts` factory         |
| `S3_TRANSFER_ACCELERATION` | _(removed)_                | R2 doesn't have equivalent; global anycast is baked in                                               | `src/lib/s3-client.ts`                        |
| `UPSTASH_REDIS_REST_URL`   | `UPSTASH_REDIS_REST_URL`   | Same var, new value (Upstash-provided REST URL)                                                      | `src/lib/rate-limit.ts` — UNCHANGED intent    |
| `UPSTASH_REDIS_REST_TOKEN` | `UPSTASH_REDIS_REST_TOKEN` | Same var, new value                                                                                  | `src/lib/rate-limit.ts` — UNCHANGED intent    |

Unchanged (documented so compute-plane doesn't touch them):
`AWS_REGION` may stay in workers that still call SES / other AWS services;
audit that separately. All Gemini / OpenAI / Stripe / Sentry / PostHog vars are
completely untouched by this migration.

## Signup checklist for Austin

One row per manual step. Click, do, paste secret to `.env`.

| #   | Step                                                                                                                   | URL                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | Create Neon account, project `clipfire`, region `us-east-2`, Postgres 16                                               | https://console.neon.tech/signup                                                       |
| 2   | Copy pooled connection string → `DATABASE_URL`                                                                         | Neon → Dashboard → Connection Details → "Pooled connection"                            |
| 3   | Copy direct connection string → `DIRECT_DATABASE_URL`                                                                  | Same page, toggle off "Pooler"                                                         |
| 4   | Create Cloudflare account (if none) + enable R2                                                                        | https://dash.cloudflare.com/sign-up → R2                                               |
| 5   | Create R2 bucket `clipfire-uploads`, region `Eastern North America` (ENAM)                                             | https://dash.cloudflare.com/?to=/:account/r2/new                                       |
| 6   | Create R2 API Token, scope Read+Write to `clipfire-uploads`, note both keys                                            | R2 → Manage R2 API Tokens → Create API token                                           |
| 7   | Note the Cloudflare account ID → `R2_ACCOUNT_ID`                                                                       | Any Cloudflare dashboard page, right sidebar                                           |
| 8   | Enable bucket versioning (for accidental-delete recovery)                                                              | R2 → Bucket → Settings → Versioning: on                                                |
| 9   | Create Upstash Redis database, `Global` type, region `us-east-1` (matches Vercel default)                              | https://console.upstash.com/redis                                                      |
| 10  | Copy TLS TCP endpoint (host + port + password) → `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD`                        | Upstash → Database → Details → REDIS_URL (parse the `redis://user:pass@host:port` URL) |
| 11  | Copy REST URL + token → `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (for rate limiter, separate from BullMQ) | Same page, "REST API" tab                                                              |
| 12  | Set `STORAGE_PROVIDER=r2` in Vercel + Fly.io env                                                                       | (compute-plane will script this)                                                       |

## Migration order + downtime windows

Pre-launch → we can afford full downtime. Sequence:

1. **T-1 day**: Austin completes signup checklist above. Populate secrets in
   1Password. Compute-plane agent stages the new env values in Vercel / Fly.
2. **T-0 hour 0** — dev DB kill: switch every dev instance's `DATABASE_URL` +
   `REDIS_HOST` to `localhost` (docker-compose.local.yml). `docker compose
-f docker-compose.local.yml up -d`. RDS dev instance is now decommissionable.
3. **T-0 hour 1** — Neon restore: run `RDS_URL=... NEON_URL=... scripts/migrate-rds-to-neon.sh`.
   ~5-10 minutes for a 5-20 GB db.
4. **T-0 hour 2** — R2 bulk copy: run `npx tsx scripts/migrate-s3-to-r2.ts
--src-bucket clips-genie-uploads --dst-bucket clipfire-uploads`. Time = video
   volume / bandwidth. ~10 min for 50 GB on a good link. Resumable.
5. **T-0 hour 3** — Compute-plane cutover: Vercel + Fly redeploy with new envs.
   Verify: web loads, upload flow works, presigned playback works, BullMQ
   jobs process, no queue backlog.
6. **T-0 hour 4** — smoke test window. If good, proceed to cost checkout.
7. **T+7 days** — AWS teardown (handled from Austin's other Mac). Destroy the
   Terraform stack: RDS instances, ECS Redis tasks, S3 bucket (after confirming
   R2 has parity via `aws s3 ls` count vs R2 count).

## Backup story per provider

| Provider | Backup mechanism                                    | Retention | RPO      | RTO         |
| -------- | --------------------------------------------------- | --------- | -------- | ----------- |
| Neon     | Continuous WAL to S3, PITR restore                  | 7 days    | ~1 sec   | 5-30 min    |
| Neon     | Nightly `pg_dump` → R2 (belt-and-braces)            | 30 days   | 24 hours | 10-20 min   |
| R2       | Object versioning enabled on bucket                 | forever   | 0        | seconds     |
| R2       | (Optional) Cross-region rclone sync to 2nd bucket   | forever   | 24 hours | seconds     |
| Upstash  | Vendor-managed daily backups to R2                  | 7 days    | 24 hours | support tkt |
| Upstash  | (BullMQ is ephemeral — no additional backup needed) | —         | —        | re-enqueue  |

## Open questions for Austin

1. **Neon region** — confirm `us-east-2` (matches current RDS). If Vercel prod
   runs elsewhere, migrate there to save cross-region latency.
2. **R2 bucket name** — `clipfire-uploads` proposed. OK? (Old bucket is
   `clips-genie-uploads` — legacy branding.)
3. **Neon tier** — start on Launch ($19/mo)? Free tier will run out on the first
   backfill.
4. **Nightly pg_dump destination** — R2 works, but do you want it in a separate
   bucket for airgap? (Recommend yes — `clipfire-backups`.)
