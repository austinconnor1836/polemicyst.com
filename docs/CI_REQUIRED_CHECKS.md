# CI Required Checks & Safe-Merge Protocol

This documents how to make "merge it" safe-by-construction so that a build break
**cannot** reach `develop`/`main`, and how the auto-fix feedback loop hangs off it.

## Background — why this exists

PR #255 (pricing restructure) merged green, then **broke `develop`**: the Android
`compileDevDebugKotlin` step failed post-merge. Root cause was **not** the fix loop —
it was the **gate**:

- `ci.yml` runs on `pull_request` but only validated the **web** app (`tsc`/lint/`build`).
- The **Android/iOS** jobs lived only in `deploy.yml`, which runs on **push** — i.e.
  **after** merge. So mobile breakage was invisible until it was already on `develop`.

## The fix (this change)

`ci.yml` now also runs **Android Tests** and **iOS Tests** on every PR (path-filtered to
`android/**` / `ios/**`, with skip-jobs so the check always reports). `deploy.yml` is
unchanged — its jobs push images + deploy to ECS and must stay push-only.

## Action required: mark these as required status checks

GitHub branch protection can't be set from code in this repo, so apply this once in the
GitHub UI (or via API):

**Settings → Branches → Branch protection rules → `develop`** (repeat for `main`):

1. Enable **Require status checks to pass before merging**.
2. Add these required checks (names must match the job `name:` exactly):
   - `Lint & Build`
   - `Android Tests`
   - `iOS Tests`
3. Enable **Require branches to be up to date before merging** (optional but recommended).

> The skip-jobs (`*-skip`) reuse the same `name:` so the required context always reports
> success even when that area didn't change — required checks won't hang on unrelated PRs.

CLI equivalent:

```bash
gh api -X PUT repos/austinconnor1836/polemicyst.com/branches/develop/protection \
  -F required_status_checks.strict=true \
  -F 'required_status_checks.contexts[]=Lint & Build' \
  -F 'required_status_checks.contexts[]=Android Tests' \
  -F 'required_status_checks.contexts[]=iOS Tests' \
  -F enforce_admins=false \
  -F required_pull_request_reviews.required_approving_review_count=1 \
  -F restrictions=
```

Once set, auto-merge physically cannot fire until all three pass — so the post-merge
break that happened with #255 becomes a **pre-merge** failure the fix loop can act on.

## Safe-merge / auto-fix loop protocol (SKDW)

When asked to "merge it":

1. **Gate matches CI.** A task is only _done_ when the checks CI runs are green — not
   just what was runnable locally. If the environment can't run a check (e.g. no Android
   SDK / Xcode in a cloud session), the task is **"CI-gated, not locally verified"** and
   must not be marked done until the PR's corresponding check is green.
2. Enable auto-merge (squash) + subscribe to PR activity.
3. On each CI-failure event: **triage** (is it my code, or pre-existing infra like the
   iOS-26-SDK upload requirement?) → if mine, diagnose → fix on branch → push → checks
   rerun → repeat. Stay subscribed **until MERGED or CLOSED**.
4. Webhooks don't deliver CI _success_ / merge transitions, so poll (e.g. `send_later`
   self check-in) to detect green and, if branch protection requires a review the agent
   can't grant, complete via a direct admin merge once checks pass.

## Known non-actionable failure

`Build iOS Dev (TestFlight)` in `deploy.yml` currently fails at `upload_to_testflight`
with _"built with iOS 18.5 SDK … must be iOS 26 SDK"_. This is an App Store Connect
requirement (needs Xcode 26), **not** a code issue — do not spin the fix loop on it.
Tracked separately; fix by upgrading the CI runner's Xcode.
