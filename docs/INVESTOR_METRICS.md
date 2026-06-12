# Clipfire — Investor Metrics

> **Status:** Living snapshot. Numbers are not committed manually — they update from the
> admin views linked alongside each row. If you see a `_TODO: pull from …_` cell, that is
> intentional: the doc cites the URL the live number lives on rather than baking in a
> stale figure.
>
> **Companion docs:** [`INVESTOR_READINESS.md`](./INVESTOR_READINESS.md) ·
> [`PRICING_STRATEGY.md`](./PRICING_STRATEGY.md) ·
> [`DISTILLATION_ROADMAP.md`](./DISTILLATION_ROADMAP.md)

---

## 1. Purpose

This doc is the always-on snapshot of the metrics an investor will probe during diligence.
Numbers update from the admin views — they are **not committed manually**. The acceptance
criterion is that every cited figure links back to the specific admin view it is computed
on, so a reviewer can always click through to a live, auditable source.

If a row reads `_TODO: pull from /admin/metrics_`, that is the source of truth — open the
admin view in a separate tab and read the value there. Resist the urge to inline a
month-stale number; investor credibility depends on this doc never being out of date with
the live system.

---

## 2. Top line

| Metric                      | Current value                    | Admin view                                                               | API source                                                                                                       |
| --------------------------- | -------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| MRR (cents)                 | _TODO: pull from /admin/metrics_ | [`/admin/metrics`](../src/app/admin/metrics/page.tsx) → "Today" card     | [`GET /api/admin/metrics`](../src/app/api/admin/metrics/route.ts) → `today.mrrCents`                             |
| ARR (cents)                 | _TODO: pull from /admin/metrics_ | [`/admin/metrics`](../src/app/admin/metrics/page.tsx) → "Today" card     | [`GET /api/admin/metrics`](../src/app/api/admin/metrics/route.ts) → `today.arrCents`                             |
| Active subscriptions        | _TODO: pull from /admin/metrics_ | [`/admin/metrics`](../src/app/admin/metrics/page.tsx) → "Today" card     | [`GET /api/admin/metrics`](../src/app/api/admin/metrics/route.ts) → `today.activeSubscriptions`                  |
| Signups (last 30d)          | _TODO: pull from /admin/metrics_ | [`/admin/metrics`](../src/app/admin/metrics/page.tsx) → MRR history bars | [`GET /api/admin/metrics`](../src/app/api/admin/metrics/route.ts) → `history[*].newSubscriptions` (sum last 30d) |
| Paid conversions (last 30d) | _TODO: pull from /admin/metrics_ | [`/admin/metrics`](../src/app/admin/metrics/page.tsx) → MRR history bars | [`GET /api/admin/metrics`](../src/app/api/admin/metrics/route.ts) → `history[*].newSubscriptions` (sum last 30d) |
| Churn % (last 30d)          | _TODO: pull from /admin/metrics_ | [`/admin/metrics`](../src/app/admin/metrics/page.tsx) → "Today" card     | [`GET /api/admin/metrics`](../src/app/api/admin/metrics/route.ts) → `today.churnPct30d`                          |

The "Today" snapshot is computed from the `User` table directly so a fresh deploy without
rollup rows is not blank; the 30-day history bars come from the `SubscriptionMetric` daily
rollup written by the Stripe webhook handler.

---

## 3. Unit economics

| Metric                            | Current value                  | Admin view                                                                   |
| --------------------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| Cost per upload minute (cents)    | _TODO: pull from /admin/costs_ | [`/admin/costs`](../src/app/admin/costs/page.tsx) → "Cost per upload minute" |
| Gross margin per minute — Creator | _TODO: pull from /admin/costs_ | [`/admin/costs`](../src/app/admin/costs/page.tsx) → margin projector         |
| Gross margin per minute — Pro     | _TODO: pull from /admin/costs_ | [`/admin/costs`](../src/app/admin/costs/page.tsx) → margin projector         |
| Gross margin per minute — Agency  | _TODO: pull from /admin/costs_ | [`/admin/costs`](../src/app/admin/costs/page.tsx) → margin projector         |
| Gross margin % — Creator          | _TODO: pull from /admin/costs_ | [`/admin/costs`](../src/app/admin/costs/page.tsx) → margin projector         |
| Gross margin % — Pro              | _TODO: pull from /admin/costs_ | [`/admin/costs`](../src/app/admin/costs/page.tsx) → margin projector         |
| Gross margin % — Agency           | _TODO: pull from /admin/costs_ | [`/admin/costs`](../src/app/admin/costs/page.tsx) → margin projector         |

Costs are tracked per stage (download / transcription / LLM scoring / FFmpeg render / S3
upload) via the `CostEvent` table — see
[`polemicyst.com/CLAUDE.md` → "Per-clip cost instrumentation"](../CLAUDE.md) for the
architecture. The margin projector divides plan price by `PLANS[*].uploadMinutesPerMonth`
to derive headline price-per-minute, then subtracts the live cost-per-minute aggregate
from the `CostEvent` table.

---

## 4. Plan structure

These are static — the only time they change is during a deliberate pricing revision (see
[`PRICING_STRATEGY.md`](./PRICING_STRATEGY.md)). Pulled from
[`shared/lib/plans.ts`](../shared/lib/plans.ts).

| Plan    | Monthly | Annual (per mo) | Upload minutes / mo | Connected accounts | Watermark | Team seats |
| ------- | ------- | --------------- | ------------------- | ------------------ | --------- | ---------- |
| Free    | $0      | $0              | 60                  | 1                  | Yes       | 1          |
| Creator | $19     | $15             | 600                 | 3                  | No        | 1          |
| Pro     | $39     | $31             | 1,800               | 10                 | No        | 1          |
| Agency  | $99     | $79             | 6,000               | 30                 | No        | 5          |

All tiers receive the same best-in-class scoring quality — quality is no longer gated by
plan (see `checkLlmProviderAccess` in [`shared/lib/plans.ts`](../shared/lib/plans.ts)).
The primary value metric is **source video minutes processed per month**, enforced by
`checkUploadMinutesQuota` against the `UsageMonth` rollup.

> Note: per the inline comments in [`shared/lib/plans.ts`](../shared/lib/plans.ts), the
> dollar amounts and minute caps above remain placeholders pending WTP research, owned by
> the pricing track. The numbers shipped in code are the current best estimate and what
> live billing enforces today.

---

## 5. Activation funnel

The funnel is `signup → first_clip_generated → paid_conversion`. Each event is fired from
PostHog (wired by W013, PR #274) and the stage-to-stage conversion rates are read off the
PostHog dashboard.

| Stage                   | Event name             | Fired from                                                                  | Conversion to next stage                      |
| ----------------------- | ---------------------- | --------------------------------------------------------------------------- | --------------------------------------------- |
| 1. Signup               | `signup`               | `src/app/api/auth/[...nextauth]/route.ts` (`events.createUser`)             | _TODO: pull from PostHog funnel dashboard_    |
| 2. First clip generated | `first_clip_generated` | `src/app/api/trigger-clip/route.ts` (first successful clip per user)        | _TODO: pull from PostHog funnel dashboard_    |
| 3. Paid conversion      | `paid_conversion`      | `src/app/api/webhooks/stripe/route.ts` (on `customer.subscription.created`) | (terminal stage — track downstream retention) |

Auxiliary events (`upload_started`, `subscription_canceled`) feed activation + churn
diagnostics from the same PostHog project.

> Once the PostHog project URL is wired, replace each `_TODO_` cell with a deep link to
> the corresponding PostHog funnel view so an investor can click through.

---

## 6. Training-data flywheel

Defensibility relies on the proprietary training corpus accumulating with every Gemini
call. See [`DISTILLATION_ROADMAP.md`](./DISTILLATION_ROADMAP.md) for the full plan to
collapse external AI cost to ~$0; this table is the live progress meter.

| Task                         | Training table                                   | Volume target (per `CLAUDE.md`) | Current count                                                               | Export endpoint                                                                                                      |
| ---------------------------- | ------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Clip scoring                 | `TrainingExample` (`prisma/schema.prisma`)       | 1,000+ examples                 | _TODO: `SELECT COUNT(*) FROM "TrainingExample"`_                            | [`GET /api/admin/training-data?format=jsonl`](../src/app/api/admin/training-data/route.ts)                           |
| Truth analysis (whole-video) | `TruthTrainingExample` where `type = 'analysis'` | 1,000+ examples                 | _TODO: `SELECT COUNT(*) FROM "TruthTrainingExample" WHERE type='analysis'`_ | [`GET /api/admin/training-data/truth?format=jsonl&type=analysis`](../src/app/api/admin/training-data/truth/route.ts) |
| Analysis chat (multi-turn)   | `TruthTrainingExample` where `type = 'chat'`     | 1,000+ examples                 | _TODO: `SELECT COUNT(*) FROM "TruthTrainingExample" WHERE type='chat'`_     | [`GET /api/admin/training-data/truth?format=jsonl&type=chat`](../src/app/api/admin/training-data/truth/route.ts)     |

Collection is automatic — every production Gemini call is captured via the non-fatal
`TrainingCollector` / `TruthTrainingCollector` accumulators (see "Cross-cutting concerns"
in [`polemicyst.com/CLAUDE.md`](../CLAUDE.md)). No user action is required.

---

## 7. What to ask if a number looks off

A quick triage list for when an investor calls out a metric:

- **If MRR looks low / zero:** check Stripe webhook delivery to
  `/api/webhooks/stripe`. The `SubscriptionMetric` rollup is written by the webhook
  handler; missed deliveries leave gaps in the history bars on
  [`/admin/metrics`](../src/app/admin/metrics/page.tsx). The "Today" card falls back to a
  static `PLANS[*].monthlyPriceDisplay` × active-count derivation so the card is never
  blank — but that fallback will look suspiciously round.
- **If active subscription count looks low:** check the
  `User.subscriptionPlan` filter in
  [`src/app/api/admin/metrics/route.ts`](../src/app/api/admin/metrics/route.ts) — only
  `creator`, `pro`, `agency` (and legacy `business` → agency) are counted. Users on
  `free` are explicitly excluded.
- **If churn % is `0.0%` with non-zero active count:** the rollup has fewer than 30 days
  of history. Churn is computed as `sum(churnedSubscriptions[last 30d]) / (active +
churned)` — sparse history reads as zero churn, not as "no churn happened".
- **If a cohort row is empty (`M0 = 0`):** see the note in
  [`/api/admin/metrics`](../src/app/api/admin/metrics/route.ts): the `User` table does not
  store `createdAt`, so signup buckets use `MIN(UsageMonth.createdAt)` as a signup proxy.
  A user who signed up but never generated usage will not appear in any cohort. This is a
  known limitation — flagged for a follow-up that backfills `User.createdAt`.
- **If cost-per-minute looks too low:** confirm the `CostEvent` table is being flushed by
  the worker. The `CostTracker.flush()` call is non-fatal — failures are logged but never
  crash the pipeline (see "Cross-cutting concerns" in
  [`polemicyst.com/CLAUDE.md`](../CLAUDE.md)). Missed flushes will under-count cost.
- **If training-example counts are flat:** check the `LLM_PROVIDER` env. If it has been
  flipped to `ollama` for cost reasons, Gemini examples stop being collected — this is
  the intended kill-switch in [`DISTILLATION_ROADMAP.md`](./DISTILLATION_ROADMAP.md) but
  it also halts the flywheel.
