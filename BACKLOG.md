# Clipfire AFK Backlog

Generated 2026-06-12. Update on every dispatcher tick.

## How to use this file

- Status: pending | in-progress | in-pr | done | blocked | human-only
- Track: afk-safe (web/backend/docs — no phone needed) or ios-locked (needs Austin's iPhone connected for verify-ac-ios)
- Dispatcher picks the highest-priority unblocked **afk-safe** item whose dependencies are all `done` or `in-pr`.
- One in-flight PR per area at a time — don't stack two PRs touching the same files; mark the second `blocked` on the first.
- Always verify-runtime-before-asking-user-to-test (see `feedback_verify_runtime_before_asking_user_to_test`). For afk-safe items the runtime check is CI green + unit tests; for ios-locked it's `xcode-run.sh` on Austin's phone.

## Items

### W001 — Close stale PRs

- Status: done
- Track: afk-safe
- Priority: P0 (zero risk, biggest dispatcher signal-to-noise win)
- Deps: (none)
- AC:
  - PR #82 (Cursor intelligent pause removal) closed with one-line comment citing 3-month inactivity + superseded by current auto-edit pipeline.
  - PR #80 (Automatic b-roll feature, draft) closed.
  - PR #79 (Cross-platform AI posting, draft) closed — explicitly note it's superseded by the W028 platform-posting series in this backlog.
- Notes: Closes only, no merge. `gh pr close <n> -c "<reason>"`. No code touched.
- Closed: 2026-06-13 by AFK dispatcher tick `afk-20260613T003654Z`. PRs #82, #80, #79 all closed with rationale comments per AC.

### W002 — Prune locked agent worktrees

- Status: pending
- Track: afk-safe
- Priority: P0
- Deps: (none)
- AC:
  - Run `git worktree list` — 43 worktrees today, almost all under `.claude/worktrees/agent-*` and `locked`.
  - For each worktree whose branch is MERGED into main OR whose branch no longer exists on remote, run `git worktree unlock` then `git worktree remove --force`, then `git branch -D <branch>` if the branch is fully merged.
  - DO NOT touch the primary worktree at `/Users/austin/Developer/polemicyst/polemicyst.com` itself (currently on `fix/ios-ai-title-caption-stitched`).
  - DO NOT remove worktrees for branches that still appear in `gh pr list --state open` (#295, #296, anything live).
  - End state: `git worktree list | wc -l` materially smaller, repo still builds, `git status` on primary worktree unchanged.
- Notes: This is the cheapest win in the file. Faster `git status`, less inode pressure, easier mental model. Worktrees are at `.claude/worktrees/agent-*` — they're scratch space, not source of truth.

### W003 — PR #296 merge + post-merge verify

- Status: in-pr
- Track: afk-safe
- Priority: P0
- Deps: (none — auto-merge already enabled)
- AC:
  - Poll `gh pr view 296 --json state,mergeStateStatus` until `state=MERGED`.
  - Once merged, pull main and run `npm run vitest -- tests/lib/composition-transcript.test.ts` — must be green (13 cases).
  - `npm run lint` on the affected files (`src/app/reactions/[id]/page.tsx`, `src/app/reactions/_components/RenderControls.tsx`, `shared/lib/composition-transcript.ts`) — record any NEW warnings introduced by the PR (pre-existing are fine, just don't add to the pile).
  - Update `TODO.md` if PR closed any line items.
- Notes: Dispatcher's first job each tick should be to check this. If CI flakes and auto-merge is disabled, re-enable.

### W004 — PR #295 conflict triage (human-required decision, AFK can prep)

- Status: blocked
- Track: afk-safe (prep only) — final merge needs Austin
- Priority: P1
- Deps: W003 done (so the merged base is settled)
- AC:
  - Rebase `feature/stitch-ios` onto current main in a scratch worktree (NOT primary).
  - Categorize each conflict: (a) trivially resolvable additive (apply theirs+ours), (b) overlaps with PR #296's stitch-transcript fix (need to keep #296's helper, drop the inline concat), (c) needs a structural call from Austin.
  - Write the categorized list as a comment on PR #295 with proposed resolutions per file. DO NOT push the rebased branch.
  - Mark this item `human-only` once the comment is posted — Austin reviews and decides.
- Notes: PR #295 is mergeStateStatus=DIRTY today. Touching the merge directly without human sign-off violates the "destructive action without rollback" escalation bar — the stitch+publish feature is the demo path.

### W005 — Confirm PR #296 web fix is complete (no follow-up bugs)

- Status: pending
- Track: afk-safe
- Priority: P1
- Deps: W003 done
- AC:
  - Grep for any other call site that constructs an AI-suggest payload from a composition WITHOUT going through `buildStitchedTranscript`. Specifically scan `src/app/api/generateDescription/`, `src/app/api/publish/`, `src/app/reactions/**`, `src/app/api/clips/**`.
  - If a site is found that still forwards `output.transcript` directly for a stitched composition, open a follow-up PR routing it through the helper.
  - If none found, mark `done` with a brief note on the BACKLOG line: "Confirmed sole call site."
- Notes: This is the "completeness check on PR #296" — the kind of thing that gets missed when a fix lands quickly. Read-only scan first; only open a PR if a real second site exists.

### W006 — Unit test: `shared/lib/plans.ts` tier→limit lookup

- Status: pending
- Track: afk-safe
- Priority: P1
- Deps: W003 done (so vitest config on main is the canonical one)
- AC:
  - Add `tests/lib/plans.test.ts` (note: `tests/lib/plans.test.ts` MAY already exist per `git ls-tree main tests/lib` — check first, extend rather than duplicate).
  - Cover: free/pro/business/agency each map to the expected `uploadMinutesLimit`, `watermarkEnabled`, `annualDiscountPercent`. Cover the unknown-tier fallback path (should not throw; should return free).
  - `npm run vitest -- tests/lib/plans.test.ts` green.
- Notes: Plans table is load-bearing for billing. Recently touched in #255 (pricing restructure). Cheap, high-value coverage.

### W007 — Unit test: stitched composition transcript helper edge cases

- Status: pending
- Track: afk-safe
- Priority: P2
- Deps: W003 done
- AC:
  - Extend `tests/lib/composition-transcript.test.ts` with: (a) tracks with `sortOrder` collisions resolve deterministically (stable sort), (b) malformed transcript JSON on a track is skipped without throwing, (c) very long transcripts (≥10k chars) don't crash the helper.
  - All cases pass `npm run vitest -- tests/lib/composition-transcript.test.ts`.
- Notes: 13 existing cases cover the happy paths. These three are the realistic failure modes the helper will see in prod once PR #296 ships.

### W008 — Lint-warning pass on PR #296-touched files

- Status: pending
- Track: afk-safe
- Priority: P2
- Deps: W003 done
- AC:
  - `npm run lint -- src/app/reactions/[id]/page.tsx src/app/reactions/_components/RenderControls.tsx shared/lib/composition-transcript.ts`.
  - For each warning: classify as (a) pre-existing on main (leave alone, log in PR description), (b) introduced by #296 (fix in a tiny follow-up PR).
  - If (b) is empty, mark `done` with the audit result in a comment. If non-empty, open a "chore(lint): clean warnings on stitched-transcript path" PR with auto-merge.
- Notes: Investor-readiness signal — clean lint on the demo path. Don't touch unrelated files; scope strictly to the three above.

### W009 — README + ARCHITECTURE: document the stitched-transcript helper

- Status: pending
- Track: afk-safe
- Priority: P2
- Deps: W003 done
- AC:
  - Add a short subsection to `ARCHITECTURE.md` under the existing AI-suggest / publish flow describing `buildStitchedTranscript`: WHY it exists (stitched compositions don't get a unified transcript at render-completion time), WHEN to use it (any AI-suggest call sourced from a composition), and the preference order (rendered-output transcript > per-source concatenation).
  - Append one line to `TODO.md` under "Revenue-Critical" referencing PR #296 as complete (when W003 is done).
- Notes: Pure docs. Zero blast radius.

### W010 — Backend stub: Bluesky post endpoint completeness

- Status: pending
- Track: afk-safe
- Priority: P1 (simplest platform, unlocks the rest of W028 series)
- Deps: W003 done
- AC:
  - Audit `src/app/api/bluesky/**` — what's already there. Don't assume; read the routes.
  - Ensure there's a `POST /api/bluesky/post` route that: (a) accepts `{ compositionId, text }`, (b) loads the connected `PublishingAccount` for the user with `platform=bluesky`, (c) posts text + the rendered output video URL via the `@atproto/api` SDK (already in `package.json` if used by existing bluesky code; add if not), (d) records a `SocialPost` row with `platform=bluesky`, `status=posted`, `externalId=<at-uri>`, `postedAt=now`.
  - One vitest case stubbing the SDK and asserting the SocialPost row is written with the right fields.
  - Surface a feature flag `POSTING_BLUESKY_ENABLED` defaulting to FALSE. The route returns 503 + "feature disabled" when the flag is off.
- Notes: Bluesky is the simplest of the W028 series — no OAuth refresh dance, app passwords just work, no video transcoding requirement on their side. Get this one shipping; the rest of the series follows. **AFK-safe up to the point of "does posting actually work in prod" — Austin has to verify that with a real account.** Mark `done` when CI is green and the flag is in place; verification is a separate human step.

### W011 — Twitter post endpoint scaffolding (blocked on W010)

- Status: blocked
- Track: afk-safe
- Priority: P2
- Deps: W010 done
- AC:
  - Mirror the W010 shape against `src/app/api/twitter/post/` (route already exists per directory listing — fill in the gaps).
  - Same vitest pattern: stub the twitter client, assert SocialPost row.
  - Feature flag `POSTING_TWITTER_ENABLED`.
- Notes: Twitter has OAuth 1.0a + video upload chunking — meaningfully harder than Bluesky. Block on W010 landing first so the SocialPost contract is settled.

### W012 — YouTube/IG/TikTok posting stubs (deferred placeholders)

- Status: blocked
- Track: afk-safe
- Priority: P3
- Deps: W011 done
- AC:
  - Three skeleton routes (POST endpoints, accept the same `{compositionId, text}` shape) under `youtube/upload`, plus new directories for `instagram/post` and `tiktok/post`.
  - Each route returns 501 Not Implemented with a clear "platform not yet supported" body and logs an `unsupported_platform_post` event.
  - One unified docs page at `docs/POSTING.md` listing per-platform status + what's needed to ship each one.
- Notes: These are W028c/d/e from the original investor plan. Keeping them in the backlog so the dispatcher doesn't reinvent them later. Don't put real implementation effort here — multi-week work per platform.

### W013 — Web dashboards: confirm mobile-friendly (per global UX rule)

- Status: pending
- Track: afk-safe
- Priority: P2
- Deps: (none)
- AC:
  - Visually audit (Playwright at 390×844) the following routes for horizontal-scroll bugs and ≥44px touch targets: `/admin/runway`, `/admin/metrics`, `/billing`, `/reactions/[id]`.
  - For any route that overflows horizontally on portrait phone, file a one-paragraph note in `docs/UI_AUDIT_2026-06.md` with the offending element + suggested fix. DO NOT fix in this item — fixes go in separate PRs so the audit doesn't sprawl.
  - At least the first three routes (`/admin/runway`, `/admin/metrics`, `/billing`) get the report.
- Notes: Global rule: dashboards must work on iPhone-class viewports. This is the audit pass; remediation is per-route follow-up.

### W014 — Doc cleanup: TODO.md reconciliation

- Status: pending
- Track: afk-safe
- Priority: P3
- Deps: W003 done, W009 done
- AC:
  - Cross-reference `TODO.md` against current state: items shipped in #255 (pricing), #275 (admin metrics), #285 (SEO), #287 (LICENSE), #288 (vitest), #293 (runway dashboard), #294 (dead code cleanup) — mark them done in `TODO.md`.
  - Open follow-ups (Stripe Price IDs, WTP, AWS SNS, prod migrate) — promote to a top-level "Human-only launch blockers" section at the top of `TODO.md` so they're impossible to miss.
- Notes: Pure docs. Should leave `TODO.md` actually trustworthy as a launch-status doc.

### W015 — Human-only: AWS SNS email confirmation

- Status: human-only
- Track: (n/a — Austin only)
- Priority: P0 (launch blocker)
- Deps: (none)
- AC:
  - Confirm the SNS subscription email Amazon sent to the configured ops inbox. Without this, prod alarms don't notify.
- Notes: Dispatcher must NOT touch this. Listed so we don't forget.

### W016 — Human-only: run `scripts/run-prod-migrate.sh`

- Status: human-only
- Track: (n/a — Austin only)
- Priority: P0 (launch blocker)
- Deps: W015 done (alarms first, then migrate)
- AC:
  - Script does NOT currently exist at `polemicyst.com/scripts/run-prod-migrate.sh` (verified). Either the agent that promised it never landed, OR the script lives under `infrastructure/`. **First subtask, AFK-safe:** locate or write the script — a thin wrapper around `prisma migrate deploy` against the prod `DATABASE_URL`, gated by an `I_KNOW_THIS_IS_PROD=1` env var.
  - Once the script exists in main, AFK work is done. Austin runs it against prod.
- Notes: Splitting this — "make the script exist" is afk-safe, "execute against prod" is human-only. Dispatcher can do the first half; reword status to `pending` (afk-safe) once Austin agrees. Today the safer default is `human-only` until Austin clarifies what the prod migrate path is.

### W017 — Human-only: Stripe Price IDs in prod env

- Status: human-only
- Track: (n/a — Austin only)
- Priority: P0 (launch blocker)
- Deps: W018 done (WTP finalized before creating Price objects)
- AC:
  - Austin creates the Stripe Price objects (free/pro/business/agency × monthly/annual = 7 IDs since free has no price) and sets `STRIPE_*_{MONTHLY,ANNUAL}_PRICE_ID` env vars in the prod environment.
- Notes: Cannot be automated. Touches money + production Stripe account. Dispatcher must NOT attempt.

### W018 — Human-only: WTP final dollar amounts

- Status: human-only
- Track: (n/a — Austin only)
- Priority: P0 (launch blocker)
- Deps: (none)
- AC:
  - Austin runs WTP research / picks final numbers and replaces every `// TODO(pricing)` placeholder in `shared/lib/plans.ts` (and wherever else they appear).
  - Once the numbers exist, the dispatcher CAN do the mechanical replace as a follow-up afk-safe PR. But pricing is a business decision, not a coding one.
- Notes: I will NOT invent dollar amounts. The only afk-safe move is the mechanical replace AFTER Austin states the numbers.

### W019 — Human-only: store screenshots + demo video

- Status: human-only
- Track: (n/a — Austin only)
- Priority: P1 (investor-readiness)
- Deps: (none)
- AC:
  - App Store / Play Store screenshots captured on a real device at the required sizes.
  - Demo video recorded showing the stitched-publish happy path.
- Notes: Requires Austin's phone + face + voice. Cannot be automated.

### W020 — iOS-locked: verify-ac on the stitched-AI fix end-to-end

- Status: pending
- Track: ios-locked
- Priority: P1
- Deps: PR #298 merged (already done), PR #296 merged (W003)
- AC:
  - On a Release build pointing at prod (so the web fix from #296 is reachable), open Clipfire, create a stitched composition, hit AI suggest, confirm the title + caption reflect the actual transcripts (not generic).
  - Capture screen recording as evidence.
- Notes: **Dispatcher MUST NOT pick this up.** Per the new feedback memory, asking Austin to test a Debug build with no local server running is the exact failure mode we just paid for. This needs Austin's phone + a Release build + prod having #296.

### W021 — iOS-locked: smoke test xcode-run.sh ideviceinstaller fallback

- Status: pending
- Track: ios-locked
- Priority: P3
- Deps: PR #297 merged (done)
- AC:
  - Trigger the devicectl-tunnel-wedge condition (typically: leave a previous install partial, OR disconnect/reconnect mid-install) and confirm `xcode-run.sh` falls back to `ideviceinstaller` and the install still succeeds.
  - Add a one-line note to `ios/scripts/xcode-run.sh` header comment confirming "verified <date>".
- Notes: Hard to trigger reliably. AFK loop can't reproduce it. Park here so it's not forgotten.

### W022 — iOS-locked: TestFlight pipeline sanity check

- Status: pending
- Track: ios-locked
- Priority: P3
- Deps: (none)
- AC:
  - Confirm a new TestFlight build can be uploaded via the existing CD path and that the version bump from `bump-version.mjs` flows into the Info.plist correctly.
- Notes: TestFlight is the SHIPPING loop, not the dev loop (per global memory). Don't fire this just because we want to "test" something — fire it when external testers actually need a build.

## DEFERRED (multi-week — do not pick up without explicit Austin sign-off)

- **W023** — RevenueCat IAP integration (iOS in-app purchase). Multi-week, requires StoreKit testing + RevenueCat account setup + sandbox testers. Not investor-readiness blocking; web Stripe path is enough for the demo.
- **W025** — Android Stitch port. Android codebase exists at `polemicyst.com/android/` but the stitch+publish flow is iOS-only today. Multi-week, requires the Android UI patterns to mature.
- **W028a** — Twitter posting (full implementation, OAuth 1.0a + chunked video upload + rate-limit handling). W011 is the scaffold; full implementation is multi-week.
- **W028b** — Bluesky posting (full implementation, video blob upload). W010 is the scaffold; production hardening is multi-week.
- **W028c** — YouTube posting (resumable upload + OAuth 2.0 + quota management). W012 is the placeholder; full impl is multi-week.
- **W028d** — Instagram posting (Graph API + business account requirement + reels endpoint). W012 is the placeholder; multi-week and requires a Meta-approved app.
- **W028e** — TikTok posting (Content Posting API, approval-gated). W012 is the placeholder; multi-week and TikTok approval is the long pole.

## Dispatcher first-pick (right now)

**W002** — Prune locked agent worktrees (43 today). W001 shipped 2026-06-13.

After that, in order: W003 (PR #296 merge watch) → W005 (PR #296 completeness scan) → W006/W007 (vitest additions) → W008 (lint pass) → W009 (architecture doc) → W010 (Bluesky scaffold) → W013 (dashboard mobile audit) → W014 (TODO.md reconciliation) → W011 (Twitter scaffold).
