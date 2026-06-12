# Investor FAQ

> Pre-emptive answers to the questions a pre-seed / seed investor reliably
> asks during a first conversation. Companion to
> [`INVESTOR_READINESS.md`](./INVESTOR_READINESS.md) (the engineering
> credibility checklist), [`PRICING_STRATEGY.md`](./PRICING_STRATEGY.md)
> (pricing rationale), [`INVESTOR_METRICS.md`](./INVESTOR_METRICS.md) (the
> live-numbers snapshot), and [`DISTILLATION_ROADMAP.md`](./DISTILLATION_ROADMAP.md)
> (the margin story).
>
> **Status:** Draft. Numbers cited live in the admin views, not in this doc —
> see the linked docs for placeholders that hydrate from `/admin/metrics`
> and `/admin/costs`.

---

## Market

### Who is the customer?

Two adjacent segments:

1. **Solo creators and small media operators** who already record long-form
   content (podcasts, livestreams, lectures, talks) and want to repackage it
   into vertical clips for Reels, Shorts, and TikTok without an editor.
2. **Agencies and social teams** managing several creator accounts — same
   workflow, multiplied by N creators, billed on a per-seat axis.

The "Agency" tier in [`PRICING_STRATEGY.md`](./PRICING_STRATEGY.md) was added
specifically because connected-accounts-per-customer was the single
mispriced axis in the original 3-tier ladder.

### Why now?

Three trends converged:

1. **Short-form video is the dominant attention surface** on every major
   platform (Reels, Shorts, TikTok). Long-form creators must repackage or
   die.
2. **Multimodal LLMs are good enough to score what's worth clipping.**
   Gemini Flash's price/quality for video understanding in 2026 is the
   inflection point — a year earlier, a clip-scoring tool was either
   expensive enough to lose money or unreliable.
3. **Distillation is now boring.** Fine-tuning a 7-8B model on a few thousand
   high-quality examples to match a frontier model's behavior is a
   well-trodden path (Unsloth, Axolotl). The 2024 wave of fine-tuning tools
   matured. We can credibly plan a $0-inference future and act on it.

### How big is the market?

Adjacent tools (Opus Clip, Vizard, Munch, Klap) all reported either funding
rounds or revenue numbers in the last 18 months suggesting a few hundred
million dollars of addressable demand at the prosumer tier. The category
isn't a "create the market" story — it's "win the slice that wants better
output and a fairer price."

### Who are the competitors?

| Tool       | Position vs. Clipfire                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Opus Clip  | Largest by reach. Strong brand. Their pricing tops out around $29 — same minute-metered ladder we use, no agency tier. Quality is good but not differentiated; we win on price-per-minute as our COGS drops. |
| Vizard     | Decent product, dated UI. Pricing tops at $50. Similar structure to Opus Clip.                                                                                                                               |
| Munch      | Enterprise-leaning. Annual contracts. Out of the prosumer band.                                                                                                                                              |
| Klap       | Smaller, growing. Annual lever, no agency tier.                                                                                                                                                              |
| Capsho etc | Audio-first; complementary, not competitive on the video-clip job.                                                                                                                                           |

**Our differentiation:** the explicit COGS-down-over-time story
([`DISTILLATION_ROADMAP.md`](./DISTILLATION_ROADMAP.md)) is the single thing
none of them publicly claim. We charge on the same value metric (minutes) as
the category leaders, but our COGS per minute is on a documented trajectory
toward zero. The longer we operate, the wider the margin gap.

---

## Product

### What does the product do today?

See [`README.md`](../README.md) → "What it does." Short version:

- Ingest a YouTube channel / file / URL.
- Transcribe (YouTube captions first, Whisper fallback).
- Score every transcript window with a multimodal LLM (hook strength,
  context, captionability, risk).
- Render portrait / landscape clip variants with captions and overlays.
- Publish to social platforms (currently stubbed per-platform; OAuth flows
  are the next workstream).

Plus a separate **truth-analysis** surface — same scoring infra, different
prompts. Drops a video URL, scores claims for credibility, surfaces
fallacies, lets you chat with the analysis.

### What's the differentiation?

Three things, in order of how an investor probes them:

1. **COGS curve.** We meter on minutes and instrument cost per minute
   (`CostEvent`, `/admin/costs`). The distillation roadmap makes the cost
   per minute fall over time — visible to an investor in the live admin view
   today.
2. **Quality isn't the paywall.** The free tier gets the best available
   model, watermarked. We differentiate on volume, watermark, automation,
   and team seats — not on which provider we route to. This is a different
   posture from every competitor.
3. **Truth analysis as a wedge.** Same scoring pipeline, different surface.
   We can sell the clipping tool to a creator and add the truth-analysis
   surface as a B2B product for media-literacy or research customers later
   without doubling engineering scope.

### What's the moat?

- **Training-data flywheel.** Every Gemini call writes a `TrainingExample`
  (or `TruthTrainingExample`) row. The longer we operate at scale, the better
  the fine-tunable dataset, the harder it is for a model-wrapper competitor
  to catch up on quality + cost.
- **Distillation infrastructure already in place.** The
  `ScoringProvider` port abstracts the LLM. Switching providers is a config
  flip, not a rewrite. We can A/B test our fine-tuned model alongside the
  teacher without rearchitecting.
- **No moat on the UI.** Anyone can clone the web app. Our defensibility is
  the cost curve and the training-data accumulation rate.

### Why this team?

Solo founder, full-stack. Track record evident in the commit history; we
ship at a rate ([velocity dashboard](/changelog), [PR list](https://github.com/austinconnor1836/polemicyst.com/pulls?q=is%3Apr+is%3Amerged))
that surprises specialists.

---

## Numbers

### What's the MRR / ARR right now?

Live in [`/admin/metrics`](https://polemicyst.com/admin/metrics) once the
prod migration runs. The dashboard ships pre-populated with daily rollups
from Stripe webhook events (`SubscriptionMetric` table). See
[`INVESTOR_METRICS.md`](./INVESTOR_METRICS.md) for the snapshot template.

### What's the cost per minute?

Live in [`/admin/costs`](https://polemicyst.com/admin/costs). Every billable
stage (download, transcription, LLM scoring, render, S3 upload) writes a
`CostEvent` row. The margin projector on that page divides total cost by
processed minutes and shows margin per plan.

### What does churn look like?

Live in [`/admin/metrics`](https://polemicyst.com/admin/metrics). Cohort
retention (M0..M5) is computed from `min(UsageMonth.createdAt)` per user as
a signup-time proxy (the `User` model doesn't track `createdAt` natively
yet — a small follow-up). Churn % is derived from
`churnedSubscriptions / activeSubscriptions` per day.

### What runway / burn does this support?

Out of scope for this doc — depends on the round size and operating posture.
The unit-economics story this doc anchors on is: with distillation shipped
(Phase 4 in [`DISTILLATION_ROADMAP.md`](./DISTILLATION_ROADMAP.md)),
inference cost drops to near $0 per minute. Burn is dominated by AWS
compute (already scaled-to-zero on prod workers when idle —
[`AWS_COST_REDUCTION.md`](./AWS_COST_REDUCTION.md)) plus the founder's
salary, which the raise funds.

---

## Risk

### What kills this?

1. **A platform clamping down on automated clipping.** TikTok or YouTube
   could ban accounts that post AI-generated clip dumps. Mitigation: we're
   building toward "creator-driven editing assist" not "spam-the-platforms
   automation" — humans approve each clip in the default flow. The
   auto-generate setting is opt-in.
2. **Gemini API pricing inverting our math.** Today's per-token economics
   work. Google could raise prices. Mitigation:
   [`DISTILLATION_ROADMAP.md`](./DISTILLATION_ROADMAP.md) — the answer is to
   leave Gemini.
3. **Opus Clip / Vizard cutting prices below our COGS floor.** Possible.
   Mitigation: our COGS floor falls over time via distillation. We win the
   long game even if we lose a price war today; better to lose specific
   customers than to lose the company.
4. **Mobile being slow.** iOS and Android are real but not yet at parity
   with web. RevenueCat IAP is deferred (see
   [`INVESTOR_READINESS_LOG.md`](./INVESTOR_READINESS_LOG.md) W023).
   Mitigation: web-first revenue, mobile as a retention tool until IAP
   ships.

### What about content moderation / liability?

- The platform is BYO-content (creators upload their own videos / connect
  their own channels). We don't host user-generated content for public
  discovery; clips render and route back out to platforms the creator chose.
- Privacy + ToS + DMCA pages are real, not placeholders
  ([`/privacy-policy`](https://polemicyst.com/privacy-policy),
  [`/terms-of-service`](https://polemicyst.com/terms-of-service),
  [`/legal/dmca`](https://polemicyst.com/legal/dmca)).
- GDPR delete + export endpoints exist
  ([`/api/user/delete`](https://polemicyst.com/api/user/delete), POST).

### Anything that would blow up in a basic security review?

Documented in [`INVESTOR_READINESS.md`](./INVESTOR_READINESS.md) and in
[`SECURITY.md`](../SECURITY.md). Short list of what's defensive:

- No secrets in the repo (verified via `git log --all` audit).
- Rate limiting on auth + expensive endpoints (`src/lib/rate-limit.ts`).
- Auth uses NextAuth with a unified mobile-aware helper
  (`getAuthenticatedUser`). No raw `getServerSession` in API routes.
- Sentry on web + workers. Crashlytics on mobile.
- `/api/health` checks DB + Redis + S3 with timeouts; returns 503 on
  failure.
- CloudWatch alarms forward to SNS → email
  ([`OPS.md`](./OPS.md)).

---

## Practical asks

### What does a Series A look like for this company?

Beyond this round, the Series A trigger is: distillation Phase 4 shipped
(LLM_PROVIDER=ollama in prod, A/B'd against Gemini at ≥90% agreement),
Agency tier scaling, and at least one non-creator vertical (e.g. media
literacy) validated on the truth-analysis surface. See
[`DISTILLATION_ROADMAP.md`](./DISTILLATION_ROADMAP.md) for the gating
criteria.

### Who does the founder want on the cap table?

Out of scope for this doc; covered in conversation. The technical content
of this doc is what's testable; the strategic fit is what the meeting is
for.

---

## Where to look next

- [`README.md`](../README.md) — product summary
- [`INVESTOR_READINESS.md`](./INVESTOR_READINESS.md) — engineering credibility
  checklist + work-item map
- [`INVESTOR_READINESS_LOG.md`](./INVESTOR_READINESS_LOG.md) — execution
  record (what shipped, what's pending, lessons learned)
- [`INVESTOR_METRICS.md`](./INVESTOR_METRICS.md) — live-numbers snapshot
  template
- [`DISTILLATION_ROADMAP.md`](./DISTILLATION_ROADMAP.md) — Gemini → private
  model timeline + A/B gate + rollback
- [`PRICING_STRATEGY.md`](./PRICING_STRATEGY.md) — pricing rationale +
  competitive context
- [`OPS.md`](./OPS.md) — alarms + on-page response
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — system topology + queue
  architecture + data flow
