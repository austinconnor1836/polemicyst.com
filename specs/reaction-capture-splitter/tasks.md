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

> **Schema note:** the Prisma migration must be generated in an environment where the
> Prisma engine CDN is reachable (`npx prisma migrate dev -n reaction_capture_splitter`
> then `prisma generate`). The engine download is egress-blocked in the web session, so
> `schema.prisma` carries the models but the SQL migration + client are not generated here.

## P1 — Persistence

- [x] `CaptureTemplate` model (canvas, `creatorRect`, `referenceRect`, `referenceOrientation`).
- [x] `CompositionTrack.sourceCrop Json?`.
- [x] `ReactionSession` model + `Composition.reactionSessionId` + `Composition.creatorSourceCrop`.
- [x] Honor persisted reference `sourceCrop` in the server render path
      (`workers/clip-metadata-worker`) instead of always re-running `cropdetect`.
- [x] Extend the compositor to crop the **creator** source (`ComposeOptions.creatorSourceCrop`
      → crop-before-scale on all creator variants in `reactionCompose.ts`). Verified via
      real ffmpeg: renders a valid 720×1280 mobile split short.
- [x] Template CRUD: `GET/POST /api/capture-templates`, `PUT/DELETE /api/capture-templates/[id]`.
- [ ] Honor persisted `sourceCrop` in the **client** render path (`src/lib/client-render`)
      — server path only for now; client-render capture-split is out of v1 scope.

## P2 — Boundary detection service

- [x] Shared detector module `shared/util/reaction-boundaries.ts` (CLI + API share it).
- [x] `POST /api/reaction-sessions/detect-boundaries` `{ captureS3Url, referenceRect }`
      → `{ boundaries: [{ startS, endS, durationS, overLimit }] }` (downloads capture, runs detector).

## P3 — Ingest + fan-out

- [x] `POST /api/reaction-sessions` — create session, fan out one Composition per window
      with cropped/trimmed creator + reference tracks, enqueue both-layout renders (D4).
      Audio driven from the creator source; reference track muted (single mixed capture audio).
- [x] `GET /api/reaction-sessions` (list) + `GET/DELETE /api/reaction-sessions/[id]`
      (session + child compositions with outputs).

## P4 — UI

- [x] `/reactions/split` page: upload capture → mark creator/reference rects (numeric +
      live overlay) → detect boundaries (adjustable threshold/min-segment) → review windows
      → create shorts. Saved-layout picker + "save as layout". Entry point on `/reactions`.
- [ ] Drag-to-draw rect editing (numeric + overlay only for v1).
- [ ] Dedicated session results grid (currently lands on `/reactions`; child compositions
      render there).

## P5 — Over-limit handling / captions (follow-ups)

- [ ] Viral-scorer best-window reduction for over-limit reactions (default). Over-limit
      windows are currently flagged in the UI but still render full-length.
- [ ] Hard-split into numbered parts (opt-in).
- [ ] Captions: transcribe the capture once per session (not once per window) and reuse
      across the fanned-out compositions; wire creator + reference transcripts.

## Deferred (post-v1)

- [ ] On-screen marker boundary mode (fully automatic, single-file) — detector already
      accepts an external boundary list, so this is additive.
- [ ] "Have the reference files" mode: audio-fingerprint match + clean-original swap.
- [ ] Multiple reference regions per reaction.
