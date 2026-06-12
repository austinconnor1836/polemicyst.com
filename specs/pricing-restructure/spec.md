# Spec: Pricing Restructure

**Feature branch:** `claude/clipfire-investor-readiness-4zb7ev`
**Status:** Active
**Source of intent:** `docs/PRICING_STRATEGY.md`
**Created:** 2026-06-11

## Why

The current pricing ladder (Free / Pro $19 / Business $49) has four structural flaws
that suppress conversion and cap ARPU (full rationale in `docs/PRICING_STRATEGY.md`).
This feature implements the **structural** fixes. **Dollar amounts and exact limits are
out of scope here** — they are placeholders owned by a separate pricing/WTP agent. Do not
tune numbers in this work; only build the structure that lets numbers be set in config.

## What (user-visible outcomes)

1. **Quality is never paywalled.** All tiers get the best available scoring. The LLM
   provider is no longer a plan gate.
2. **The value metric is upload minutes/month**, not clips/month. Limits and usage meters
   are expressed in minutes.
3. **Free-tier clip output is watermarked.** Paid tiers are not.
4. **Four tiers exist:** Free, Creator, Pro, Agency — Agency adds team seats and the
   highest limits.
5. **Annual billing** is selectable alongside monthly (≈20% cheaper).
6. **Overage** does not hard-block a paying user mid-work (stub/flag is acceptable in this
   pass; full metered billing can follow).

## Non-goals

- Setting real prices or real minute limits (placeholder values only, clearly marked).
- Building the Stripe **dashboard** objects (Price/Product records) — code reads price IDs
  from env vars; creating those objects is a manual/ops step.
- Full overage metered-billing implementation (flag + structure only).
- Migrating existing subscribers' Stripe subscriptions (handled by ops + webhook mapping).

## Acceptance criteria

- [ ] `PlanId` is `free | creator | pro | agency`; legacy `business` resolves to `agency`,
      legacy `pro` continues to resolve (no crashes for existing rows).
- [ ] `PlanLimits` exposes `uploadMinutesPerMonth`, `watermark`, `teamSeats`; the
      `llmProviders` gate is removed and `checkLlmProviderAccess` is permissive.
- [ ] A `UsageMonth` rollup is the canonical meter for processed minutes; the clip pipeline
      increments it; `checkUploadMinutesQuota` reads it.
- [ ] Quota enforcement call sites use minutes, not clip counts.
- [ ] Free-tier renders carry a watermark; paid renders do not.
- [ ] Checkout accepts `{ planId, interval: 'monthly' | 'annual' }`; the webhook maps all
      new price IDs (monthly + annual) back to the correct `PlanId`.
- [ ] Web pricing page shows 4 tiers, an annual toggle, a watermark row, and no
      LLM-provider rows.
- [ ] iOS and Android plan models/screens reflect the 4 tiers and minute-based meters.
- [ ] `npm run lint` and `npx prisma generate` pass; build attempted.

## Open decisions (resolved in plan.md)

- **Metering source:** new `UsageMonth` rollup (chosen) vs. deriving from existing rows.
- **Legacy plan mapping:** `business → agency`, `pro → pro` (semantics shift, accepted).
