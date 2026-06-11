# Plan: Pricing Restructure

Technical approach for `spec.md`. Read this before touching code.

## Architecture facts (verified)

- **Plan source of truth:** `shared/lib/plans.ts`. `src/lib/plans.ts` is a thin re-export
  shim — keep it a shim.
- **Domain types:** `shared/virality.ts` holds cross-cutting types but `PlanId` currently
  lives in `shared/lib/plans.ts`. Keep `PlanId` there.
- **Stripe:** `src/lib/stripe.ts` reads price IDs from env (`STRIPE_PRO_PRICE_ID`,
  `STRIPE_BUSINESS_PRICE_ID`). `getStripePriceId()` / `planIdFromPriceId()` are the seams.
  Checkout: `src/app/api/stripe/create-checkout-session/route.ts`. Webhook:
  `src/app/api/webhooks/stripe/route.ts`.
- **Quota call sites:** `checkClipQuota` used in `src/app/api/trigger-clip/route.ts` (and
  uploads/complete). `checkLlmProviderAccess` used in `src/app/api/user/llm-provider/route.ts`
  and the `connected-accounts` routes.
- **`User.subscriptionPlan`** is a `String @default("free")`.
- **`FeedVideo` has NO duration field** — so minute metering needs a dedicated source.
- **Render path:** ffmpeg lives in `workers/clip-metadata-worker/index.ts` +
  `shared/util/ffmpegUtils.ts`; clips orchestrated via `shared/services/clip-service.ts`.

## Key decisions

### D1 — Metering source: `UsageMonth` rollup table

New model keyed `(userId, yearMonth)` with `processedMinutes` + `clipCount`. The clip
pipeline increments it once per processed source video (it knows the source duration at
processing time). `checkUploadMinutesQuota` reads the current month's row. This follows the
existing "accumulate + flush" pattern and is index-friendly.

### D2 — Plan contract (the interface every Wave-1 task consumes)

```ts
export type PlanId = 'free' | 'creator' | 'pro' | 'agency';

export interface PlanLimits {
  maxConnectedAccounts: number;
  uploadMinutesPerMonth: number;   // PRIMARY METER (placeholder values)
  maxStorageGb: number;
  watermark: boolean;              // true => stamp free-tier output
  autoGenerateClips: boolean;
  teamSeats: number;               // 1 = solo
  prioritySupport: boolean;
}

// permissive now — quality is not gated
export function checkLlmProviderAccess(provider, plan?): { allowed: true; ... }

// minutes-based; reads UsageMonth
export async function checkUploadMinutesQuota(userId, plan?):
  Promise<{ allowed: boolean; message: string|null; currentUsage: number; limit: number }>;

// legacy: resolvePlan maps 'business' -> agency, unknown -> free
```

`checkClipQuota` stays exported (deprecated, still functional) so nothing breaks until call
sites migrate.

### D3 — Checkout contract (shared by Backend + Web-UI tasks)

`POST /api/stripe/create-checkout-session` body: `{ planId: PlanId; interval?: 'monthly' | 'annual' }`
(defaults `monthly`). New env vars: `STRIPE_{CREATOR,PRO,AGENCY}_{MONTHLY,ANNUAL}_PRICE_ID`.
`planIdFromPriceId` maps all of them (plus legacy vars for back-compat) to a `PlanId`.

### D4 — Numbers are placeholders

Use the proposed values from `docs/PRICING_STRATEGY.md` as placeholders, each marked with
`// TODO(pricing): confirm via WTP`. The pricing agent owns final values. Do not block on them.

## Wave structure & dependencies

```
Wave 0 — FOUNDATION (sequential, blocks everything)  [orchestrator does this]
  T001 plans.ts contract (D2)          ─┐
  T002 UsageMonth schema + migration (D1)─┴─> committed+pushed to feature branch

Wave 1 — PARALLEL [P] (each its own worktree + branch, after Foundation lands)
  T010 Backend API   (depends T001,T002) — Stripe interval + price maps + quota call sites + permissive LLM
  T011 Web pricing UI(depends T001, D3)  — pricing page, annual toggle, watermark row, useSubscription
  T012 Worker meter+watermark (T001,T002)— increment UsageMonth, stamp free-tier renders
  T014 iOS           (depends T001)      — SubscriptionView + plan models
  T015 Android       (depends T001)      — BillingScreen + SubscriptionRepository

Wave 2 — INTEGRATION (sequential)  [orchestrator]
  T020 merge branches, prisma generate, lint, build, fix, push
```

T013 (quota call-site migration) is folded into **T010** to keep all backend edits in one
branch and avoid a cross-agent contract split.

## File ownership map (prevents parallel collisions)

| Task      | Owns (writes)                                                                                                                                                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T001/T002 | `shared/lib/plans.ts`, `src/lib/plans.ts`, `prisma/schema.prisma`, `prisma/migrations/**`                                                                                                                                                      |
| T010      | `src/lib/stripe.ts`, `src/app/api/stripe/**`, `src/app/api/webhooks/stripe/**`, `src/app/api/trigger-clip/**`, `src/app/api/uploads/complete/**`, `src/app/api/user/llm-provider/**`, `src/app/api/connected-accounts/**`, `ENV_VARS.template` |
| T011      | `src/app/pricing/page.tsx`, `src/hooks/useSubscription.ts`, `src/app/billing/page.tsx`, landing pricing summary in `src/app/page.tsx`                                                                                                          |
| T012      | `workers/clip-metadata-worker/index.ts`, `shared/util/ffmpegUtils.ts`, `shared/services/clip-service.ts`                                                                                                                                       |
| T014      | `ios/Sources/ClipfireiOS/Features/Subscription/**`, `ios/.../Models/Models.swift`, `ios/.../ConnectedAccounts/**` (plan refs only)                                                                                                             |
| T015      | `android/.../ui/screens/billing/**`, `android/.../data/repository/SubscriptionRepository.kt`                                                                                                                                                   |

No two Wave-1 tasks write the same file. T011 and T010 share the **checkout contract (D3)**
but touch different files.

## Validation gate (every task)

- `npx prisma generate` (after schema changes) — must succeed.
- `npm run lint` — must pass on touched TS.
- `npx next build` — attempt; report env-related failures rather than silently passing.
- Mobile tasks: ensure the plan-id enum compiles; full native build is best-effort.
