# Polemicyst — Claude Code Instructions

## Task pickup — READ THIS FIRST

1. Read `TODO.md` at the start of every session.
2. Pick the **highest-priority unchecked item** you can act on (Priority 1 → 2 → 3 → 4).
3. If an item needs secrets, production access, or env vars you don't have, **skip it** and move to the next one.
4. When you finish an item, mark it `[x]` in `TODO.md`, commit, and push.
5. Only work on **one item per session** unless the user asks otherwise.

## Git workflow

- **Always create a new branch from `develop`** before starting work on a new task. Run `git checkout develop && git pull origin develop && git checkout -b <branch-name>` first.
- PRs should target `develop`, not `main`.
- Use descriptive branch names: `feature/<name>`, `fix/<name>`, `chore/<name>`.

## Release process

We follow **semantic versioning** (`vMAJOR.MINOR.PATCH`) and use GitHub Releases as the source of truth.

### Automated release (preferred)

Use the **Prepare Release** GitHub Actions workflow (`Actions → Prepare Release → Run workflow`):

1. Select bump type (`patch` / `minor` / `major`) or enter an explicit version.
2. The workflow bumps `version.json`, generates a changelog, and opens a PR `develop → main`.
3. Review the PR, wait for CI, then merge with a **merge commit** (not squash).
4. The **Finalize Release** workflow auto-fires on merge — creates the GitHub Release + git tag.

Use the **dry run** checkbox to preview without making changes.

### Manual fallback

1. Update `version.json` and commit to `develop`.
2. Open a PR `develop → main` titled `Release vX.Y.Z`.
3. Merge with a merge commit, then:
   ```
   gh release create v0.2.0 --target main --title "v0.2.0" --notes "..."
   ```

### Versioning guidelines

- **Patch** (`v0.1.1`): bug fixes, dependency updates, formatting
- **Minor** (`v0.2.0`): new features, non-breaking API changes
- **Major** (`v1.0.0`): breaking changes, major architectural shifts

### What NOT to do

- Don't push directly to `main` — always go through a PR from `develop`.
- Don't create tags manually — let the workflow or `gh release create` handle it.
- Don't squash-merge release PRs — merge commits keep history traceable.

---

# LLM / Claude Notes

## Commit rules

Every commit **must** pass lint (`npm run lint`) and build (`npx next build`) before being created. Do not commit code that fails either step.

## Overview

This file is the **canonical log** for structural changes to the viral clip generation system, especially anything related to **LLM scoring, prompts, model orchestration, and safety**.

If you change how scoring works, how candidates are selected, which models are called, or how the UI maps to backend scoring knobs, **update this file**.

## Current LLM scoring architecture

### High-level flow

- **Candidate generation**: transcript windows produced server-side from `feedVideo.transcriptJson`
- **Cheap scoring (heuristic)**: deterministic 0..10 heuristic score for all candidates (fast + offline)
- **LLM rerank**: optional/capped rerank using frames + optional audio + transcript when Gemini is selected, or transcript + derived audio/visual stats when Ollama is selected (configurable via `LLM_PROVIDER`)
- **Dynamic selection**: select a variable number of candidates based on score distribution (can return fewer, including 0)
- **Video-level decision**: explicit `hasViralMoments` decision computed from the scored distribution + selection opts

### Council-style scoring (single-call)

Instead of calling many models per candidate, we use a **single LLM call** (Gemini multimodal or Ollama text-only) that returns multiple specialist subscores:

- `score` (overall)
- `hookScore`
- `contextScore`
- `captionabilityScore`
- `riskScore` + `riskFlags`
- `hasViralMoment` (boolean signal)
- `confidence` + `rationale`

The backend then **aggregates** these subscores deterministically into the final `candidate.score`, with different weights per target platform and optional risk penalties when “safer clips” is enabled.

## User-facing controls → backend behavior

### Virality settings (UI)

In the Feeds modal, users can set:

- **Target platform**: `all | reels | shorts | youtube`
- **Content style**: `auto | politics | comedy | education | podcast | gaming | vlog | other`
- **Safer clips**: boolean
- **Scoring mode**: `heuristic | hybrid | gemini`
- **Strictness preset**: maps to dynamic selection thresholds
- **Include audio**: increases multimodal analysis cost

### How those map to scoring

- **`targetPlatform`**:
  - tunes transcript window sizing (short for Reels/Shorts, longer for YouTube)
  - tunes aggregation weights (hook vs context vs captionability)
- **`contentStyle`**:
  - when `auto`, backend detects style from transcript keywords
  - style is included in the LLM prompt (guidance), and stored in segment features
- **`saferClips`**:
  - requests `riskScore/riskFlags` in the LLM JSON response
  - applies a risk penalty to final score and bumps minimum thresholds slightly

## Per-clip cost instrumentation

### Architecture

- **`CostEvent` table** (`prisma/schema.prisma`): stores one row per billable operation. Key fields: `userId`, `jobId` (== feedVideoId), `stage`, `provider`, `model`, token counts, `durationMs`, `estimatedCostUsd`. Indexed on `userId`, `jobId`, `createdAt`.
- **`CostTracker`** (`shared/lib/cost-tracking.ts`): in-memory accumulator created per worker job. Exposes `add()`, `track()` (wraps async ops with duration timing), and `flush()` (single `createMany()` at job end). Non-fatal — if flush fails, the pipeline continues.
- **`_cost` field** on `LLMScoreResult` (`shared/lib/scoring/llm-types.ts`): each scoring function (Gemini, Ollama) returns token counts, model name, and estimated USD alongside scores. The viral-scoring orchestrator feeds these into the `CostTracker`.

### Stages tracked

| Stage           | Provider        | What's captured                                                     |
| --------------- | --------------- | ------------------------------------------------------------------- |
| `download`      | s3              | file size, estimated S3 bandwidth cost, duration                    |
| `transcription` | whisper         | duration (cost is $0 for local Whisper)                             |
| `llm_scoring`   | gemini / ollama | input/output tokens, images, audio seconds, estimated USD, duration |
| `ffmpeg_render` | ffmpeg          | duration (local compute, $0)                                        |
| `s3_upload`     | s3              | estimated PUT + bandwidth cost                                      |

### Cost estimation

- **Gemini**: uses `usageMetadata` from API response when available; falls back to heuristic (258 tokens/image, 32 tokens/sec audio, ~4 chars/token text). Pricing: $0.075/1M input, $0.30/1M output (Flash).
- **Ollama**: extracts `prompt_eval_count` / `eval_count` from response. Cost is $0 (local).
- **S3**: $0.005/1K PUTs + $0.09/GB transfer.

### Admin dashboard

- **`/admin/costs`** — gated by `ADMIN_EMAIL` env var (server) / `NEXT_PUBLIC_ADMIN_EMAIL` (client sidenav).
- **API**: `GET /api/admin/costs?days=30` — returns totals, by-stage, by-job, and daily breakdowns.
- **Subscription API** (`/api/user/subscription`) now includes `costThisMonth` in the usage response.
- **`isAdmin()` helper**: `shared/lib/admin.ts`.

## Change log

### 2026-03-04 (parallel transcription)

- **Parallel YouTube transcription** — when importing a YouTube URL (via feed creation or URL import), transcription is now enqueued alongside the download job. YouTube captions resolve in ~100ms via HTTP while the download takes minutes, so the transcript is ready by the time the download finishes.
- Added **status gate** in transcription worker's auto-trigger: clip-generation only enqueues when `feedVideo.status !== 'pending'`, preventing premature triggering during parallel imports.
- Added `jobId: feedVideoId` dedup to `queueTranscriptionJob` to prevent duplicate transcription jobs.
- Fixed `s3Url: ''` in feed creation — now set to the YouTube URL so the transcription worker can fetch captions before the S3 download completes.
- Created `ARCHITECTURE.md` with full system topology, queue architecture, data flow diagrams, and key design decisions.

### 2026-03-04

- **Consolidated transcription into the clip-metadata-worker** — the transcription queue (`transcription`) is now consumed by the same ECS service as clip-generation (`prod-clip-worker` / `dev-clip-worker`). Previously, a standalone `transcription-worker` existed in code but was never deployed as an ECS service, so transcription jobs queued from the API were never processed.
- The clip-metadata-worker now listens on both `clip-generation` and `transcription` BullMQ queues.
- Transcription flow: API route (`POST /api/feedVideos/:id/transcribe`) enqueues to Redis → clip-metadata-worker picks it up → tries YouTube captions first (fast, ~100ms HTTP via yt-dlp) → falls back to Whisper if no captions → saves transcript to DB → auto-triggers clip-generation if feed has `autoGenerateClips` enabled.
- Fixed **`prisma: not found`** in the web Docker image — the standalone Next.js build didn't include `.bin/prisma` symlink. Added explicit symlink creation in the Dockerfile runner stage so `npx prisma migrate deploy` works on container startup.

### 2026-03-01

- Added **real-time progress tracking** for all long-running processes (transcription, clip generation, speaker transcription).
- New progress fields on `FeedVideo` model: `transcriptionStatus/Progress/Stage`, `clipGenerationProgress/Stage`, `speakerTranscriptionStatus/Progress/Stage` + migration.
- `updateJobProgress()` helper (`shared/lib/job-progress.ts`): non-fatal DB updates so pipeline continues even if progress write fails.
- `getJobProgress()` returns all three job types' progress for a given feed video.
- New `GET /api/feedVideos/:id/progress` endpoint for lightweight polling.
- Workers now emit granular progress updates at each pipeline stage (download → transcribe → build candidates → score → render clips).
- New `ProgressButton` component: shows inline progress bar + percentage inside the button itself during active jobs, with completed/failed state icons.
- New `JobProgressBar` component: standalone progress bar with stage label for embedding in cards/dialogs.
- `useJobProgress` hook: polls progress every 2s while any job is active, auto-stops when idle.
- Details page: transcribe button replaced with `ProgressButton` showing live progress; clip generation dialog shows `JobProgressBar`; no-clips placeholder shows real-time progress bar with percentage.
- Details page: auto-refreshes page data when transcription or clip generation completes.
- SpeakerTranscript component: generate button replaced with `ProgressButton`; progress bar shown during processing.
- Feeds/[id] page: Generate Clips button shows inline progress fill + stage text; empty clips section shows progress bar with percentage.
- Updated `openapi/spec.yaml` with `JobProgress` schema and `/api/feedVideos/{id}/progress` endpoint.

- Added **job log tracking** for transcription, clip-generation, and speaker-transcription jobs.
- New `JobLog` Prisma model + migration: records `queued`, `started`, `completed`, `failed` events with duration, error messages, and metadata.
- `logJob()` helper (`shared/lib/job-logger.ts`): non-fatal writes so pipeline continues even if logging fails.
- Transcription API (`POST /api/feedVideos/:id/transcribe`), trigger-clip API (`POST /api/trigger-clip`), transcription worker, speaker-transcription worker, and clip-metadata worker all emit job logs.
- Admin-only logs dashboard at `/admin/logs` with per-job-type summary cards, status/type/date filters, expandable log entries showing error details and metadata.
- Sidenav conditionally shows "Logs" link for admin user.

### 2026-02-27

- Added **iOS authentication** (Google Sign-In + Sign in with Apple) and unified backend Bearer JWT auth.
- Fixed JWT secret mismatch bug: mobile Google auth was signing with `AUTH_SECRET` but bearer decoder uses `NEXTAUTH_SECRET`.
- New unified auth helper `shared/lib/auth-helpers.ts` (`getAuthenticatedUser()`) — tries web session first, falls back to mobile Bearer JWT.
- Updated API routes (`feeds`, `feedVideos`, `clips`, `clips/[id]`, `user/subscription`) to accept Bearer tokens via `getAuthenticatedUser()`.
- New `POST /api/auth/mobile/apple` endpoint — verifies Apple identity tokens using `jose` + Apple JWKS.
- Updated `POST /api/auth/mobile/google` to accept iOS client ID (array audience).
- iOS: Added Google Sign-In SPM dependency, Keychain token storage, `AuthService`, `LoginView`, and auth-gated `App.swift`.
- New env vars: `APPLE_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID`, `NEXTAUTH_SECRET` (documented in `ENV_VARS.template`).

### 2026-02-25

- Added **per-clip cost instrumentation** across the full pipeline (download → transcription → LLM scoring → FFmpeg → S3 upload).
- New `CostEvent` Prisma model + migration.
- New `CostTracker` utility with batched, non-fatal DB writes.
- Gemini and Ollama scoring functions now return `_cost` metadata (tokens, model, estimated USD).
- Admin-only cost dashboard at `/admin/costs` with per-stage breakdown, per-job costs, daily totals, and margin projector.
- Sidenav conditionally shows "Costs" link for admin user.

### 2025-12-15

- Added **content-style + platform + safety** controls in UI and plumbed through:
  - `saferClips`, `targetPlatform`, `contentStyle` passed via queue → worker → backend scoring
- Added transcript-based **auto content style detection**.
- Added **platform-tuned window sizing** and safety-aware threshold bump.
- Upgraded the LLM scoring layer to return council-style subscores (`contextScore`, `captionabilityScore`, `hasViralMoment`, `riskScore`), and added deterministic aggregation.
- Added a **video-level virality decision** returned from `/api/clip-candidates` (`hasViralMoments`, reason, cutoff/top-score diagnostics).
- Improved the video-level decision with **platform-aware quality gates** (hook/context/captionability) and an optional `recommendation` string for what to try next when no moments are found.
- Dialog UX: made `DialogContent` scrollable by default and constrained tall media previews (feeds modal).
