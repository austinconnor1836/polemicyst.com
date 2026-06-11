# Tasks: Pricing Restructure

Derived from `plan.md`. `[P]` = parallelizable (disjoint files, no ordering between them).
Each Wave-1 task runs in its own git worktree and pushes its own branch; the orchestrator
integrates in Wave 2.

## Wave 0 — Foundation (sequential, blocks all) — orchestrator

- [ ] **T001 — Plan contract** (`shared/lib/plans.ts`, `src/lib/plans.ts`)
  - `PlanId = free | creator | pro | agency`.
  - New `PlanLimits` (D2): add `uploadMinutesPerMonth`, `watermark`, `teamSeats`; remove
    `llmProviders`.
  - Four plan defs with **placeholder** numbers (`// TODO(pricing)`), incl. annual display.
  - `checkLlmProviderAccess` → permissive (`allowed: true`).
  - Add `checkUploadMinutesQuota(userId, plan?)` reading `UsageMonth`.
  - `resolvePlan`: legacy `business → agency`; keep `checkClipQuota` as deprecated shim.
  - Keep `src/lib/plans.ts` a pure re-export of the new surface.

- [ ] **T002 — Usage meter schema** (`prisma/schema.prisma`, `prisma/migrations/**`)
  - Add `UsageMonth` model (D1) + `User.usageMonths` relation.
  - Hand-write a migration (`npx prisma generate` to validate; no DB in CI container).

> Gate: `npx prisma generate` + `npm run lint` pass, then **commit + push Foundation** to
> `claude/clipfire-investor-readiness-4zb7ev`. Wave-1 worktrees branch from this.

## Wave 1 — Parallel implementation (after Foundation lands)

- [ ] **T010 [P] — Backend API** → branch `claude/pricing-backend`
  - Stripe (D3): per-plan, per-interval price-id resolution + env vars
    `STRIPE_{CREATOR,PRO,AGENCY}_{MONTHLY,ANNUAL}_PRICE_ID`; keep legacy vars mapped.
  - Checkout route accepts `{ planId, interval }`; webhook maps all new price IDs.
  - Migrate quota call sites `checkClipQuota → checkUploadMinutesQuota`
    (`trigger-clip`, `uploads/complete`).
  - Make LLM-provider call sites permissive (`user/llm-provider`, `connected-accounts/*`).
  - Update `ENV_VARS.template`.

- [ ] **T011 [P] — Web pricing/billing UI** → branch `claude/pricing-web-ui`
  - 4-tier cards, **annual/monthly toggle**, watermark row, remove LLM-provider rows.
  - `useSubscription` + billing page reflect minute meters and the new tiers.
  - Checkout button sends `{ planId, interval }` (D3).

- [ ] **T012 [P] — Worker metering + watermark** → branch `claude/pricing-worker`
  - On each processed source video, upsert `UsageMonth.processedMinutes/clipCount`.
  - Apply a watermark overlay to renders when the owner's plan has `watermark: true`
    (resolve plan from `User.subscriptionPlan`); paid tiers unstamped.

- [ ] **T014 [P] — iOS** → branch `claude/pricing-ios`
  - Plan models + `SubscriptionView` show 4 tiers, minute meters; drop LLM-tier copy.

- [ ] **T015 [P] — Android** → branch `claude/pricing-android`
  - `BillingScreen` + `SubscriptionRepository` show 4 tiers, minute meters; drop LLM-tier copy.

## Wave 2 — Integration (sequential) — orchestrator

- [ ] **T020** — Merge `claude/pricing-*` into the feature branch in order
      (backend → web-ui → worker → ios → android), run `prisma generate` + `npm run lint` +
      `npx next build`, fix conflicts/breaks, commit, push. Update PR #255.

## Dependency graph

```
T001 ─┬─> T010 ─┐
      ├─> T011 ─┤
T002 ─┼─> T012 ─┼─> T020
T001 ─┼─> T014 ─┤
      └─> T015 ─┘
```
