# Tasks: Reaction Capture Splitter

Derived from `spec.md` + `plan.md`. Check off as landed on the feature branch.

## P0 — Prototype the linchpin (no app changes) — THIS COMMIT

- [x] `scripts/detect-reaction-boundaries.ts` — standalone scene-cut boundary detector.
  - [x] Args: `--input`, `--ref-rect x:y:w:h`, `--threshold`, `--min-segment`,
        `--max-segment`, `--blackdetect`, `--json`.
  - [x] Crop to the reference rect, run ffmpeg scene detection, parse cut timestamps.
  - [x] Merge sub-min-segment cuts; build `[t0,t1]` windows across full duration.
  - [x] Flag windows over the platform limit; print a table + optional JSON out.
  - [x] Runs with only `ffmpeg`/`ffprobe` on PATH — no DB, no env.
- [ ] Validate on a real capture; tune default `threshold` / `min-segment`. _(needs footage)_

## P1 — Persistence

- [ ] `CaptureTemplate` model + migration (canvas, `creatorRect`, `referenceRect`,
      `referenceOrientation`).
- [ ] `CompositionTrack.sourceCrop Json?` + migration.
- [ ] Honor persisted `sourceCrop` in the render path (server worker + client compositor)
      instead of always re-running `cropdetect`.
- [ ] Template CRUD: `POST/GET/PUT /api/capture-templates`.

## P2 — Boundary detection service

- [ ] Port the P0 detector into a worker/endpoint that reads the capture from S3.
- [ ] `POST /api/reaction-sessions/detect-boundaries` `{ captureS3Key, referenceRect }`
      → `{ boundaries: [{ startS, endS, overLimit }] }`.

## P3 — Ingest + fan-out

- [ ] `ReactionSession` model + migration (capture `s3Key`, `templateId`, boundaries).
- [ ] `POST /api/reaction-sessions` — create session, fan out one Composition per window
      with cropped/trimmed creator + reference tracks, enqueue renders (D4).
- [ ] Session read endpoint returning child composition ids + statuses.

## P4 — UI

- [ ] Capture Template editor (draw `creatorRect` / `referenceRect` over a still frame).
- [ ] Upload capture → pick template → **review timeline** to confirm/adjust boundaries.
- [ ] Results grid: per-reaction mobile + landscape outputs, publish actions.

## P5 — Over-limit handling

- [ ] `PLATFORM_LIMIT_S` config.
- [ ] Viral-scorer best-window reduction for over-limit reactions (default).
- [ ] Hard-split into numbered parts (opt-in).

## Deferred (post-v1)

- [ ] On-screen marker boundary mode (fully automatic, single-file) — detector already
      accepts an external boundary list, so this is additive.
- [ ] "Have the reference files" mode: audio-fingerprint match + clean-original swap.
- [ ] Multiple reference regions per reaction.
