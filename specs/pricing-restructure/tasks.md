# Tasks: Pricing Restructure

Derived from `plan.md`. `[P]` = parallelizable (disjoint files, no ordering between them).
Each Wave-1 task runs in its own git worktree and pushes its own branch; the orchestrator
integrates in Wave 2.

---

## ▶ STATUS / HANDOFF (read this first)

**Last updated:** 2026-06-11 · **Branch:** `claude/clipfire-investor-readiness-4zb7ev` · **PR:** #255 (open, auto-merge OFF, awaiting human review)

**State: ALL TASKS IMPLEMENTED + INTEGRATED + CI-GREEN.** Foundation (T001/T002) and all
five Wave-1 tasks (T010–T015) are merged into the feature branch. Wave-2 integration is
done: merge conflicts in `src/lib/stripe.ts` + `create-checkout-session/route.ts` (T011
strayed into T010's files) were resolved in favor of T010's per-interval implementation.
Local gates all pass: `tsc --noEmit` ✓, `npm run lint` ✓, `npx next build` ✓. Vercel
preview deploy ✓ (Ready).

**To resume:** you must be ON branch `claude/clipfire-investor-readiness-4zb7ev` (a fresh
clone lands on `develop` and will NOT see this work until the PR merges). Run `npm ci` then
`./node_modules/.bin/prisma generate` before building.

**Open follow-ups (NOT done):**

1. **Numbers are placeholders** — every price/limit in `shared/lib/plans.ts` is marked
   `// TODO(pricing)`. A separate pricing/WTP agent owns the real values. Do not invent them.
2. **`uploadMinutesUsed` API gap** — `GET /api/user/subscription` does not yet return the
   user's `UsageMonth.processedMinutes`, so the billing page shows `0 / limit` with a "live
   data coming soon" note. Small backend follow-up.
3. **Mobile unverified** — iOS (T014) + Android (T015) could not be compiled here (no
   Xcode/Android SDK). Need a real build (CI or local) before trusting.
4. **Prod migration** — the `UsageMonth` table needs `prisma migrate deploy` against prod
   when this ships.
5. **Overage credits** — structure only; full metered billing deferred (per spec non-goals).
6. **Stripe dashboard** — the new `STRIPE_*_{MONTHLY,ANNUAL}_PRICE_ID` Price objects must be
   created in the Stripe dashboard and the env vars set (manual ops step).

**Merged agent branches (fully integrated; safe to delete — proxy blocked auto-deletion):**
`claude/pricing-backend`, `claude/pricing-web-ui`, `claude/pricing-worker`,
`claude/pricing-ios`, `claude/pricing-android`.

---

## Wave 0 — Foundation (sequential, blocks all) — orchestrator

- [x] **T001 — Plan contract** (`shared/lib/plans.ts`, `src/lib/plans.ts`)
  - `PlanId = free | creator | pro | agency`.
  - New `PlanLimits` (D2): add `uploadMinutesPerMonth`, `watermark`, `teamSeats`; remove
    `llmProviders`.
  - Four plan defs with **placeholder** numbers (`// TODO(pricing)`), incl. annual display.
  - `checkLlmProviderAccess` → permissive (`allowed: true`).
  - Add `checkUploadMinutesQuota(userId, plan?)` reading `UsageMonth`.
  - `resolvePlan`: legacy `business → agency`; keep `checkClipQuota` as deprecated shim.
  - Keep `src/lib/plans.ts` a pure re-export of the new surface.

- [x] **T002 — Usage meter schema** (`prisma/schema.prisma`, `prisma/migrations/**`)
  - Add `UsageMonth` model (D1) + `User.usageMonths` relation.
  - Hand-write a migration (`npx prisma generate` to validate; no DB in CI container).

> Gate: `npx prisma generate` + `npm run lint` pass, then **commit + push Foundation** to
> `claude/clipfire-investor-readiness-4zb7ev`. Wave-1 worktrees branch from this.

## Wave 1 — Parallel implementation (after Foundation lands)

- [x] **T010 [P] — Backend API** → branch `claude/pricing-backend`
  - Stripe (D3): per-plan, per-interval price-id resolution + env vars
    `STRIPE_{CREATOR,PRO,AGENCY}_{MONTHLY,ANNUAL}_PRICE_ID`; keep legacy vars mapped.
  - Checkout route accepts `{ planId, interval }`; webhook maps all new price IDs.
  - Migrate quota call sites `checkClipQuota → checkUploadMinutesQuota`
    (`trigger-clip`, `uploads/complete`).
  - Make LLM-provider call sites permissive (`user/llm-provider`, `connected-accounts/*`).
  - Update `ENV_VARS.template`.

- [x] **T011 [P] — Web pricing/billing UI** → branch `claude/pricing-web-ui`
  - 4-tier cards, **annual/monthly toggle**, watermark row, remove LLM-provider rows.
  - `useSubscription` + billing page reflect minute meters and the new tiers.
  - Checkout button sends `{ planId, interval }` (D3).

- [x] **T012 [P] — Worker metering + watermark** → branch `claude/pricing-worker`
  - On each processed source video, upsert `UsageMonth.processedMinutes/clipCount`.
  - Apply a watermark overlay to renders when the owner's plan has `watermark: true`
    (resolve plan from `User.subscriptionPlan`); paid tiers unstamped.

- [x] **T014 [P] — iOS** → branch `claude/pricing-ios`
  - Plan models + `SubscriptionView` show 4 tiers, minute meters; drop LLM-tier copy.

- [x] **T015 [P] — Android** → branch `claude/pricing-android`
  - `BillingScreen` + `SubscriptionRepository` show 4 tiers, minute meters; drop LLM-tier copy.

## Wave 2 — Integration (sequential) — orchestrator

- [x] **T020** — Merge `claude/pricing-*` into the feature branch in order
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
