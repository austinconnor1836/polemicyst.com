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
- [ ] Add structured error response parsing in `APIClient.swift` (decode JSON error body, not just status code)
- [ ] Handle HTTP 403 specifically — show upgrade prompt
- [ ] Add billing/subscription screen
- [ ] Show quota usage indicators
- [ ] Wire up clip generation UI (currently `triggerClip` exists in APIClient but no UI)
- [ ] Add clips list/detail screens
- [ ] Add virality settings UI for feed creation
- [ ] Add LLM provider / auto-generate access gating in UI

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
- [ ] Verify iOS APIClient models match current API spec

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

## Random Features
- Some way to view admin 
- If youtube video is the type of video added, use youtube embed in details page rather than from aws
- add already used refresh button to transcript section to refresh retrieivng transcript