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

- [x] Run database migrations on production RDS (see `docs/NEXT_STEPS.md`)
- [ ] Verify ECS services healthy after deploy (web, workers, redis)
- [ ] Verify SSL certificate and DNS resolution for polemicyst.com
- [ ] Verify Google OAuth works in production
- [ ] Verify Stripe webhooks reach production (set webhook endpoint in Stripe dashboard)
- [ ] Test full user flow: sign up → free plan → generate clips → hit limit → upgrade → continue

---

## Mobile Apps — Quota & Error Handling

### Android (`android/`)

- [x] Add structured error response parsing (decode JSON error body with `code`, `message`, `allowedProviders` fields)
- [x] Handle HTTP 403 specifically — show upgrade prompt with plan info instead of generic error
- [x] Add billing/subscription screen (show current plan, usage meters, link to web billing portal)
- [x] Show quota usage on feeds list (e.g., "2/10 feeds") and clip generation dialog
- [x] Disable/gray out LLM provider options the user's plan doesn't allow in `ViralitySettingsPanel`
- [x] Disable auto-generate toggle for free users in `FeedSettingsSheet`
- [x] Add "Upgrade Plan" CTA when quota errors are hit

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

- [x] Clip editing/trimming improvements (trim UI on detail page)
- [ ] Clip export to social platforms (verify Bluesky, Meta, YouTube, Twitter flows work)
- [ ] AI description generation (verify `generateDescription` endpoint works)
- [ ] Clip templates system (CRUD exists but UI may not be wired up)

### UX Polish

- [x] Show quota warnings before user hits limit (e.g., "9/10 clips used this month")
- [x] Show upgrade prompts inline when 403 is returned on the web app (feeds page, clip generation)
- [ ] Add loading/progress states for clip generation on feeds page
- [ ] Error handling for Stripe portal session failures

### Security & Auth

- [x] Audit all API routes have proper auth checks (some may be missing `getServerSession`)
- [ ] Rate limiting on public API endpoints
- [ ] CSRF protection review

---

## Migrate to Trunk-Based Development

_Eliminate `develop` branch. Ship from `main` with short-lived feature branches, tags for releases, and feature flags for incomplete work. See [Claude Code chat transcript](../.claude/projects/-Users-austin-Developer-polemicyst-polemicyst-com/969fd158-9453-4b85-af79-c74893742493.jsonl) for full discussion and rationale._

### Step 1: Sync & CI/CD (do first)

- [ ] **Merge `develop` into `main`** — ensure they're fully in sync, resolve any drift
- [ ] **Update `deploy.yml`** — push to `main` deploys to dev/staging; tagged GitHub Release deploys to production
- [ ] **Update branch protection on `main`** — require PR, require CI (lint + build + tests) to pass

### Step 2: Update repo conventions

- [ ] **Update `CLAUDE.md`** — branch from `main`, PR to `main` (remove all `develop` references)
- [ ] **Update `/create-pr` slash command** — default target to `main`
- [ ] **Update `release.yml` / `post-release.yml`** — remove develop→main release PR flow; releases are just tags on `main`
- [ ] **Update `bump-version.mjs`** — simplify for tag-based workflow (no more develop→main PR)

### Step 3: Feature flags (for shipping incomplete work safely)

- [ ] **Choose feature flag approach** — simple DB table + React context, or LaunchDarkly/Unleash
- [ ] **Implement feature flag system** — server-side check + client-side context provider
- [ ] **Add admin UI for toggling flags** (extend existing `/admin` pages)

### Step 4: AI-powered workflow automation

- [ ] **Add Claude Code PR review GitHub Action** — auto-review on every PR to `main`
- [ ] **AI-generated release notes** — on tag creation, summarize commits into human-readable changelog
- [ ] **Auto-generated changelogs for mobile stores** — feed AI release notes into Fastlane/Play Store metadata

### Step 5: Cleanup

- [ ] **Delete `develop` branch** (local + remote)
- [ ] **Archive or remove any develop-specific CI workflows**
- [ ] **Simplify `/sync` slash command** — after migration, sync becomes just `git fetch origin && git rebase origin/main` (no develop step)

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
- [ ] Register new Android application ID `com.clipfire.app` in Google Play Console
- [ ] Update `android/app/build.gradle.kts` prod `applicationId` from `com.polemicyst.android` to `com.clipfire.app`
- [ ] Update `deploy.yml` Play Store upload `packageName` to match new application ID

---

## Mobile Release Automation

_CI/CD pipelines exist in `.github/workflows/deploy.yml` for both platforms but have critical gaps. The items below follow industry best practices for mobile release engineering, ordered by priority._

### Tier 1 — Broken / Blocks Store Uploads

These must be fixed before any production release reaches end users.

- [x] **Android: Auto-increment `versionCode` in CI** — `versionCode` is hardcoded to `1` in `android/app/build.gradle.kts`. The Play Store rejects uploads with a duplicate `versionCode`. Use `GITHUB_RUN_NUMBER` (like iOS already does) or a timestamp-based code. Update `build.gradle.kts` to read from an env var or gradle property with a fallback for local builds.
- [ ] **Verify Android CI secrets are configured** — The `build-android-release` and `build-android-dev` jobs silently skip uploads when secrets are missing. Verify these GitHub Secrets exist and are valid: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON`, `FIREBASE_APP_ID_DEV`, `FIREBASE_SERVICE_ACCOUNT`.
- [ ] **Verify iOS CI secrets are configured** — The `build-ios-dev` and `build-ios-release` jobs gate on `ASC_KEY_CONTENT`. Verify these GitHub Secrets exist and are valid: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_CONTENT`, `APPLE_TEAM_ID`, `APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_PROVISIONING_PROFILE_BASE64`, `APPLE_PROVISIONING_PROFILE_NAME`.

### Tier 2 — Version Management

Semantic version names should be tied to git tags so store listings show meaningful versions, not perpetual `1.0.0`.

- [x] **Centralize version name in a single source of truth** — Create a `version.json` (or use git tags) as the canonical version. Both `android/app/build.gradle.kts` (`versionName`) and `ios/project.yml` (`MARKETING_VERSION`) should read from it during CI. Local builds can fall back to a default.
- [ ] **Add a CI step or script to bump version from git tags** — On `main` pushes, derive the version name from the latest `vX.Y.Z` git tag (aligning with the existing GitHub Releases workflow in `CLAUDE.md`). On `develop` pushes, append a pre-release suffix (e.g., `1.2.0-dev.47`).
- [x] **iOS: Wire `MARKETING_VERSION` to CI** — The Fastlane `set_build_number` lane sets `CURRENT_PROJECT_VERSION` but never updates `MARKETING_VERSION`. Add `increment_version_number` or `xcargs` override so the IPA carries the correct semver.

### Tier 3 — Store Track Promotion

Currently builds land on internal/test tracks and require manual promotion. Automate the path to end users.

- [x] **Android: Promote from `internal` to `production` track** — Add a manual-trigger GitHub Actions workflow (`workflow_dispatch`) that promotes the latest internal release to production (or to a beta track first). Use `r0adkll/upload-google-play` with `status: completed` and `track: production`, or add a Fastlane `supply` lane.
- [ ] **Android: Consider staged rollouts** — When promoting to production, use a staged rollout percentage (e.g., 10% → 50% → 100%) to catch regressions before full release. The `upload-google-play` action supports `userFraction`.
- [x] **iOS: Add option to submit for App Store review** — The Fastlane `release` lane uploads to App Store Connect with `submit_for_review: false`. Add a separate `promote` lane (or a `workflow_dispatch` workflow) that submits the latest build for review, optionally with `automatic_release: true` for auto-publish on approval.
- [ ] **iOS: Add phased release support** — When submitting for review, set `phased_release: true` so Apple rolls out over 7 days. This gives time to catch crash spikes before 100% of users get the update.

### Tier 4 — Minimum Version Enforcement (Force Update)

Breaking API changes (e.g., new auth flow, changed response shapes) can crash old app versions. A server-side minimum version check is the industry-standard solution.

- [x] **Add `GET /api/app/version-check` endpoint** — Accepts `platform` (android/ios) and `currentVersion` query params. Returns `{ updateRequired: boolean, minimumVersion: string, latestVersion: string, storeUrl: string }`. Store minimum versions in env vars or a DB table.
- [x] **Android: Check version on app startup** — Call the version-check endpoint on launch. If `updateRequired` is true, show a blocking dialog with a "Update Now" button that opens the Play Store listing. No dismiss option for required updates.
- [x] **iOS: Check version on app startup** — Same as Android but opens the App Store listing. Use a non-dismissible `fullScreenCover` in SwiftUI.
- [x] **Update `openapi/spec.yaml`** with the version-check endpoint.

### Tier 5 — In-App Update Prompts (Soft Updates)

For non-breaking updates, prompt users to update without forcing them.

- [x] **Android: Integrate Play Core In-App Updates API** — Use the `com.google.android.play:app-update` library. On launch, check for available updates. Use `AppUpdateType.FLEXIBLE` for background downloads with a snackbar prompt, or `AppUpdateType.IMMEDIATE` for critical updates. This only works for Play Store builds (not Firebase App Distribution).
- [ ] **iOS: Add optional update prompt** — Query the version-check endpoint. If `latestVersion` is newer than the running version but `updateRequired` is false, show a dismissible alert suggesting the user update. Respect a "remind me later" cooldown (e.g., 3 days).

### Tier 6 — Crash Reporting & Release Health

Never promote a release without knowing its crash-free rate.

- [x] **Android: Enable Firebase Crashlytics** — Uncomment the Crashlytics dependencies in `build.gradle.kts` and the `google-services` plugin. Add a valid `google-services.json` to `android/app/src/dev/` and `android/app/src/prod/`. Verify crash reports appear in Firebase Console.
- [ ] **iOS: Add crash reporting** — Integrate Firebase Crashlytics via SPM (or Sentry). Initialize in `App.swift`. Verify crash reports appear in the console.
- [ ] **Add crash-free rate gate to promotion workflows** — Before promoting a build from internal/beta to production, check the crash-free rate in Firebase (or equivalent). Fail the promotion if below threshold (e.g., 99.5%).

### Tier 7 — Release Notes & Store Metadata

Automate changelog generation so store listings stay current.

- [ ] **Auto-generate changelogs from git commits** — Add a CI step that generates release notes from conventional commits (or PR titles) between the previous and current tags. Output to a file that Fastlane/upload-google-play can consume.
- [ ] **Android: Supply release notes to Play Store** — Pass `releaseNotes` to the `upload-google-play` action (or use Fastlane `supply`). Format: `[{ "language": "en-US", "text": "..." }]`.
- [ ] **iOS: Supply release notes to TestFlight/App Store** — Pass `changelog` to Fastlane `upload_to_testflight` and `release_notes` to `upload_to_app_store`.
- [ ] **Store metadata management** — Use Fastlane `deliver` (iOS) and `supply` (Android) to manage screenshots, descriptions, and keywords from version-controlled files in `ios/fastlane/metadata/` and `android/fastlane/metadata/`.

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

- [x] **Run production database migrations** — Ran `prisma db push` via ECS task to sync production RDS schema. All missing columns (e.g. `transcriptSource`, `speakerTranscriptJson`, `clipGenerationStatus`, etc.) added. (2026-03-03)
- [ ] **Verify ECS services are healthy** — Confirm web, clip-worker, and redis containers are running. Check ALB target group health checks pass.
- [ ] **Verify SSL + DNS** — Confirm `polemicyst.com` resolves and serves HTTPS. Check certificate auto-renewal is configured.
- [ ] **Verify Google OAuth in production** — Test sign-in flow end-to-end. Ensure callback URLs are registered in Google Cloud Console for the production domain.
- [ ] **Configure Stripe webhooks for production** — Set the webhook endpoint URL in Stripe dashboard to `https://polemicyst.com/api/webhooks/stripe`. Verify signature verification works.
- [ ] **Verify Stripe Customer Portal** — Test plan upgrade, downgrade, and cancellation through the Stripe portal. Ensure portal session creation endpoint works and redirects correctly.
- [ ] **End-to-end revenue flow test** — Sign up → land on free plan → create feeds → generate clips → hit quota limit → upgrade to pro via Stripe → verify quota resets → generate more clips. Document any failures.

### Priority 2: Landing Page & Conversion

The current landing page is a particle animation with zero product messaging. This is the single biggest conversion blocker.

- [x] **Replace landing page** — Replace `src/app/page.tsx` with a product-focused page that explains what Polemicyst does: "Turn long-form videos into viral clips for every platform — automatically." Include:
  - Clear value proposition headline
  - Feature highlights (AI clipping, multi-platform publishing, feed monitoring)
  - Pricing tier summary (link to `/pricing` or inline)
  - Sign-up / Get Started CTA
  - Demo GIF or screenshot of the ClipsGenie interface
- [x] **Add pricing section to landing page or dedicated `/pricing` route** — Display Free / Pro / Business tiers with limits and pricing. Link to Stripe checkout.
- [x] **Remove or gate playground routes** — `/playground/*` pages (read-line-by-line, scotus-scraper) are dev experiments. Either remove them or put them behind auth so they don't confuse visitors.
- [x] **Clean up duplicate components** — Remove `chat-gpt copy.tsx` and `hamburger copy.tsx` from `src/app/_components/`.

### Priority 3: Android Parity with iOS

iOS has full quota handling and billing UI. Android has none. Each item below is a standalone agent task.

- [x] **Android: Structured error parsing** — Update API response handling to decode JSON error bodies with `code`, `message`, `allowedProviders` fields instead of treating all errors as generic failures.
- [x] **Android: 403 upgrade prompt** — When HTTP 403 is returned with `QUOTA_EXCEEDED` or `PLAN_RESTRICTED` codes, show a specific upgrade dialog with plan info and a link to the web billing portal.
- [x] **Android: Billing/subscription screen** — Add a screen showing current plan, usage meters (feeds used / limit, clips generated this month / limit), and a button to open the Stripe billing portal in a browser.
- [x] **Android: Quota usage indicators** — Show "2/10 feeds" on the feeds list and remaining clips on the clip generation dialog.
- [x] **Android: LLM provider gating** — Disable/gray out LLM provider options in `ViralitySettingsPanel` that the user's plan doesn't allow.
- [x] **Android: Auto-generate toggle gating** — Disable auto-generate toggle for free users in `FeedSettingsSheet`.

### Priority 4: Web App UX & Revenue Protection

These improve retention and reduce churn once users are paying.

- [x] **Quota warning banners** — Show a warning when user reaches 80% of their clip or feed quota (e.g., "9/10 clips used this month — upgrade for more").
- [x] **Inline upgrade prompts on 403** — When the web app receives a 403 on feeds page or clip generation, show an inline upgrade CTA instead of a generic error.
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

## Bugs

- [ ] **iOS: HTTP 500 errors on app launch** — Sometimes on app load, multiple tabs show "HTTP 500 Failed" errors. Signing out and signing back in fixes it. Likely a stale/expired JWT or race condition during token refresh on launch. Investigate whether the token is being sent before it's fully restored, or if the server is rejecting an expired token with a 500 instead of a 401.

---

## Random Features

- Some way to view admin
- If youtube video is the type of video added, use youtube embed in details page rather than from aws
- add already used refresh button to transcript section to refresh retrieivng transcript
- **Intelligent pause removal** — Automatically cut dead space / silent pauses from videos. Instead of using a fixed silence-detection threshold (which produces many false positives), the user provides a ballpark estimate: _"Roughly how many pauses are in this video to be removed?"_ The system uses that estimate to calibrate its detection so it targets approximately that many pauses rather than every micro-silence. The estimate is a hint, not a hard count — the system may remove fewer or more pauses than the user guessed depending on the audio analysis. Implementation approach:
  - Add a setting in the clip/video editing UI: a numeric input or slider asking the user for their rough pause count estimate.
  - Analyze the audio track to identify all candidate silent/low-energy segments (ranked by duration, energy level, or confidence).
  - Use the user's estimate to set an adaptive threshold: if the user says ~5 pauses, pick roughly the top 5 most prominent silent gaps rather than every gap that crosses an arbitrary dB threshold. The ranking should consider gap duration, surrounding audio energy, and position in the video to space removals somewhat evenly.
  - Apply the removals and re-render the video with the dead space cut out.
  - Show the user a before/after timeline or summary of what was removed so they can approve or adjust.
- [x] **Auto-detected quote/excerpt graphics** — When a creator reads or cites a quote, excerpt, or passage in their reaction video, automatically detect it and overlay a styled graphic in the rendered output while the quote is being spoken. The system should intelligently identify quoted material (distinct from the creator's own commentary) using transcript analysis and LLM inference. Implementation approach:
  - **Detection**: Analyze the creator's transcript to identify segments where the speaker is reading/citing external text vs. giving their own commentary. Use cues like: explicit attribution ("the article says…", "and I quote…", "according to…"), shifts in speech cadence or tone, and context from reference track transcripts (if the same text appears in both, it's likely a quote from the reference).
  - **LLM-powered extraction**: Send transcript segments to the scoring LLM (Gemini/Ollama via existing `ScoringProvider`) with a prompt that returns structured JSON: `{ quotes: [{ text, attribution?, startS, endS, confidence }] }`. The LLM determines what's being quoted, who said it (if attributable), and the exact time range.
  - **Graphic styles**: Offer multiple visual templates the user can choose from (or auto-select based on content style):
    - **Pull quote**: Large quotation marks with centered text on a semi-transparent dark overlay
    - **Lower third**: Text bar across the bottom third with attribution line below
    - **Side panel**: Quote text in a styled panel on one side of the frame (opposite the creator)
    - **Typewriter**: Text animates in word-by-word as the creator reads it
    - **Highlight card**: Rounded card with accent border, quote text, and source attribution
  - **Rendering integration**: In both client-side (`client-render`) and server-side (FFmpeg) render paths, composite the quote graphic onto frames during the detected time range. For client-side, draw on the canvas alongside captions. For server-side, generate overlay images/filters in the FFmpeg filter graph.
  - **User controls**: Add a toggle in composition settings ("Show quote graphics") and a style picker. Allow manual override — user can add/remove/edit detected quotes before rendering.
  - **Reference-aware**: When the composition includes reference tracks with transcripts, cross-reference to improve detection accuracy. If the creator repeats text from the reference, it's almost certainly a quote.
- **AI-generated thumbnail backgrounds** — Give users a choice between the current approach (extracting video frames as the background image) and an AI-generated custom thumbnail background. The creator cutout overlay remains unchanged in both modes — this only affects the background layer. Implementation approach:
  - **Mode selector**: In the Thumbnail Builder panel, add a toggle or tab: "Video Frame" (current behavior) vs. "AI Generated". Default to video frame for backwards compatibility.
  - **Intelligent design generation**: When AI mode is selected, analyze the composition's content (title, track labels, transcript keywords, detected content style) to generate a visually compelling background. The system should produce backgrounds that follow YouTube/social thumbnail best practices: high contrast, bold colors, minimal text clutter, and complementary to the creator cutout.
  - **Multiple style options**: Generate 3-4 candidate backgrounds for the user to choose from, each with a different visual approach:
    - **Gradient + accents**: Dynamic gradient background with subtle graphic elements (arrows, shapes, highlights) that draw attention
    - **Contextual scene**: Abstract or stylized representation related to the video's topic (e.g., political imagery for politics content, gaming elements for gaming content)
    - **Bold typography**: Large, impactful text/keywords from the video overlaid on a clean background (separate from the creator cutout)
    - **Collage/montage**: Key frames from the reference video(s) arranged as a blurred or stylized collage behind the creator
  - **Generation approach**: Use an image generation API (e.g., DALL-E, Stable Diffusion) or a canvas-based programmatic generator for simpler styles. For cost control, start with the programmatic approach (canvas drawing with gradients, shapes, and typography) and add AI image generation as an optional upgrade.
  - **Compositing**: The generated background replaces only the background layer in the existing thumbnail pipeline. The creator cutout (face detection → background removal → positioning) remains exactly as-is and is composited on top.
  - **Persistence**: Save the selected background mode and generated image URL/data alongside the composition's thumbnail settings so it persists across sessions.
