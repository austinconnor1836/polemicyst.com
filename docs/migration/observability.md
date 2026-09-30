# Observability — decision doc

Pre-launch, solo, no users. Target: **$0/month** across errors + logs + uptime + metrics.
Buy-up path: linear when we exceed free tiers, no vendor lock-in.

## Chosen stack

| Concern               | Vendor                                                  | Free tier                                                                                               | Buy-up                            |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **Errors**            | **Sentry** (Developer plan)                             | 5k errors, 5M spans, 5GB logs, 50 session replays per month; 1 user                                     | Team plan $26/mo when we outgrow. |
| **Logs**              | **Axiom** (Personal plan)                               | 500 GB/mo data-load compute, 25 GB storage, 30-day retention, 10 GB-hours query compute; no credit card | Team plan ~$25/mo.                |
| **Uptime**            | **Better Stack** (free Uptime tier)                     | 10 monitors at up to 30-second check frequency                                                          | Team plan $29/mo.                 |
| **Metrics**           | **Grafana Cloud** (free tier)                           | 10k active series/mo (metrics), 50 GB logs/mo, 50 GB traces/mo, 14-day retention, 3 users               | Pro plan ~$29/mo.                 |
| **Product analytics** | PostHog (already integrated, out of scope for this doc) | 1M events/mo                                                                                            | pre-existing.                     |

**Total: $0/mo pre-launch. Buy-up ceiling: $80/mo when all four exceed free tier
simultaneously.**

### Quota citations

All quotas above are verbatim from the vendor pricing pages, fetched during doc authoring:

- Sentry — https://sentry.io/pricing/ (Developer plan): "5k errors", "5M spans", "5GB" logs, "50 replays", "Limited to one user".
- Axiom — https://axiom.co/pricing (Personal plan): "500 GB/mo data loading compute", "30-day retention", "10 GB-hours query compute", "25 GB" storage, "Permanent. No credit card required".
- Better Stack — https://betterstack.com/pricing (Free): "10 monitors included" with "30 seconds check frequency". Log ingestion listed under Logs & Traces at "3 GB per month retained for 3 days" (we're not using their logs; Axiom wins there).
- Grafana Cloud — https://grafana.com/pricing/ (Free): "Limited to 10k active series per month", "Limited to 50 GB ingested per month" (each of logs / traces / profiles), "14 days retention", "Limited to 3 active users per month".
- UptimeRobot — https://uptimerobot.com/pricing/ (Free): "50 monitors", "5 min. monitoring interval", 3-month data retention.

---

## Why Sentry over the alternatives

- **Bugsnag** — no free tier for indie use since 2023.
- **Rollbar** — free tier is 5k events but the pricing tier jumps are steep after.
- **Highlight.io** — good tier but younger product; when it goes down, it goes down hard.
- **Self-hosted GlitchTip** — free of cash but not free of time. We need to focus on the
  product, not on operating an errors sink.

Sentry is already a dep in `package.json` (`@sentry/nextjs ^10.57.0`), the Next.js
integration is already in the repo (`sentry.server.config.ts`, `sentry.edge.config.ts`,
`instrumentation.ts`, `instrumentation-client.ts`), and the `changelog/page.tsx` copy
already references "Sentry on web + workers + Firebase Crashlytics on iOS". This is
finishing what's started, not adopting new tech.

## Why Axiom over Better Stack Logs

- **Ingest**: Axiom's 500 GB/mo permanent free allowance beats Better Stack's 3 GB/mo.
  For a pre-launch app running one Next.js + a handful of workers, 3 GB is one bad log
  storm from a paid tier. 500 GB is comfortable through beta.
- **Retention**: Axiom 30-day > Better Stack 3-day.
- **Ergonomics**: APL (Axiom's query language) is Kusto-inspired; anyone who has used
  Datadog / Splunk / Grafana LogQL will be productive fast.

Downside: Axiom's UI is less polished than Better Stack's. We accept that for the
ingest headroom.

## Why Better Stack over UptimeRobot for uptime

- **Check frequency**: Better Stack free = 30-second check. UptimeRobot free = 5-minute
  check. On a broken endpoint you'd rather find out in 30s than 5m, especially during
  the cutover soak.
- **Monitor count**: 10 vs 50. We need ~6 monitors day one (see below), so 10 is enough.
- **Status page**: Better Stack gives one branded status page free; UptimeRobot's free
  status page has ads.

If we ever need 20+ monitors, revisit — UptimeRobot's 50-monitor free tier is
best-in-class.

## Why Grafana Cloud for metrics

- Vercel exposes Prometheus-shaped observability endpoints; Grafana can scrape or accept
  remote-write from Fly + Vercel with minimal wiring.
- 10k active series is more than the app produces today (Node process metrics + BullMQ
  queue depth × N queues + custom counters).
- Grafana OSS is the industry standard visualization tool — every future hire will know it.

---

## What we monitor day one

### Sentry — errors

- **Web** (`src/`) — `@sentry/nextjs` is already wired. The Vercel deploy needs `SENTRY_DSN`
  - `NEXT_PUBLIC_SENTRY_DSN` set.
- **Backend Express** — `backend/lib/sentry.ts` (new in this PR) exports `initSentry()`
  - `sentryErrorHandler` middleware. The compute-plane agent's `backend/index.ts`
    bootstrap calls `initSentry()` first thing and mounts the error handler last.
- **Workers** — `workers/clip-metadata-worker/index.ts` already calls `Sentry.init` at
  line 10. Confirm DSN reaches it via Fly secrets (`flyctl secrets set SENTRY_DSN=... -a clip-worker`).
- **iOS** — Firebase Crashlytics stays. Sentry native iOS SDK is a separate future decision.
- **Alert rules** (Sentry UI):
  - New issue in production → email + Slack (webhook to be added).
  - Regression → email.
  - Spike protection: default (auto).

### Axiom — logs

- **Vercel** — Vercel Log Drains → Axiom endpoint (setup at
  https://vercel.com/dashboard/log-drains). Free-tier feature.
- **Fly (backend + workers)** — Fly has a first-class Axiom log-shipping integration:
  `fly logs` → Axiom via `flyctl logs ship`. Alternative: `axiom-cloud` vector on each Fly
  machine. Prefer the built-in ship.
- **Structured logs** — `pino` is available via `@sentry/nextjs` transitively; if we want
  more structure we'll add `pino` explicitly. Not in scope for this PR.

### Better Stack — uptime

Six monitors day one, all 30-second interval:

1. `GET https://polemicyst.com/api/health` — expect 200, contains `"status":"ok"`.
2. `GET https://polemicyst.com` — expect 200 (marketing page).
3. `GET https://clip-worker.fly.dev/healthz` — expect 200 (worker health port).
4. `GET https://backend.fly.dev/healthz` — expect 200 (Express health port).
5. `GET https://polemicyst.com/.well-known/assetlinks.json` — expect 200, JSON body. Guards
   the Android deep-link regression class.
6. TCP `polemicyst.com:443` — port-open ping.

**Alert routing** — email `aconnor731@gmail.com`. SMS on paid tier only; accept email for now.

### Grafana Cloud — metrics

Day-one dashboards:

- Vercel Metrics (built-in scrape) — request rate, p95 latency, error rate.
- Fly machine metrics (built-in scrape) — CPU, RAM, disk, network out.
- BullMQ queue depth — custom exporter emitting `bullmq_queue_active`, `bullmq_queue_waiting`,
  `bullmq_queue_failed` per queue. Deferred to a follow-up PR — needs code in
  `workers/clip-metadata-worker/index.ts`.

---

## Backup + failure story

### Errors

- Sentry outage → local errors surface in Vercel + Fly logs. `Sentry.init` is a no-op when
  DSN is unset, so we're never blocking on Sentry.

### Logs

- Axiom outage → Vercel + Fly still keep their built-in log storage (24h Vercel, 3d Fly).
  Debug the outage before losing history.

### Uptime

- Better Stack outage → we lose alerting for the duration. Backup: a `cron-job.org` free
  pinger against `/api/health` sending email on non-200. Cheap belt-and-braces.

### Metrics

- Grafana Cloud outage → we lose visualization but not data (Vercel + Fly still emit).
  Debug from the raw dashboards on Vercel + Fly during the outage.

---

## Signup checklist (Austin to execute)

- [ ] **Sentry** → create org `polemicyst`, project `clipfire-web`, project `clipfire-workers`.
      Copy DSNs. Set: - Vercel: `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` (web DSN). - Fly `clip-worker`: `SENTRY_DSN` (workers DSN). - Fly `backend`: `SENTRY_DSN` (workers DSN — or a third project if we want split). - GitHub Actions: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG=polemicyst`, `SENTRY_PROJECT=clipfire-web`.
- [ ] **Axiom** → sign up personal plan, create dataset `clipfire-prod`. Generate ingest
      token. Set on Fly: `AXIOM_TOKEN`, `AXIOM_DATASET=clipfire-prod`. Wire Vercel Log
      Drain (Dashboard → Integrations → Log Drains → Axiom).
- [ ] **Better Stack** → sign up free tier. Add the 6 monitors above. Create status page
      at `status.polemicyst.com` (optional).
- [ ] **Grafana Cloud** → create free stack. Enable Prometheus remote-write from Fly.
      Wire Vercel → Grafana via their integration.
- [ ] Verify: post a test error from `/api/health` (query param `?test=sentry` triggers
      a synthetic error), confirm it lands in Sentry within 30s.

## When we outgrow free tier

Rough triggers:

- **Sentry**: > 5k errors / mo — Team plan $26/mo. Probably a real signal (indicates
  active users hitting bugs).
- **Axiom**: > 500 GB ingest / mo — extremely unlikely pre-100k-DAU. If we hit it, it's
  more likely a runaway log ("log every request body") than actual scale.
- **Better Stack**: > 10 monitors — add UptimeRobot free tier alongside for the 11th+.
- **Grafana Cloud**: > 10k active series — usually the moment we add per-user metrics
  labels. Cut cardinality before paying.

---

## Rate-limiting story (belongs here because it uses Upstash)

Upstash is our observability rate limiter _and_ our BullMQ queue, so a bad Redis outage
takes both down. Mitigations:

- All rate limiters **fail open** — a call to `Ratelimit.limit(key)` in a `try/catch`
  logs the error to Sentry and allows the request.
- BullMQ workers are idempotent on `jobId = feedVideoId` (documented in `CLAUDE.md`). A
  full Upstash outage stops new job intake but doesn't corrupt in-flight state.

Actual rate-limit rules live in [`README.md`](./README.md#rate-limiting--clients-obs).
