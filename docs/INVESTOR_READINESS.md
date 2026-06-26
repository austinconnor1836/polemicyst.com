# Clipfire — Investor-Readiness Assessment

> **Status:** Draft for parallel-execution planning. Source-of-truth for the work-item
> dependency graph used to drive an AFK fleet of implementation agents.
>
> **Created:** 2026-06-11 · **Companion:** [`PRICING_STRATEGY.md`](./PRICING_STRATEGY.md)

---

## Purpose

Get Clipfire from "working product" to "credible pre-seed/seed pitch" by closing the
specific gaps an investor probes for during diligence — **without** burning weeks of
sequential founder time. The work items below are scoped so they can be fanned out to
parallel implementation agents with **disjoint file ownership** and a clear dependency
graph.

This is NOT a pitch deck and NOT a fundraise checklist. It is the **engineering work
list** that makes the eventual deck defensible.

---

## What investors probe

These are the conversations VCs reliably have at pre-seed/seed for a B2C-leaning SaaS:

| Signal                    | Question                                                             | What we need to show                                                                 |
| ------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Product**               | "Show me the product working."                                       | Live demo with no console errors, no broken pages, no placeholder copy.              |
| **Activation**            | "What's your time-to-first-value? How many signups generate a clip?" | Tracked funnel from signup → first clip, with concrete cohort numbers.               |
| **Retention**             | "What's W4 retention? Are paying users still active 90 days later?"  | Cohort retention dashboard.                                                          |
| **Monetization**          | "Why this pricing? What's MRR, ARR, churn?"                          | Pricing rationale (✓ done in `PRICING_STRATEGY.md`) + revenue dashboard.             |
| **Unit economics**        | "What's your gross margin per user? Where does it go with scale?"    | Cost-per-minute story + Gemini → distillation roadmap with timeline.                 |
| **Defensibility**         | "What stops a fast follower?"                                        | Training-data flywheel, model distillation roadmap.                                  |
| **Security / Compliance** | "Anything that would blow up in a basic security review?"            | No leaked secrets, real privacy policy, GDPR delete + export, rate limiting.         |
| **Ops maturity**          | "How do you know when prod is broken?"                               | Error tracking (Sentry), real health check, CloudWatch alarms, crash reporting.      |
| **Mobile**                | "Is iOS/Android actually shipped, or just a screenshot?"             | TestFlight + Play Store live, IAP working, feature parity table.                     |
| **Team / Velocity**       | "How fast can you ship?"                                             | CI gates that match reality (✓ recently fixed via PR #257), tests on critical paths. |

---

## Present state — one-paragraph per category

(Distilled from 10 parallel codebase surveys run 2026-06-11. File:line citations live in
the per-work-item specs below.)

1. **Pricing & monetization** — Structural overhaul **merged** (PR #255: 4 tiers, annual
   billing, minutes-based metering, watermark, permissive LLM). Numbers are placeholders
   pending WTP research. `uploadMinutesUsed` not yet returned by `/api/user/subscription`,
   so the billing meter shows `0 / limit`. Stripe Price IDs not yet created in the
   dashboard.
2. **Analytics & telemetry** — **No SDK installed.** No PostHog/Mixpanel/Amplitude.
   No signup/activation/conversion events tracked anywhere. Only operational telemetry
   exists (`CostEvent`, `JobLog`).
3. **Error tracking & uptime** — **No Sentry/Datadog/Rollbar.** `/api/health` returns
   static `{status:'ok'}` with zero dependency checks. Zero CloudWatch alarms beyond the
   $150/month budget alert. Android has Firebase Crashlytics wired; **iOS does not**.
4. **Auth & security** — NextAuth multi-provider is clean. `getAuthenticatedUser()` is
   consistently used. **No rate limiting** anywhere. **No GDPR user-delete or
   data-export endpoint.** No email-change revalidation. Secrets in `.env`/`.env.local`
   are local-only and properly gitignored (verified: never committed).
5. **Onboarding & activation** — Post-signup, users land on `/connected-accounts` to an
   empty state. **No guided checklist, no demo content, no time-to-first-value
   tooling.** 3 separate dialogs + 2 OAuth flows from signup to first clip.
6. **Landing & pricing pages** — Pricing page reflects the new 4-tier structure cleanly.
   Homepage hero copy is concrete. **Brand name is inconsistent** ("Polemicyst" in hero,
   "Clipfire" in footer + FAQ). `layout.tsx` `<meta description>` is `"Founder of
Polemicyst."` and `og:description` is `"Founder of Tyromaniac."` — both wrong for a
   SaaS. **No demo video, screenshot, or social proof on homepage.**
7. **Compliance & legal** — Privacy policy + ToS are **real content**. **No cookie
   banner.** **No age gate / COPPA disclosure.** **No DMCA contact.** Privacy policy
   does NOT disclose Stripe, S3, or that user data may train internal models (despite
   the `TrainingExample` + `TruthTrainingExample` tables actively collecting).
8. **Demo polish** — 3 hard-coded localhost fallbacks in production code paths. ~10
   `console.log` calls in the reactions editor + connected-accounts page (visible if an
   investor opens DevTools). 4 unlinked personal-project routes (`/clips-genie`,
   `/sushi-go`, `/donation-splitter`, plus a publicly-accessible `/design-system`) are
   dead weight from when the repo was `polemicyst.com`.
9. **Investor data room artifacts** — `/admin/costs` exists but its margin projector is
   broken (still uses old clip-based math). **No `/admin/metrics` view** for MRR/ARR/
   churn/cohorts. No `INVESTOR_METRICS.md` one-pager. The Gemini→distillation roadmap
   exists narratively in `CLAUDE.md` + `LLM_SYSTEM.md` but has no ROI model or timeline.
10. **Mobile parity** — iOS has Stitch + Publish flows; Android does not. Both apps
    show subscription state but **neither can complete a purchase in-app** —
    showstopper for App Store/Play Store approval. App Store screenshots missing. iOS
    `CURRENT_PROJECT_VERSION` hardcoded; Android reads `version.json`.

---

## Work items

Each item has a stable ID, file-ownership statement, dependency list, and acceptance
criteria. **The file-ownership map prevents parallel collisions** — no two items in the
same wave write the same file.

> Convention: `W###` is the item ID. `[P]` = parallelizable within its wave. `[HUMAN]` =
> requires user input that this AFK loop can't synthesize (secrets, screenshots, business
> decisions). `[DEFERRED]` = recognized but out of AFK scope.

### Group A — Demo Hygiene (low risk, high investor-perception impact)

#### W001 [P] · Brand consistency + SEO metadata sweep

- **Owns:** `src/app/page.tsx`, `src/app/pricing/page.tsx` (FAQ row only),
  `src/app/layout.tsx`, `public/og-image.jpg` (new).
- **Depends on:** none.
- **Scope:** Replace "Polemicyst" with "Clipfire" in user-visible hero/subhero copy.
  Rewrite `layout.tsx` `<meta description>` (currently `"Founder of Polemicyst."`) and
  `og:description` (currently `"Founder of Tyromaniac."`) to product-focused copy. Add a
  1200×630 `og-image.jpg` placeholder. Update `<title>` to product-focused.
- **Accept:** Grep `src/app` for `Polemicyst` returns 0 user-visible occurrences (admin
  routes & ARCHITECTURE references can stay). `layout.tsx` meta is product-focused.
  `npm run lint` + `npx next build` pass.

#### W002 [P] · Strip demo-blowup console noise + localhost fallbacks

- **Owns:** `src/app/reactions/[id]/page.tsx`, `src/app/connected-accounts/page.tsx`,
  `src/app/api/feedVideos/[id]/generate-metadata/route.ts`,
  `shared/lib/metadata-generation.ts`.
- **Depends on:** none.
- **Scope:** Remove 6 `console.log` calls in reactions editor (lines 328, 364, 401, 413,
  443, 738). Remove 3 in connected-accounts (lines 231, 236, 436). Remove
  `|| 'http://localhost:3001'` and `|| 'http://localhost:11434'` fallbacks — throw a
  clear error if the env var is unset instead of silently calling localhost in prod.
- **Accept:** `grep -rE "console\.log\(" src/app/reactions src/app/connected-accounts`
  returns 0 lines. `grep -E "localhost:(3001|11434)"` in the three files returns 0.
  Lint + build pass.

#### W003 [P] · Delete personal-project leftover routes

- **Owns:** `src/app/clips-genie/` (delete), `src/app/sushi-go/` (delete),
  `src/app/donation-splitter/` (delete), `src/app/design-system/` (gate behind
  `NEXT_PUBLIC_ADMIN_EMAIL` middleware check OR delete).
- **Depends on:** none.
- **Scope:** Verify none are referenced from production navigation or sitemap. Delete.
  For `/design-system`, decision: gate behind admin (preferred for design ref) or delete.
- **Accept:** Routes return 404. Lint + build pass. Sitemap (if any) doesn't reference
  them. `/design-system` either 404s or requires admin auth.

### Group B — Trust & Safety (compliance + auth)

#### W004 [P] · GDPR user-delete + data-export endpoints

- **Owns:** `src/app/api/user/delete/route.ts` (new), `src/app/api/user/export/route.ts`
  (new), `src/app/settings/_components/DangerZone.tsx` (new, optional UI).
- **Depends on:** none.
- **Scope:** `POST /api/user/delete` (auth required) cascade-deletes all rows for the
  authed user across User, Account, VideoFeed, FeedVideo, Video, Composition,
  Segment, Clip, CostEvent, JobLog, TrainingExample, TruthTrainingExample, AnalysisChat,
  AnalysisChatMessage, UsageMonth. `POST /api/user/export` returns a JSON dump of the
  same. Both must be idempotent + return 204/200 with `{ok:true}`.
- **Accept:** Unit/integration test deletes a seeded user + asserts row counts are 0
  post-delete across all tables. Export endpoint round-trips. `npx prisma generate`
  passes. No orphan-FK violations.

#### W005 [P] · Privacy policy + ToS update (third-party disclosure, training data, DMCA, age)

- **Owns:** `src/app/privacy-policy/page.tsx`, `src/app/terms-of-service/page.tsx`,
  `src/app/legal/dmca/page.tsx` (new).
- **Depends on:** none.
- **Scope:** Privacy policy explicitly lists processors: **Stripe (billing), S3
  (storage), Google Gemini (AI scoring + analysis), Faster-Whisper (transcription),
  Google/Apple/Facebook/Twitter/Bluesky (OAuth)**. Add a "Data used to improve our
  models" section disclosing `TrainingExample`/`TruthTrainingExample` collection with
  opt-out path described. ToS adds DMCA section pointing to `/legal/dmca` page (form +
  contact email).
- **Accept:** Pages render. Privacy policy mentions Stripe + S3 + training data + opt-out
  language. DMCA page exists with a form or `dmca@clipfire.app` contact. Lint + build.

#### W006 [P] · Cookie consent banner

- **Owns:** `src/components/CookieBanner.tsx` (new), `src/app/layout.tsx` (mount only —
  coordinate with W001 since both touch layout.tsx).
- **Depends on:** **W001** (file collision on `src/app/layout.tsx` — must merge after).
- **Scope:** Lightweight client component, dismissible, stores consent in
  `localStorage`. Discloses analytics cookies (so this is a prerequisite for W010).
- **Accept:** Banner renders for un-consented users, hides after dismiss, persists. No
  layout shift after page hydration.

#### W007 [P] · Rate limiting on auth + expensive endpoints

- **Owns:** `src/lib/rate-limit.ts` (new), `src/middleware.ts` (extend, NO route
  collisions in middleware — current file only does auth allowlist).
- **Depends on:** none.
- **Scope:** Use `@upstash/ratelimit` + Upstash Redis (or in-memory fallback for dev).
  Apply: 10/min/IP on mobile-auth routes, 30/min/user on `/api/trigger-clip` +
  `/api/uploads/complete`, 60/min/IP on `/api/health`. On limit hit, return 429 with
  `Retry-After`.
- **Accept:** Hitting one endpoint 100 times in a tight loop returns 429s after the
  threshold. Lint + build.

#### W008 [P] · Age gate at signup (COPPA defense)

- **Owns:** `prisma/schema.prisma` (add `User.dateOfBirth` or `User.acceptedAgeGate
Boolean`), migration, `src/app/auth/signin/SignInClient.tsx`, `src/app/api/auth/[...nextauth]/route.ts`.
- **Depends on:** none.
- **Scope:** Add a checkbox "I am 13 or older" to sign-in page (and mobile signin).
  Store on User. Reject signup if false. Schema change must follow the
  `prisma migrate dev` rule (NEVER `db push`).
- **Accept:** New schema column exists with migration file. UI blocks signup without
  checkbox. Existing users are grandfathered.

### Group C — Observability & Ops

#### W009 [P] · Sentry — Next.js web + workers + iOS

- **Owns:** `package.json` (deps), `sentry.client.config.ts` (new),
  `sentry.server.config.ts` (new), `sentry.edge.config.ts` (new),
  `next.config.js` (wrap with `withSentryConfig`), `workers/clip-metadata-worker/index.ts`
  (init), `ios/Sources/ClipfireApp/App.swift` (Crashlytics OR sentry-cocoa — pick one).
- **Depends on:** none.
- **Scope:** Wire `@sentry/nextjs` for web + edge. Init `@sentry/node` in each worker
  entrypoint. iOS: add Firebase Crashlytics (matches Android) OR sentry-cocoa.
- **Accept:** Throwing a test error in dev results in a Sentry event (or local log if
  DSN unset). DSN comes from env. No crashes on missing DSN.

#### W010 [P] · Real `/api/health` (DB + Redis + S3)

- **Owns:** `src/app/api/health/route.ts`.
- **Depends on:** none.
- **Scope:** Replace static `{status:'ok'}` with: `prisma.$queryRaw\`SELECT 1\``+ Redis
PING (use existing BullMQ Redis client) + S3`HeadBucket`(existing`S3StorageAdapter`). Return `{status, db, redis, s3, timestamp}`. 503 if any fail.
- **Accept:** Healthy stack returns 200 with three `"ok"`. Stop Redis locally → endpoint
  returns 503 with `redis: "down"`.

#### W011 [P] · CloudWatch alarms + SNS notifications

- **Owns:** `infrastructure/alarms.tf` (new), `infrastructure/locals.tf` (extend with
  `alarm_email` var).
- **Depends on:** **[HUMAN]** confirmation that `aconnor731@gmail.com` is the alarm
  destination + AWS credentials for `terraform apply`.
- **Scope:** Alarms for: ECS task failure rate > N, web 5xx rate > 1%/5min,
  worker job failure rate > 5/5min, ALB target health < 1 healthy, RDS connection count
  > 80% max. Wire to SNS topic → email subscription.
- **Accept:** `terraform plan` shows alarms + SNS. (Apply is gated on user.)

#### W012 [P] · iOS version-from-version.json + Fastlane bump

- **Owns:** `ios/project.yml`, `ios/scripts/sync-version.sh` (new),
  `ios/fastlane/Fastfile` (`promote` lane).
- **Depends on:** none.
- **Scope:** Add an Xcode pre-build script that reads `version.json` and writes
  `CFBundleShortVersionString` + `CFBundleVersion`. Update Fastlane `promote` lane to
  call it before TestFlight upload. Mirrors Android's `GITHUB_RUN_NUMBER` pattern.
- **Accept:** Local `xcodegen generate && xcodebuild build …` produces an `Info.plist`
  with the version from `version.json`. CI `promote-ios.yml` doesn't regress.

### Group D — Analytics & Activation

#### W013 [P] · PostHog SDK + 5 core conversion events

- **Owns:** `package.json` (deps), `src/lib/posthog.ts` (new),
  `src/app/StoreProvider.tsx` (mount client),
  `src/app/api/auth/[...nextauth]/route.ts` (signup event in `events.createUser`),
  `src/app/api/trigger-clip/route.ts` (first-clip-generated event),
  `src/app/api/webhooks/stripe/route.ts` (paid-conversion + churn events).
- **Depends on:** **W006** (cookie consent — required before tracking) for web. Backend
  Stripe-webhook event is server-side & doesn't need consent.
- **Scope:** `posthog-js` on the client, `posthog-node` on the server. Identify users by
  `user.id`. Events: `signup`, `first_clip_generated`, `paid_conversion`,
  `subscription_canceled`, `upload_started`. Server-side from API routes; client-side
  only after consent.
- **Accept:** Local PostHog cloud instance receives the 5 events while running the
  flows end-to-end. No PostHog calls fire if `NEXT_PUBLIC_POSTHOG_KEY` is unset.

#### W014 [P] · Onboarding checklist on /connected-accounts

- **Owns:** `src/app/connected-accounts/_components/OnboardingChecklist.tsx` (new),
  `src/app/connected-accounts/page.tsx` (mount only — keep change tiny).
- **Depends on:** none.
- **Scope:** Collapsible 4-step checklist: ✓ Account created · □ Connect a source · □
  Wait for ingestion · □ Generate first clip. State persisted in `localStorage` until
  W013's PostHog identity is wired (later upgrade). Dismissible.
- **Accept:** First-load shows checklist. Connecting a source ticks step 2. Dismisses
  and stays dismissed across reloads.

#### W015 [P] · Show polling progress + ETA after connecting a feed

- **Owns:** `src/app/connected-accounts/_components/PollingStatusBanner.tsx` (new),
  `src/app/api/connected-accounts/[feedId]/poll-status/route.ts` (new),
  `src/app/connected-accounts/page.tsx` (mount only — coordinate with W014 on this file
  via clear non-overlapping edit regions).
- **Depends on:** **W014** (file collision on `connected-accounts/page.tsx` — merge
  after).
- **Scope:** After connecting a feed, render a banner: "Checking YouTube… videos
  usually appear in 1–5 minutes." Poll `/poll-status` every 5s.
- **Accept:** Banner appears after feed connect. Disappears once first FeedVideo lands.

### Group E — Investor Data Room

#### W016 [P] · Fix margin projector for minute-based pricing

- **Owns:** `src/app/admin/costs/page.tsx`, `src/app/api/admin/costs/route.ts`.
- **Depends on:** none. (Reads `shared/lib/plans.ts` but doesn't write it.)
- **Scope:** Replace hardcoded clips-per-month math with `PLANS[*].uploadMinutesPerMonth`
  - avg cost per minute (derived from `CostEvent` aggregates). Show: "Cost per upload
    minute: $X · Margin per minute at Plan Y: $Y · Plan gross margin %: Z%".
- **Accept:** Page renders with minute-based numbers. Manual sanity: 600 min \* $X/min
  vs $19 monthly Creator plan matches the displayed margin.

#### W017 [P] · `/admin/metrics` dashboard (MRR, ARR, churn, cohort)

- **Owns:** `src/app/admin/metrics/page.tsx` (new),
  `src/app/api/admin/metrics/route.ts` (new),
  `prisma/schema.prisma` (add `SubscriptionMetric` rollup table — schema change requires
  migration via `prisma migrate dev`).
- **Depends on:** none.
- **Scope:** Daily rollup table populated by Stripe webhook (extend
  `src/app/api/webhooks/stripe/route.ts` — coordinate with W013 which also touches this
  file via clearly separated edit regions OR sequence W013 → W017). Dashboard renders:
  MRR over time, customer count by plan, churn %, monthly cohort retention table.
- **Depends on (soft):** **W013** (collision on `stripe/route.ts`).
- **Accept:** Stripe webhook event seeds the rollup. Dashboard renders with current
  numbers. Gated behind `isAdmin`.

#### W018 [P] · `uploadMinutesUsed` returned by `/api/user/subscription`

- **Owns:** `src/app/api/user/subscription/route.ts`,
  `src/app/billing/page.tsx` (UI swap from "live data coming soon" to real value),
  `ios/Sources/ClipfireiOS/Features/Subscription/*` (model field add),
  `android/.../data/repository/SubscriptionRepository.kt` (field add).
- **Depends on:** none. (`UsageMonth` table exists from PR #255.)
- **Scope:** Query the current month's `UsageMonth` row for the authed user; include
  `uploadMinutesUsed` in the response shape. Update web + mobile to display.
- **Accept:** A user with N processed minutes sees `N / 600` (or their plan limit) on
  billing page. iOS/Android display the same.

#### W019 [P] · `INVESTOR_METRICS.md` template + distillation ROI model

- **Owns:** `docs/INVESTOR_METRICS.md` (new), `docs/DISTILLATION_ROADMAP.md` (new).
- **Depends on:** **W016** (margin projector working) + **W017** (metrics endpoint
  exists) — so the doc can quote real numbers.
- **Scope:** `INVESTOR_METRICS.md` = top line (MRR/ARR/users), unit econ (cost/minute,
  margin per plan), training-data progress (N examples per task type). Pulls from
  `/admin/metrics` and `/admin/costs`. `DISTILLATION_ROADMAP.md` = timeline +
  before/after Gemini-cost model + risk/rollback.
- **Accept:** Docs exist. Numbers cited link back to specific admin views. No fabricated
  metrics.

### Group F — Mobile

#### W020 [P] · iOS Crashlytics or sentry-cocoa

- **Folded into W009** to keep iOS observability work atomic. Listed here for
  visibility in the mobile group.

#### W021 [P] · iOS Sentry/Crashlytics init — covered by W009.

#### W022 [HUMAN] · App Store + Play Store screenshots + description copy

- **Owns:** `ios/fastlane/metadata/en-US/*` (screenshots + description),
  `android/fastlane/metadata/android/en-US/*`.
- **Depends on:** real screenshots from the running app (founder action).
- **Scope:** 5–6 screenshots per store (signin → feeds → clip detail → stitch editor →
  publish). Updated description copy that mirrors the homepage hero (consistent post-W001).
- **Accept:** Stores show the screenshots in the next build. **This item is HUMAN-gated
  because I can't generate authentic product screenshots without a running device.**

#### W023 [DEFERRED] · iOS/Android in-app subscriptions (RevenueCat)

- **Why deferred:** Multi-week integration, requires RevenueCat account + secret,
  Apple/Google IAP product registration, App Store + Play Store re-review. **Genuine
  blocker for store approval, but NOT an AFK item.** Capturing here so it doesn't fall
  out of the plan. Should be its own SKDW pass after this fleet lands.

#### W024 [P] · Wire Publish into Clips + Reactions (iOS)

- **Owns:** `ios/Sources/ClipfireiOS/Features/Clips/ClipsFeature.swift`,
  `ios/Sources/ClipfireiOS/Features/Reactions/ReactionsFeature.swift`,
  small additions to `VideoPublishSheet` view-model bindings.
- **Depends on:** none. (`VideoPublishSheet` is already generic per session
  `2026-06-11-1545.md`.)
- **Scope:** Add a "Publish" overflow action on each Clip + Reaction row. Construct
  `VideoPublishSheet.VideoSource` from the row's data. Open the existing sheet.
- **Accept:** Tapping Publish from Clips/Reactions opens the sheet pre-filled. Send
  flows through the stub publish endpoint successfully.

#### W025 [DEFERRED] · Android Stitch + Publish feature

- **Why deferred:** Stitch is a multi-thousand-line iOS-only feature using
  `AVMutableComposition` + `VNGeneratePersonSegmentationRequest`. Porting requires
  designing the Android equivalent (Media3 + MLKit) and is genuinely a multi-week
  initiative. Track separately.

### Group G — Pricing follow-ups (already-spec'd; small scoped items)

#### W026 [HUMAN] · Stripe Price IDs in dashboard + env

- **Why HUMAN:** Requires Stripe dashboard access. Cannot be automated from code.
- **Owns:** None (config).
- **Scope:** Create the 6 Price objects (Creator/Pro/Agency × Monthly/Annual). Paste IDs
  into prod env: `STRIPE_{CREATOR,PRO,AGENCY}_{MONTHLY,ANNUAL}_PRICE_ID`.

#### W027 [HUMAN] · Prod `UsageMonth` migration deploy

- **Why HUMAN:** `prisma migrate deploy` against prod DB requires AWS access + manual
  ECS task run (per `docs/NEXT_STEPS.md`).
- **Scope:** Run the existing migration from PR #255 against prod RDS.

#### W028 [DEFERRED] · Real social-platform posting (Twitter / Bluesky / YouTube / Instagram / TikTok)

- **Why deferred:** Each platform is its own multi-day integration with credentials,
  workers, retry logic, and rate-limit handling. Currently stubbed in
  `src/app/api/publish/video/route.ts`. **NOT a single work item** — should be split
  into W028a (Twitter), W028b (Bluesky), etc., and each scheduled as its own SKDW item
  after this fleet lands. Twitter + Bluesky are easiest (~3 days each).

---

## File-ownership map (collision audit)

| File                                   | Items                                       | Resolution                                                                                                                            |
| -------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/layout.tsx`                   | W001 (meta), W006 (banner mount)            | W006 depends on W001 — merge after.                                                                                                   |
| `src/app/connected-accounts/page.tsx`  | W014 (checklist mount), W015 (banner mount) | W015 depends on W014.                                                                                                                 |
| `src/app/api/webhooks/stripe/route.ts` | W013 (PostHog events), W017 (rollup write)  | W017 depends on W013.                                                                                                                 |
| `prisma/schema.prisma`                 | W008 (age col), W017 (`SubscriptionMetric`) | Both add additive columns/tables. Run sequentially in Wave 2 to avoid migration-file race; second agent writes a follow-on migration. |
| `src/app/page.tsx`                     | W001 (brand)                                | Single owner.                                                                                                                         |
| `src/app/pricing/page.tsx`             | W001 (FAQ brand)                            | Single owner; tiny touch.                                                                                                             |
| `src/app/admin/costs/page.tsx`         | W016                                        | Single owner.                                                                                                                         |
| `src/app/admin/costs/route.ts` (API)   | W016                                        | Single owner.                                                                                                                         |
| `src/app/billing/page.tsx`             | W018                                        | Single owner.                                                                                                                         |
| `package.json`                         | W009 (sentry), W013 (posthog)               | Both add deps; run sequentially in Wave 1 to avoid lockfile race, or merge in Wave 2 with `npm install` re-run.                       |

All other items write disjoint paths.

---

## Dependency graph

```
                    Wave 0 (none — none needed)
                              │
        ┌────────┬────────┬───┴────┬────────┬────────┬────────┐
        ▼        ▼        ▼        ▼        ▼        ▼        ▼
       W001    W002    W003    W004    W005    W007    W008
     (brand) (cleanup)(dead) (gdpr) (legal)(rate)  (age)
        │
        │
        ▼
       W006 ─────────────┐
     (cookies)           │
                         ▼
                       W013 ────────────────┐
                     (posthog)              │
                                            ▼
                       W014                W017
                     (checklist)         (metrics)
                         │                  │
                         ▼                  │
                       W015                 │
                     (polling)              │
                                            │
       W009 W010 W011 W012 W016 W018 ──────┤
       (sentry)(health)(alarms)(ios-ver) (margin)(usage)
                                            ▼
                                          W019
                                       (investor docs)

       W024 (publish wiring, iOS) — independent
       W022 [HUMAN] — gated on user-supplied screenshots
       W011 [HUMAN-soft] — needs aws creds to apply, but tf can be written

       W023 W025 W026 W027 W028 — DEFERRED or HUMAN-only
```

---

## Parallelization waves

### Wave 1 — fully parallel, no dependencies, AFK-safe (8 items)

W001, W002, W003, W004, W005, W007, W008, W016 — **all can run simultaneously.**

Each gets its own git worktree + branch. Mostly small, focused PRs.

### Wave 2 — depends on Wave 1 (parallel within)

- W006 (after W001 — layout.tsx collision)
- W009, W010, W012 (independent; can join Wave 1 in practice — see note below)
- W014 (no hard dep; can join Wave 1)
- W018 (no hard dep; can join Wave 1)
- W024 (no hard dep; can join Wave 1)

**Practical optimization:** W009, W010, W012, W014, W018, W024 have no W001-collision
risk and can be promoted to Wave 1 if the orchestrator wants maximum fan-out. I've
listed them in Wave 2 only because of the `package.json` lockfile race with W013/W009.

### Wave 3

- W013 (depends on W006 — consent)
- W015 (depends on W014 — file collision)

### Wave 4

- W017 (depends on W013 — webhook collision)

### Wave 5

- W019 (depends on W016 + W017 — needs real numbers to cite)

### Wave 6 — humans-only (NOT AFK)

- W011 (terraform apply needs AWS creds)
- W022 (screenshots)
- W026 (Stripe dashboard)
- W027 (prod migrate)

### Out of scope for this fleet

- W023 (IAP — multi-week)
- W025 (Android Stitch — multi-week)
- W028 (real platform posting — split into per-platform items later)

---

## AFK execution protocol

For every Wave-1 / Wave-2 / Wave-3 / Wave-4 / Wave-5 item, the orchestrator (me) will:

1. **Branch**: `claude/investor-readiness-<W###>-<slug>` cut from current `develop`.
2. **Implement** in an isolated git worktree.
3. **Validate locally** following PR #257's gate-must-match-CI rule:
   - `npx prisma generate` (if schema touched)
   - `tsc --noEmit`
   - `npm run lint`
   - `npx next build` (if app code touched)
   - iOS/Android compile gates for any mobile-touching items
4. **Open PR** against `develop` with auto-merge enabled (per project CLAUDE.md).
5. **Subscribe to PR** — fix-loop on CI failure → diagnose → push → repeat until MERGED
   per `docs/CI_REQUIRED_CHECKS.md`.
6. **Stop only on genuine blockers**: missing secrets, ambiguous business decisions,
   destructive operations, items marked [HUMAN].

**Non-actionable failures** (e.g. the pre-existing iOS-26-SDK TestFlight upload
requirement) are flagged in a batch report at the end, not retried in a loop.

---

## What you'll be asked when you return

A short batch report listing:

- PRs opened + merged
- PRs stuck on CI (and why)
- [HUMAN]-gated items waiting on you (W011 aws apply, W022 screenshots, W026 Stripe
  dashboard, W027 prod migrate)
- [DEFERRED] items recommended for a follow-up SKDW pass (W023 IAP, W025 Android Stitch,
  W028 platform posting split-up)

You'll review PRs, apply the human-gated steps, and then we run a follow-up pass on the
deferred items.
