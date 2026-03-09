## LLM System Overview

This doc describes how Polemicyst uses LLMs to generate and rank viral clip candidates.

### Pipeline

- **Input**: `feedVideoId` → ensure transcript exists (`feedVideo.transcriptJson`)
- **Candidate generation**: transcript windowing with overlap
- **Scoring**:
  - heuristic pass (deterministic)
  - optional LLM rerank:
    - Gemini (multimodal: frames + optional audio + transcript)
    - Ollama (transcript-only, local-friendly)
- **Selection**: dynamic candidate selection based on score distribution (can return fewer than min; can be 0)
- **Decision**: compute `hasViralMoments` for the whole video (explicit “no-viral” outcome)
- **Output**: persisted `Segment` rows with `features` containing scoring metadata

### Council scoring (single-model, multi-signal)

Both providers are prompted to return multiple subscores in one call (hook/context/captionability/risk). Backend aggregates into a final score with weights based on:

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
- `includeAudio`: adds audio to multimodal scoring (Gemini only; cost ↑)
- strictness/dynamic selection: `minCandidates`, `maxCandidates`, `minScore`, `percentile`, `strictMinScore`, `maxGeminiCandidates`
- provider: `LLM_PROVIDER=gemini|ollama` is now just the fallback. Each user can persist a default via `/api/user/llm-provider` (stored on `User.defaultLLMProvider`) and override it per video in the Virality Settings modal. Options stay `gemini` (multimodal, hosted) or `ollama` (local, transcript + derived media stats). Ollama still honors `OLLAMA_BASE_URL` + `OLLAMA_MODEL`; Gemini needs `GOOGLE_API_KEY` (+ optional `GEMINI_MODEL`).
- When Ollama is selected and a local video file is available, we pre-compute lightweight audio/visual stats (volume, silence ratio, scene-change counts, brightness) and pass them into the prompt so the text-only model still benefits from media context.

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

### Training data collection

#### Clip scoring

Every LLM scoring call (Gemini and Ollama) is automatically logged to the `TrainingExample` table with:

- **Inputs**: transcript window, time bounds, target platform, content style, safety mode, frame count, audio seconds
- **Outputs**: all raw subscores (score, hookScore, contextScore, etc.), rationale, confidence
- **Context**: heuristic pre-score, post-aggregation final score, whether candidate was selected

Export via `GET /api/admin/training-data?format=jsonl&minConfidence=0.7&provider=gemini`.

#### Truth analysis & chat

Every truth analysis and analysis chat LLM call is logged to the `TruthTrainingExample` table with:

- **Inputs**: transcript text, analysis context (for chat), conversation history (for chat)
- **Outputs**: full analysis result JSON (for analysis) or chat response (for chat)
- **Quality signals**: overall credibility score, assertion/fallacy/bias counts
- **Type field**: `analysis` or `chat` to distinguish the two
- **Collector**: `TruthTrainingCollector` (`shared/lib/truth-training-collector.ts`)

Export via `GET /api/admin/training-data/truth?format=jsonl&provider=gemini&type=analysis`.

All collection is non-fatal and batched — same pattern as cost tracking.

### Truth analysis

Transcript-level analysis via `POST /api/feedVideos/:id/truth-analysis`:

- Extracts assertions, logical fallacies, biases, credibility score
- Supports full video or per-clip analysis (via `clipId` param)
- Providers: Gemini (up to 30k chars) or Ollama (configurable max via `OLLAMA_MAX_TRANSCRIPT_CHARS`)
- Results cached in `TruthAnalysis` table; GET returns cached result

### Analysis chat

Multi-turn conversational follow-up via `POST /api/feedVideos/:id/truth-analysis/chat`:

- System prompt includes condensed analysis summary + truncated transcript
- Gemini: uses `systemInstruction` + multi-turn `contents` array
- Ollama: uses `/api/chat` endpoint with system message
- Conversation history persisted in `AnalysisChat` + `AnalysisChatMessage` tables
- Web UI: `/details/[feedVideoId]/chat` — full-screen chat page
- iOS: `AnalysisChatView.swift` with NavigationLink from truth analysis results
