# Clipfire — Pricing Strategy & Rationale

> **Status:** Proposal (not yet implemented). One-pager for investor data room and
> internal pricing decisions. Validate price points against real willingness-to-pay
> (10–15 customer conversations or a Van Westendorp survey) before committing the
> dollar figures to code. The **structural** changes below should be made regardless
> of what the research says.
>
> **Last updated:** 2026-06-11

---

## TL;DR

The current pricing ladder is a clean conventional 3-tier SaaS structure, but it has
four structural flaws that suppress conversion and cap ARPU. The fix: **stop gating on
the LLM provider, meter on upload minutes instead of clips, watermark the free tier,
add an Agency tier + annual billing + overage credits.**

These changes improve all three signals an investor probes on pricing: **ARPU expansion
path, gross-margin story, and a defensible value metric.**

---

## Current structure (as shipped in `shared/lib/plans.ts`)

| | Free | Pro | Business |
|---|---|---|---|
| Price/mo | $0 | $19 | $49 |
| Connected accounts | 2 | 10 | 50 |
| Clips/month | 10 | 100 | 500 |
| Storage | 1 GB | 25 GB | 100 GB |
| LLM | Ollama only | + Gemini | + OpenAI/Anthropic |
| Auto-generate | ❌ | ✅ | ✅ |
| Priority support | ❌ | ❌ | ✅ |

---

## The four structural problems

### 1. Gating on the LLM provider exposes internal plumbing as a paywall
"Ollama vs Gemini vs OpenAI/Anthropic" is an implementation detail. A creator does not
know or care which model scored a clip — they care whether clips perform.

- **Free users get the *worst* output** (local Ollama). First-time users judge the whole
  product by the free tier, so we hand them the weakest result and hope they pay to
  discover it's good. That's backwards and suppresses conversion.
- **"All LLM providers" as a $49 feature is meaningless** to the buyer. Nobody upgrades
  to access Anthropic instead of Gemini.

**Fix:** always use the best available scoring for everyone. Differentiate on *volume,
speed, watermark, and automation* — things the customer actually feels. Quality is never
a paywall; volume is.

### 2. The value metric ("clips/month") doesn't match the cost driver
Cost scales with **source video minutes processed** (transcription + multimodal LLM
scoring), not with clips output. A 3-hour podcast and a 5-minute monologue can both yield
10 clips, but one costs ~30× more to process. A power user can upload 10-hour streams all
month, stay "within plan," and bleed margin.

The entire competitor set (Opus Clip, Vizard, Munch) meters **upload minutes/month** —
the metric that aligns price to both value and cost, and makes us legible in head-to-head
comparisons.

**Fix:** make the primary meter **upload minutes/month**. Optionally run a hybrid:
minutes as the hard cap, clips as the marketing headline.

### 3. "Connected accounts" is mispriced for agencies
Business gives **50 connected accounts for $49.** A social agency managing 50 creator
accounts is the single highest-value customer, charged the same as a solo power user.
Connected accounts is an *agency/team* axis and should be priced as one (per-seat or a
dedicated high tier), not bundled flat.

### 4. No free→paid quality hook, no top tier, no annual
- **Free** has no watermark and no taste of premium. Watermarked free output is itself a
  conversion driver — creators won't post watermarked clips.
- **No tier above $49.** Agencies / high-volume creators will pay $99–$199. ARPU is capped
  at $49 where the costliest, most committed users live.
- **No annual plan.** Annual prepay is the single biggest lever for cash flow and churn
  reduction pre-raise.

---

## Proposed structure

| | Free | Creator | Pro | Agency |
|---|---|---|---|---|
| **Price/mo (monthly)** | $0 | $19 | $39 | $99+ |
| **Price/mo (annual)** | — | $15 | $31 | $79 |
| **Upload minutes/mo** | 60 (watermarked) | 600 | 1,800 | 6,000+ |
| Clips | unlimited from those minutes | same | same | same |
| Connected accounts | 1 | 3 | 10 | 30 (+ seats) |
| Auto-generate | ❌ | ✅ | ✅ | ✅ |
| Watermark | ✅ | removed | removed | removed |
| Scoring quality | **Best model** | Best | Best | Best |
| Team seats | — | — | — | ✅ |
| Support | — | — | Priority | Priority + SLA |

**Plus: overage credits.** Pay-as-you-go minutes when a user exceeds their cap. A hard
block on a paying user is a refund/churn risk; an overage charge is revenue.

### Summary of moves
1. Drop LLM-provider gating — best quality for everyone.
2. Switch the meter from clips → **upload minutes/month**.
3. Watermark the free tier.
4. Add an **Agency** tier ($99+) with seats to capture high-value buyers.
5. Add **annual** billing (~20% discount).
6. Add **overage credits** to capture spikes instead of hard-blocking.

---

## Competitive context

| Tool | Free | Entry | Mid | Top | Meter |
|---|---|---|---|---|---|
| Opus Clip | 60 min/mo, watermark | ~$15 | ~$29 | — | Upload minutes |
| Vizard | 30 min/mo | ~$20 | ~$30 | ~$50 | Upload minutes |
| Klap | — | ~$29 | ~$49 | ~$79 | Upload/exports |

Takeaways: minutes-based metering is the category standard; $19 entry is competitive;
there is clear room (and precedent) for a $79–$99 top tier we currently lack.

> Competitor figures are approximate and move frequently — re-verify before quoting in the
> deck.

---

## Why this matters for the raise

Investors probe pricing for three signals; the redesign improves all three:

1. **ARPU expansion path** — current ladder tops out at $49. Agency + overage + annual
   create visible upside without new product. "We have pricing upside" is a story VCs like.
2. **Gross-margin story** — minutes-based metering + existing per-clip cost instrumentation
   (`CostEvent` / `CostTracker`) + the Gemini→self-hosted distillation roadmap lets us say:
   "We meter on our actual cost driver *and* we're driving that cost toward zero."
3. **Defensible value metric** — "we charge on minutes like the category leaders, but our
   distillation pipeline means our COGS per minute falls over time" differentiates us from
   pure model-wrapper tools.

---

## Implementation notes (when we green-light the build)

Structural code changes required to ship the proposed structure:

- **`shared/lib/plans.ts`** — replace the `llmProviders` gate; add `uploadMinutesPerMonth`,
  `watermark`, `teamSeats`; add the `agency` plan; restructure `checkClipQuota` →
  `checkUploadMinutesQuota` (track processed source minutes per month).
- **Schema** — add a per-month "processed minutes" rollup (or sum from existing
  `CostEvent` / job records) so the quota check has a source of truth.
- **Stripe** — new Price IDs for Creator/Pro/Agency monthly + annual; overage as metered
  billing or a credit pack. (Requires Stripe dashboard access.)
- **Pricing page** (`src/app/pricing/page.tsx`) — new tier cards, annual toggle, watermark
  row, remove the LLM-provider comparison rows.
- **Mobile** — iOS `SubscriptionView.swift` and Android `BillingScreen.kt` plan models.
- **Watermark** — render path needs a watermark flag wired to plan for free-tier output.

> Decision deferred: keep `clips/month` as the meter short-term (low effort) vs. switch to
> `upload minutes/month` (higher effort: schema + Stripe). Recommendation: switch — it's
> the strategically correct metric and the margin narrative depends on it.
