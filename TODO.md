# Polemicyst — Road to Revenue TODO

This is the canonical project TODO list. Claude reads this file at the start of sessions to understand outstanding work. Update it as items are completed.

---

## Revenue-Critical (Must-Have for Launch)

### Billing & Quotas

- [x] Stripe checkout integration (pricing page → checkout → webhook)
- [x] Plan definitions with limits (free/pro/business)
- [x] Feed quota enforcement
- [x] Clip generation quota enforcement (API + workers)
- [x] LLM provider access gating (free = ollama only)
- [x] Auto-generate clips gating (pro+ only)
- [x] Payment failure webhook (downgrade on failed invoice)
- [x] Billing page with usage display (feeds + clips/month)
- [ ] Stripe Customer Portal integration for plan changes/cancellation (verify working end-to-end)

### Deployment

- [ ] Run database migrations on production RDS (see `docs/NEXT_STEPS.md`)
- [ ] Verify ECS services healthy after deploy (web, workers, redis)
- [ ] Verify SSL certificate and DNS resolution for polemicyst.com
- [ ] Verify Google OAuth works in production
- [ ] Verify Stripe webhooks reach production (set webhook endpoint in Stripe dashboard)
- [ ] Test full user flow: sign up → free plan → generate clips → hit limit → upgrade → continue

---

## Mobile Apps — Quota & Error Handling

### Android (`android/`)

- [ ] Add structured error response parsing (decode JSON error body with `code`, `message`, `allowedProviders` fields)
- [ ] Handle HTTP 403 specifically — show upgrade prompt with plan info instead of generic error
- [ ] Add billing/subscription screen (show current plan, usage meters, link to web billing portal)
- [ ] Show quota usage on feeds list (e.g., "2/10 feeds") and clip generation dialog
- [ ] Disable/gray out LLM provider options the user's plan doesn't allow in `ViralitySettingsPanel`
- [ ] Disable auto-generate toggle for free users in `FeedSettingsSheet`
- [ ] Add "Upgrade Plan" CTA when quota errors are hit

### iOS (`ios/`)

- [x] Add authentication (Google Sign-In + Sign in with Apple) with Bearer JWT flow
- [x] Keychain-backed token storage
- [x] Auth-gated App.swift (LoginView when unauthenticated, TabView when authenticated)
- [ ] Token refresh (re-authenticate when JWT expires)
- [ ] Sign-out UI (settings screen or profile menu)
- [x] Add structured error response parsing in `APIClient.swift` (decode JSON error body, not just status code)
- [x] Handle HTTP 403 specifically — show upgrade prompt
- [x] Add billing/subscription screen
- [x] Show quota usage indicators
- [x] Wire up clip generation UI (currently `triggerClip` exists in APIClient but no UI)
- [x] Add clips list/detail screens
- [x] Add virality settings UI for feed creation
- [x] Add LLM provider / auto-generate access gating in UI

---

## Web App — Remaining Features

### Core Product

- [ ] Clip editing/trimming improvements (trim UI on detail page)
- [ ] Clip export to social platforms (verify Bluesky, Meta, YouTube, Twitter flows work)
- [ ] AI description generation (verify `generateDescription` endpoint works)
- [ ] Clip templates system (CRUD exists but UI may not be wired up)

### UX Polish

- [ ] Show quota warnings before user hits limit (e.g., "9/10 clips used this month")
- [ ] Show upgrade prompts inline when 403 is returned on the web app (feeds page, clip generation)
- [ ] Add loading/progress states for clip generation on feeds page
- [ ] Error handling for Stripe portal session failures

### Security & Auth

- [ ] Audit all API routes have proper auth checks (some may be missing `getServerSession`)
- [ ] Rate limiting on public API endpoints
- [ ] CSRF protection review

---

## Infrastructure & DevOps

- [ ] Set up CloudWatch alarms for ECS task failures, high CPU, high memory
- [ ] Set up billing alerts in AWS to monitor costs
- [ ] Add CloudFront CDN in front of S3 for clip delivery
- [ ] Set up automated RDS backups and test restore
- [ ] Review ECS auto-scaling policies for workers
- [ ] Add health check endpoint for ALB target group

---

## API Contract

- [ ] Update `openapi/spec.yaml` with new quota error responses (403 with `QUOTA_EXCEEDED`, `PLAN_RESTRICTED` codes)
- [ ] Update `openapi/spec.yaml` with `/api/user/subscription` endpoint (new `clipsThisMonth` field)
- [ ] Verify Android Retrofit interfaces match current API spec
- [x] Verify iOS APIClient models match current API spec

---

## Clipfire Rebrand (App Split)

- [ ] Register new App ID `com.clipfire.app` in Apple Developer portal
- [ ] Update `ios/project.yml` bundle ID from `com.polemicyst.app` to `com.clipfire.app`
- [ ] Update `ios/fastlane/Appfile` bundle ID
- [ ] Create new provisioning profile for `com.clipfire.app`
- [ ] Create new App Store Connect app record for Clipfire
- [ ] Update GitHub Secrets with new provisioning profile

---

## Nice-to-Have (Post-Launch)

- [ ] Usage analytics dashboard (admin view)
- [ ] Email notifications for quota warnings (80% used, 100% used)
- [ ] Annual billing option with discount
- [ ] Team/organization support for Business plan
- [ ] Webhook for external integrations (notify when clips are ready)
- [ ] Multi-region deployment for global performance
- [ ] Offline mode for mobile apps
- [ ] Push notifications for clip generation completion (mobile)

## Monetization Evaluation — Agent Action Plan

_Added 2026-03-01 after full codebase audit by Claude cloud agent._

The billing & quota infrastructure is largely complete (Stripe checkout, plan definitions, feed/clip quotas, LLM gating, billing page). The remaining work falls into four priority tiers that agents should execute in order.

### Priority 1: Ship Deployment & Verify Revenue Path

These block all revenue. Each item is independently executable by a cloud agent.

- [ ] **Run production database migrations** — Execute Prisma migrations against production RDS. Verify all subscription/quota tables exist. (See `docs/NEXT_STEPS.md` for connection details.)
- [ ] **Verify ECS services are healthy** — Confirm web, clip-worker, and redis containers are running. Check ALB target group health checks pass.
- [ ] **Verify SSL + DNS** — Confirm `polemicyst.com` resolves and serves HTTPS. Check certificate auto-renewal is configured.
- [ ] **Verify Google OAuth in production** — Test sign-in flow end-to-end. Ensure callback URLs are registered in Google Cloud Console for the production domain.
- [ ] **Configure Stripe webhooks for production** — Set the webhook endpoint URL in Stripe dashboard to `https://polemicyst.com/api/webhooks/stripe`. Verify signature verification works.
- [ ] **Verify Stripe Customer Portal** — Test plan upgrade, downgrade, and cancellation through the Stripe portal. Ensure portal session creation endpoint works and redirects correctly.
- [ ] **End-to-end revenue flow test** — Sign up → land on free plan → create feeds → generate clips → hit quota limit → upgrade to pro via Stripe → verify quota resets → generate more clips. Document any failures.

### Priority 2: Landing Page & Conversion

The current landing page is a particle animation with zero product messaging. This is the single biggest conversion blocker.

- [ ] **Replace landing page** — Replace `src/app/page.tsx` with a product-focused page that explains what Polemicyst does: "Turn long-form videos into viral clips for every platform — automatically." Include:
  - Clear value proposition headline
  - Feature highlights (AI clipping, multi-platform publishing, feed monitoring)
  - Pricing tier summary (link to `/pricing` or inline)
  - Sign-up / Get Started CTA
  - Demo GIF or screenshot of the ClipsGenie interface
- [ ] **Add pricing section to landing page or dedicated `/pricing` route** — Display Free / Pro / Business tiers with limits and pricing. Link to Stripe checkout.
- [x] **Remove or gate playground routes** — `/playground/*` pages (read-line-by-line, scotus-scraper) are dev experiments. Either remove them or put them behind auth so they don't confuse visitors.
- [x] **Clean up duplicate components** — Remove `chat-gpt copy.tsx` and `hamburger copy.tsx` from `src/app/_components/`.

### Priority 3: Android Parity with iOS

iOS has full quota handling and billing UI. Android has none. Each item below is a standalone agent task.

- [ ] **Android: Structured error parsing** — Update API response handling to decode JSON error bodies with `code`, `message`, `allowedProviders` fields instead of treating all errors as generic failures.
- [ ] **Android: 403 upgrade prompt** — When HTTP 403 is returned with `QUOTA_EXCEEDED` or `PLAN_RESTRICTED` codes, show a specific upgrade dialog with plan info and a link to the web billing portal.
- [ ] **Android: Billing/subscription screen** — Add a screen showing current plan, usage meters (feeds used / limit, clips generated this month / limit), and a button to open the Stripe billing portal in a browser.
- [ ] **Android: Quota usage indicators** — Show "2/10 feeds" on the feeds list and remaining clips on the clip generation dialog.
- [ ] **Android: LLM provider gating** — Disable/gray out LLM provider options in `ViralitySettingsPanel` that the user's plan doesn't allow.
- [ ] **Android: Auto-generate toggle gating** — Disable auto-generate toggle for free users in `FeedSettingsSheet`.

### Priority 4: Web App UX & Revenue Protection

These improve retention and reduce churn once users are paying.

- [ ] **Quota warning banners** — Show a warning when user reaches 80% of their clip or feed quota (e.g., "9/10 clips used this month — upgrade for more").
- [ ] **Inline upgrade prompts on 403** — When the web app receives a 403 on feeds page or clip generation, show an inline upgrade CTA instead of a generic error.
- [ ] **Clip generation progress states** — Add loading/progress indicators on the feeds page when clips are being generated in the background.
- [ ] **Stripe portal error handling** — Handle failures when creating a Stripe portal session (e.g., Stripe is down) with a user-friendly message.
- [ ] **Verify social platform export flows** — Test Bluesky, Meta/Instagram, YouTube, and Twitter publishing end-to-end. Fix any broken OAuth flows or API changes.
- [ ] **Verify AI description generation** — Test the `generateDescription` endpoint and ensure it produces usable output for each platform.

### Agent Execution Notes

- Each checkbox above is scoped to be completable by a single Claude cloud agent session.
- Agents should read this file at session start and pick the highest-priority unchecked item they can act on.
- Mark items `[x]` immediately upon completion and push the updated TODO.md.
- Priority 1 items may require environment variables / secrets that agents cannot access — flag these as blocked and move to the next item.
- Priority 2 items are pure code changes and can be done without production access.

---

## Random Features

- Some way to view admin
- If youtube video is the type of video added, use youtube embed in details page rather than from aws
- add already used refresh button to transcript section to refresh retrieivng transcript
