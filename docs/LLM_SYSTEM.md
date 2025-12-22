## LLM System Overview

This doc describes how Polemicyst uses LLMs to generate and rank viral clip candidates.

### Pipeline

- **Input**: `feedVideoId` → ensure transcript exists (`feedVideo.transcriptJson`)
- **Candidate generation**: transcript windowing with overlap
- **Scoring**:
  - heuristic pass (deterministic)
  - optional Gemini multimodal rerank (frames + optional audio + transcript)
- **Selection**: dynamic candidate selection based on score distribution (can return fewer than min; can be 0)
- **Decision**: compute `hasViralMoments` for the whole video (explicit “no-viral” outcome)
- **Output**: persisted `Segment` rows with `features` containing scoring metadata

### Council scoring (single-model, multi-signal)

Gemini returns multiple subscores in one call (hook/context/captionability/risk). Backend aggregates into a final score with weights based on:

- target platform (`reels`, `shorts`, `youtube`, `all`)
- safer-clips setting

### Content style detection

When `contentStyle="auto"`, backend detects style from transcript keywords and uses it to:

- tune prompts
- store detection metadata in segment features

### Knobs you can tune

- `targetPlatform`: changes window lengths and aggregation weights
- `contentStyle`: auto-detect or override
- `saferClips`: applies risk penalties and favors context-complete segments
- `includeAudio`: adds audio to multimodal scoring (cost ↑)
- strictness/dynamic selection: `minCandidates`, `maxCandidates`, `minScore`, `percentile`, `strictMinScore`, `maxGeminiCandidates`

### API response contract (clip candidates)

`POST backend /api/clip-candidates` returns:

- `sourceVideoId`: id of the source `Video` row used for segments
- `decision`: a structured video-level result
  - `hasViralMoments`: boolean
  - `reason`: `no_candidates | below_cutoff | failed_quality_gate | selected`
  - `diagnostics`: `{ topScore, top3Avg, top5Avg, cutoff, minScore, percentile, strictMinScore, total, aboveCutoff }`
  - `recommendation`: optional string with next-step guidance when `hasViralMoments=false`
  - `targetPlatform`, `contentStyle`, `contentStyleDetected`, `saferClips`, `scoringMode`
- `candidates`: persisted `Segment` rows (may be empty when `hasViralMoments=false`)
