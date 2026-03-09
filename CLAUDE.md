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

Use the **Prepare Release** GitHub Actions workflow (`Actions → Prepare Release → Run workflow`) or the `/release` slash command:

1. Select bump type (`patch` / `minor` / `major`) or enter an explicit version.
2. The workflow creates two PRs:
   - **Version bump PR** (`release/vX.Y.Z` → `develop`) — auto-merges once CI passes.
   - **Release PR** (`release-pr/vX.Y.Z` → `main`) — contains a generated changelog.
3. Review the release PR, wait for CI, then merge with a **merge commit** (not squash): `gh pr merge <number> --merge`
4. The **Finalize Release** workflow auto-fires on merge — creates the GitHub Release + git tag, and fast-forwards `develop` to `main`.

Use the **dry run** checkbox to preview without making changes.

### Manual fallback

1. Create a branch from `develop`, update `version.json`, and open a PR to `develop`.
2. After merge, create a temporary branch from `develop` (e.g. `release-pr/vX.Y.Z`) and open a PR to `main` titled `Release vX.Y.Z`. **Never use `develop` directly as the PR head** — GitHub's auto-delete will remove it.
3. Merge with a merge commit, then:
   ```
   gh release create v0.2.0 --target main --title "v0.2.0" --notes "..."
   ```

### Versioning guidelines

- **Patch** (`v0.1.1`): bug fixes, dependency updates, formatting
- **Minor** (`v0.2.0`): new features, non-breaking API changes
- **Major** (`v1.0.0`): breaking changes, major architectural shifts

### What NOT to do

- Don't push directly to `main` or `develop` — always go through a PR.
- Don't create PRs with `develop` as the head branch targeting `main` — GitHub's auto-delete will remove `develop` on merge. Use a temporary branch instead.
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

In the Connected Accounts modal, users can set:

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

## Model distillation pipeline

### Goal

Collect LLM scoring input/output pairs to fine-tune a smaller, self-hosted model that replicates Gemini/Claude scoring quality at zero inference cost.

### Architecture — clip scoring

- **`TrainingExample` table** (`prisma/schema.prisma`): stores one row per LLM scoring call. Captures full input context (transcript, time bounds, platform, style, safety mode, media metadata), all raw LLM subscores, post-aggregation final score, and whether the candidate was selected into the final clip set.
- **`TrainingCollector`** (`shared/lib/training-collector.ts`): in-memory accumulator (same pattern as `CostTracker`). Non-fatal — flush failures don't block the pipeline.
- **Collection point**: `scoreAndRankCandidatesLLM()` in `shared/lib/scoring/viral-scoring.ts` — after each scoring call returns.
- **Admin export**: `GET /api/admin/training-data?format=jsonl` — exports filtered examples as JSONL for fine-tuning.

### Architecture — truth analysis & chat

- **`TruthTrainingExample` table** (`prisma/schema.prisma`): stores one row per truth analysis or chat LLM call. Fields: `type` (`analysis` | `chat`), `transcriptText`, `analysisContext` (for chat: the analysis result used as context), `conversationHistory` (for chat: prior messages), `result` (full output JSON), quality signals (`overallCredibility`, `assertionCount`, `fallacyCount`, `biasCount`), cost metadata.
- **`TruthTrainingCollector`** (`shared/lib/truth-training-collector.ts`): same batched non-fatal pattern.
- **Collection points**: `POST /api/feedVideos/:id/truth-analysis` (analysis calls) and `POST /api/feedVideos/:id/truth-analysis/chat` (chat calls).
- **Admin export**: `GET /api/admin/training-data/truth?format=jsonl` — filterable by `provider`, `type`, `days`.

### Distillation workflow

1. Collect examples during normal scoring/analysis/chat (automatic, zero user action)
2. Export high-confidence examples via admin API (`?minConfidence=0.7&provider=gemini` for clips, `?provider=gemini` for truth)
3. Fine-tune a 7-8B model (Llama 3 / Mistral / Phi-3) using Unsloth or Axolotl
4. Deploy via Ollama (existing provider infrastructure, zero architecture changes)
5. A/B test against Gemini on held-out examples

## AI analysis chat

### Architecture

- **`AnalysisChat` + `AnalysisChatMessage` tables** (`prisma/schema.prisma`): persistent multi-turn conversation linked to a `FeedVideo` + `clipId`. One chat per video/clip, messages ordered by `createdAt`.
- **LLM functions** (`shared/lib/scoring/truth-chat.ts`): `chatWithGemini()` uses `systemInstruction` + multi-turn `contents` array; `chatWithOllama()` uses `/api/chat` endpoint with system message. System prompt includes a condensed analysis summary + truncated transcript.
- **API routes**: `GET /api/feedVideos/:id/truth-analysis/chat` (load history), `POST` (send message → AI response → save both to DB).
- **Web page**: `/details/[feedVideoId]/chat` — full-screen chat UI with analysis summary banner, suggestion chips, message bubbles, typing indicator.
- **iOS**: `AnalysisChatView.swift` with `AnalysisChatViewModel`, reachable via NavigationLink from `TruthAnalysisView`.
- **Cost tracking**: each chat call tracked as `llm_scoring` stage with `metadata: { type: 'truth_chat' }`.

## Change log

### 2026-03-09

- Added **AI analysis chat** — full-screen chat page where users discuss truth analysis results with the AI. Multi-turn conversation with persistent DB history.
- New `AnalysisChat` + `AnalysisChatMessage` Prisma models + migration.
- New `shared/lib/scoring/truth-chat.ts` — multi-turn Gemini (`systemInstruction` + `contents`) and Ollama (`/api/chat`) chat functions.
- New API routes: `GET/POST /api/feedVideos/:id/truth-analysis/chat` — load history, send messages.
- New web page: `/details/[feedVideoId]/chat` — chat UI with analysis summary, suggestion chips, message bubbles, typing indicator.
- Added "Chat about this" button to `TruthAnalysis.tsx` results footer.
- iOS: `AnalysisChatView.swift` + `AnalysisChatViewModel`, new API client methods, NavigationLink from `TruthAnalysisView`.
- Added **truth analysis + chat training data collection** for model distillation — every truth analysis and chat LLM call is now logged as a `TruthTrainingExample`.
- New `TruthTrainingExample` Prisma model + migration.
- New `TruthTrainingCollector` utility (`shared/lib/truth-training-collector.ts`).
- Hooked into `POST /api/feedVideos/:id/truth-analysis` and `POST /api/feedVideos/:id/truth-analysis/chat`.
- Admin-only export API: `GET /api/admin/training-data/truth?format=jsonl` with provider, type, and days filters.
- Added **training data collection** for model distillation — every LLM scoring call (Gemini/Ollama) is now logged as a `TrainingExample` with full input/output pairs.
- New `TrainingExample` Prisma model + migration.
- New `TrainingCollector` utility (`shared/lib/training-collector.ts`) — same non-fatal batched pattern as `CostTracker`.
- Hooked into `scoreAndRankCandidatesLLM()` in `shared/lib/scoring/viral-scoring.ts`.
- Wired into `clip-metadata-worker` — creates, passes, marks selected, and flushes alongside cost tracker.
- Admin-only export API: `GET /api/admin/training-data?format=jsonl` with provider, confidence, and selection filters.
- Training data seed script: `scripts/seed-training-data.ts` — ingests videos from public YouTube channels for training data collection.
- Updated `ARCHITECTURE.md` and `docs/LLM_SYSTEM.md` with training data documentation.

### 2026-03-04 (parallel transcription)

- **Parallel YouTube transcription** — when importing a YouTube URL (via connected account creation or URL import), transcription is now enqueued alongside the download job. YouTube captions resolve in ~100ms via HTTP while the download takes minutes, so the transcript is ready by the time the download finishes.
- Added **status gate** in transcription worker's auto-trigger: clip-generation only enqueues when `feedVideo.status !== 'pending'`, preventing premature triggering during parallel imports.
- Added `jobId: feedVideoId` dedup to `queueTranscriptionJob` to prevent duplicate transcription jobs.
- Fixed `s3Url: ''` in connected account creation — now set to the YouTube URL so the transcription worker can fetch captions before the S3 download completes.
- Created `ARCHITECTURE.md` with full system topology, queue architecture, data flow diagrams, and key design decisions.

### 2026-03-04

- **Consolidated transcription into the clip-metadata-worker** — the transcription queue (`transcription`) is now consumed by the same ECS service as clip-generation (`prod-clip-worker` / `dev-clip-worker`). Previously, a standalone `transcription-worker` existed in code but was never deployed as an ECS service, so transcription jobs queued from the API were never processed.
- The clip-metadata-worker now listens on both `clip-generation` and `transcription` BullMQ queues.
- Transcription flow: API route (`POST /api/feedVideos/:id/transcribe`) enqueues to Redis → clip-metadata-worker picks it up → tries YouTube captions first (fast, ~100ms HTTP via yt-dlp) → falls back to Whisper if no captions → saves transcript to DB → auto-triggers clip-generation if feed has `autoGenerateClips` enabled.
- Fixed **`prisma: not found`** in the web Docker image — the standalone Next.js build didn't include `.bin/prisma` symlink. Added explicit symlink creation in the Dockerfile runner stage so `npx prisma migrate deploy` works on container startup.

### 2026-03-01

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
- Updated API routes (`connected-accounts`, `feedVideos`, `clips`, `clips/[id]`, `user/subscription`) to accept Bearer tokens via `getAuthenticatedUser()`.
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
- Dialog UX: made `DialogContent` scrollable by default and constrained tall media previews (connected accounts modal).
