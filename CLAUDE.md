# Polemicyst — LLM / Claude Notes

This file is the **canonical log** for structural changes to the viral clip generation system, especially anything related to **LLM scoring, prompts, model orchestration, and safety**.

If you change how scoring works, how candidates are selected, which models are called, or how the UI maps to backend scoring knobs, **update this file**.

## Current LLM scoring architecture

### High-level flow

- **Candidate generation**: transcript windows produced server-side from `feedVideo.transcriptJson`
- **Cheap scoring (heuristic)**: deterministic 0..10 heuristic score for all candidates (fast + offline)
- **Multimodal scoring (Gemini)**: optional/capped rerank using frames + optional audio + transcript
- **Dynamic selection**: select a variable number of candidates based on score distribution (can return fewer, including 0)
- **Video-level decision**: explicit `hasViralMoments` decision computed from the scored distribution + selection opts

### Council-style scoring (single-call)

Instead of calling many models per candidate, we use a **single multimodal Gemini call** that returns multiple specialist subscores:

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
  - style is included in Gemini prompt (guidance), and stored in segment features
- **`saferClips`**:
  - requests `riskScore/riskFlags` in Gemini JSON
  - applies a risk penalty to final score and bumps minimum thresholds slightly

## Change log

### 2025-12-15

- Added **content-style + platform + safety** controls in UI and plumbed through:
  - `saferClips`, `targetPlatform`, `contentStyle` passed via queue → worker → backend scoring
- Added transcript-based **auto content style detection**.
- Added **platform-tuned window sizing** and safety-aware threshold bump.
- Upgraded Gemini scoring to return council-style subscores (`contextScore`, `captionabilityScore`, `hasViralMoment`, `riskScore`), and added deterministic aggregation.
- Added a **video-level virality decision** returned from `/api/clip-candidates` (`hasViralMoments`, reason, cutoff/top-score diagnostics).
- Improved the video-level decision with **platform-aware quality gates** (hook/context/captionability) and an optional `recommendation` string for what to try next when no moments are found.
- Dialog UX: made `DialogContent` scrollable by default and constrained tall media previews (feeds modal).
