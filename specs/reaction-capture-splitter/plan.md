# Plan: Reaction Capture Splitter

Technical approach for `spec.md`. Read this before touching code.

## Architecture facts (verified)

- **Crop-before-scale already exists** on both renderers via `sourceCrop`:
  - Server: `shared/util/reactionCompose.ts` — `TrackInfo.sourceCrop` (`:41-43`),
    `effectiveDimensions` (`:201-207`), and the `cropFilter` applied before every
    `scale` in `buildFilterComplex` (`:300-303`).
  - Client: `src/lib/client-render/compositor.ts` (`:40-72`, `:195`).
  - Today `sourceCrop` is **only** produced by auto-`cropdetect` for portrait-in-
    landscape sources (`workers/clip-metadata-worker/index.ts:789 sourceCrop: cropResult.crop`;
    `src/app/reactions/[id]/page.tsx:729 detectCropFromVideo`). It is **not persisted**
    on `CompositionTrack` — it is re-derived at render time. **This feature makes it a
    first-class, user-supplied, persisted crop.**
- **One composition already renders both layouts.** `POST /api/compositions/[id]/render`
  defaults `layouts = ['mobile','landscape']` and writes one `CompositionOutput` row per
  layout. No change needed to get both formats.
- **Mobile head-overlay already exists.** Portrait-reference mobile layout composites the
  creator over the reference (`reactionCompose.ts:322-335`); background removal is the
  MediaPipe person-segmentation adapter (`shared/lib/segmentation/`) also used by the
  stitch `freezeReveal` cutout (`shared/util/stitchCompose.ts`).
- **Best-window selection already exists.** The viral-scorer
  (`shared/lib/scoring/viral-scoring.ts`) picks high-scoring transcript windows — reuse it
  to reduce an over-limit reaction to a single ≤limit window.
- **Track creation** is `POST /api/compositions/[id]/tracks` (`trackType: creator|reference`,
  `startAtS`, `trimStartS`, `trimEndS`, up to 10 each). It **ignores client `s3Url`** and
  stores the canonical direct S3 URL. Multiple tracks can share the **same `s3Key`** (the
  capture) with different crops/trims — nothing forbids it.
- **Composition modes** are `pre-synced | timeline` (`schema.prisma:706`). Each generated
  reaction is a `pre-synced` composition: creator and reference share one timeline
  (`startAtS = 0`), differing only by crop.

## Key decisions

### D1 — Boundary signal: scene-cut on the reference crop (v1), with a review step

FFmpeg scene detection over **only the reference rectangle** finds where one reference
video ends and the next begins (a hard visual discontinuity). Corroborate with
`blackdetect` (fades between clips) and a **minimum-segment gate** to suppress cuts
_inside_ a single reference. Detection is never trusted blindly — the creator confirms/
nudges boundaries on a **review timeline** before fan-out.

- Opt-in upgrade (fully automatic, single-file): an **on-screen marker** in a fixed
  corner that increments per reference; detect it in that sub-region to get boundaries
  **and** a reference index. Deferred past v1 but the detector is designed to accept an
  external boundary list so this drops in later.

The prototype detector (`scripts/detect-reaction-boundaries.ts`) implements D1 standalone
so the signal quality can be validated on real footage **before** any app wiring.

### D2 — Over-limit handling: viral-scorer best-window (default), hard-split fallback

`PLATFORM_LIMIT_S` (Shorts/Reels ≈ 90s, configurable). If a reaction window exceeds it:
default to the viral-scorer's best ≤limit sub-window; offer hard-split into numbered
parts (`Part 1/N`) for creators who want the whole reaction.

### D3 — Data model

```prisma
model CaptureTemplate {
  id                   String  @id @default(cuid())
  userId               String
  name                 String
  canvasWidth          Int
  canvasHeight         Int
  creatorRect          Json    // { x, y, w, h }
  referenceRect        Json    // { x, y, w, h }
  referenceOrientation String  // portrait | landscape
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  @@index([userId])
}

// CompositionTrack: persist the crop the renderer already understands.
model CompositionTrack {
  // ...existing fields...
  sourceCrop Json?   // { x, y, w, h } | null — user-supplied, else runtime cropdetect
}
```

Wire `CompositionTrack.sourceCrop` into the render path so a persisted crop is honored
instead of re-running `cropdetect` (both server worker and client compositor already
consume a `sourceCrop` shape — this only changes the _source_ of the value).

Grouping: add a nullable `sessionId` (or a light `ReactionSession` row) so the N children
of one capture stay linked for review/regeneration. `ReactionSession` chosen — it holds
the capture `s3Key`, `templateId`, and the confirmed boundary list for reproducibility.

### D4 — Ingest orchestration

`POST /api/reaction-sessions` `{ captureS3Key, durationS, templateId, boundaries[] }`:

1. Create `ReactionSession`.
2. For each boundary window `[t0,t1]`:
   - Create a Composition (`mode: 'pre-synced'`).
   - Add a **creator** track: `s3Key = capture`, `sourceCrop = template.creatorRect`,
     `trimStartS = t0`, `trimEndS = t1`.
   - Add a **reference** track: `s3Key = capture`, `sourceCrop = template.referenceRect`,
     `trimStartS = t0`, `trimEndS = t1`, `startAtS = 0`.
   - If `t1 - t0 > PLATFORM_LIMIT_S`: apply D2.
   - Enqueue render (both layouts).
3. Return the session with its child composition ids for the review/results UI.

Transcription per track is already auto-enqueued by the tracks route; the viral-scorer and
caption burn-in consume those transcripts downstream with no new wiring.

## Build order

```
P0  Prototype (no app changes)  — scripts/detect-reaction-boundaries.ts  [THIS COMMIT]
      Validate scene-cut signal on a real capture; tune threshold/min-segment.
P1  Persistence                 — CaptureTemplate + CompositionTrack.sourceCrop
      + migration; honor persisted sourceCrop in render path.
P2  Boundary API                — port the detector into a worker/endpoint that reads
      the capture from S3 and returns boundaries for the review timeline.
P3  Ingest + fan-out            — POST /api/reaction-sessions (D4).
P4  UI                          — template editor, upload + review timeline, results grid.
P5  Over-limit                  — wire viral-scorer best-window / hard-split (D2).
```

P0 ships now because it de-risks the only novel algorithm without touching the app.

## Validation gate (every task)

- `npx prisma generate` after schema changes — must succeed.
- `npm run lint` — must pass on touched TS.
- `npx next build` — attempt; report env-related failures rather than silently passing.
- P0 script: runnable via `npx tsx scripts/detect-reaction-boundaries.ts` against a
  local file with only ffmpeg/ffprobe on PATH (no DB/env needed).
