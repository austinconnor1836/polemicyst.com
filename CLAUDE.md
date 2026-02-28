# Polemicyst — Claude Code Instructions

## Git workflow

- **Always create a new branch from `develop`** before starting work on a new task. Run `git checkout develop && git pull origin develop && git checkout -b <branch-name>` first.
- PRs should target `develop`, not `main`.
- Use descriptive branch names: `feature/<name>`, `fix/<name>`, `chore/<name>`.

---

# LLM / Claude Notes

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
