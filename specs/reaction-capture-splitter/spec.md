# Spec: Reaction Capture Splitter

**Feature branch:** `claude/reaction-video-setup-tne1s5`
**Status:** Draft
**Created:** 2026-07-02

## Why

A creator records **one long screen capture** in which their camera feed sits next
to one or more **reference videos** they react to, back-to-back. Today ClipFire can
composite a creator + reference into mobile (9:16) and landscape (16:9), but it has
**no way to ingest a single multi-reaction capture and fan it out** into one short
per reaction. The creator must manually cut the recording, separate the feeds, and
build each composition by hand.

This feature automates that: **one long capture in → N mobile-first shorts out**, one
per reaction, each under the Shorts/Reels duration limit.

## Locked context (from the creator's workflow)

These two decisions constrain the design and are **assumed fixed** for v1:

1. **References are screen-captured, not downloaded.** The reference video only exists
   inside the capture; there is no clean original file to swap in. The reference feed
   must be **cropped out of the capture** for the output.
2. **The on-screen layout is fixed.** The creator commits to consistent positions —
   camera feed always in one rectangle, reference always in another. This makes de-mux
   a **deterministic crop**, not a computer-vision problem.

## What (user-visible outcomes)

1. A creator saves a **Capture Template** once: canvas size + `creatorRect` +
   `referenceRect` (pixels) + reference orientation (portrait/landscape).
2. The creator uploads a long capture and picks a template. ClipFire **detects the
   reaction boundaries** and shows them on a **review timeline** to confirm/adjust.
3. On confirm, ClipFire **fans out one Composition per reaction**, each with a
   creator track and a reference track cropped from the capture, trimmed to that
   reaction's window.
4. Each Composition renders **mobile + landscape** (existing default). For portrait
   references, mobile uses the reference full-frame with the creator's
   **background-removed head as an overlay** (existing person-segmentation + cutout).
5. Any reaction longer than the platform limit is reduced to the best window by the
   **existing viral-scorer**, or hard-split into numbered parts (creator's choice).

## Non-goals (v1)

- Audio-fingerprint matching against original reference files (references are
  screen-only here; that path belongs to a future "have the files" mode).
- Auto-detecting the on-screen layout (the template is user-defined; no CV).
- A new renderer — all compositing reuses `reactionCompose.ts` / client compositor.
- Multi-reference-per-reaction layouts (v1 assumes one reference region playing
  sequential videos).

## Acceptance criteria

- [ ] A standalone boundary-detector (`scripts/detect-reaction-boundaries.ts`) runs on
      an arbitrary capture and prints/writes segment windows, gated by a minimum
      segment length and flagging windows over the platform limit.
- [ ] `CaptureTemplate` model persists canvas + `creatorRect` + `referenceRect` +
      `referenceOrientation` per user.
- [ ] `CompositionTrack.sourceCrop` is **persisted** (nullable JSON), so a track can
      carry a user-defined crop rect instead of relying on runtime auto-`cropdetect`.
- [ ] An ingest endpoint accepts `{ captureS3Key, templateId, boundaries[] }` and
      creates one Composition per boundary window with correctly cropped + trimmed
      creator/reference tracks, then enqueues renders.
- [ ] Each generated Composition renders mobile + landscape via the existing pipeline
      with no renderer changes.
- [ ] `npm run lint` passes; build attempted.

## Open decisions (resolved in plan.md)

- **Boundary signal:** scene-cut on the reference crop (v1 default) vs. on-screen
  marker (opt-in, fully automatic) vs. hotkey side-channel log.
- **Over-limit handling:** viral-scorer best-window (default) vs. hard-split parts.
- **Grouping model:** a parent `ReactionSession` linking the capture to its child
  compositions, vs. loose compositions tagged with a session id.
