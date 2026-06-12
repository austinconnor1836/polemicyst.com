# Clipfire — Model Distillation Roadmap

> **Status:** Living roadmap. Source-of-truth for the phased plan that collapses Clipfire's
> AI inference cost from per-call Gemini billing to ~$0 per minute of source video
> processed.
>
> **Companion docs:** [`INVESTOR_READINESS.md`](./INVESTOR_READINESS.md) ·
> [`INVESTOR_METRICS.md`](./INVESTOR_METRICS.md) ·
> [`LLM_SYSTEM.md`](./LLM_SYSTEM.md) ·
> Canonical narrative: [`polemicyst.com/CLAUDE.md`](../CLAUDE.md) →
> "AI cost strategy — Gemini → self-hosted model" + "Model distillation pipeline".

---

## 1. Purpose

Roadmap from Gemini-as-teacher to a private fine-tuned model deployed via Ollama, reducing
Clipfire's AI inference cost to ~$0 per minute of source video processed. The plan is not
speculative — every prerequisite (port/adapter pattern, parallel Ollama provider, training
data collection) is already shipped and live in production. What remains is data
accumulation, fine-tune execution, and the A/B-gated production cutover.

---

## 2. Current state (Phase 2)

Quoted directly from [`polemicyst.com/CLAUDE.md`](../CLAUDE.md) → "AI cost strategy —
Gemini → self-hosted model":

| Phase                                | Status      | Gate (when does this phase unlock?)                                                         | Current count                                                                                                                                  |
| ------------------------------------ | ----------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 1: Build with Gemini**       | DONE        | All AI features (clip scoring, truth analysis, analysis chat) live on Gemini.               | n/a                                                                                                                                            |
| **Phase 2: Collect training data**   | ACTIVE      | Every production Gemini call writes a row to `TrainingExample` or `TruthTrainingExample`.   | _TODO: `SELECT COUNT(*) FROM "TrainingExample"` + truth counts — see [INVESTOR_METRICS.md §6](./INVESTOR_METRICS.md#6-training-data-flywheel)_ |
| **Phase 3: Fine-tune private model** | NOT STARTED | Unlocks when ≥1,000 examples collected per task type AND a held-out test slice is reserved. | Blocked on Phase 2 volume gate above.                                                                                                          |
| **Phase 4: Replace Gemini**          | NOT STARTED | Unlocks when fine-tuned model achieves ≥90% agreement with Gemini on the held-out test set. | Blocked on Phase 3.                                                                                                                            |

Phase 2 status is verifiable at any time via the admin export endpoints listed in
[`INVESTOR_METRICS.md` §6](./INVESTOR_METRICS.md#6-training-data-flywheel).

---

## 3. Architecture readiness

The swap from Gemini to a private fine-tune is **a config change, not a re-architecture.**
Everything below already ships in production today:

- **Ports/Adapters pattern for LLM scoring** — `shared/lib/scoring/scoring-provider.ts`
  defines the `ScoringProvider` port. `gemini-adapter.ts` and `ollama-adapter.ts` are
  parallel adapters. Adding a fine-tuned model is a new adapter class — `viral-scoring.ts`
  (the orchestrator) is untouched. See
  [`polemicyst.com/CLAUDE.md`](../CLAUDE.md) → "Ports & Adapters" → "LLM Scoring".
- **Env-driven provider switch** — `LLM_PROVIDER` env var (or per-call `providerOverride`)
  selects the adapter at runtime. No deploy required to flip; an ECS task variable update
  is sufficient.
- **Parallel pattern in truth-chat** — `chatWithGemini()` and `chatWithOllama()` in
  `shared/lib/scoring/truth-chat.ts` use the same provider-parallel pattern. Truth
  analysis (`truth-analysis.ts`) and quote detection (`shared/lib/quote-detection.ts`)
  follow the same shape.
- **Ollama is a first-class provider, not a stub** — already used in development today,
  feeds the same `_cost` accounting (with $0 cost since compute is local), and already
  emits its own `prompt_eval_count` / `eval_count` token counts for cost tracking.
- **Provider-agnostic cost tracking** — `CostEvent.stage = 'llm_scoring'` rows carry a
  `provider` column. Switching providers preserves the historical cost ledger and lets the
  admin dashboard show before/after deltas without code changes.

The architectural debt here is essentially zero. The work is the model science, not the
plumbing.

---

## 4. Before / after cost model

| Cost component                        | Today (Gemini Flash)                                                                                                           | After Phase 4 (Ollama, local compute)                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Per-minute LLM scoring cost           | _TODO: pull from [/admin/costs](../src/app/admin/costs/page.tsx) (`llm_scoring` stage, divided by processed minutes)_          | $0 (local compute, see [`polemicyst.com/CLAUDE.md`](../CLAUDE.md) → "Cost estimation" → Ollama)   |
| Per-minute truth-analysis cost        | _TODO: pull from [/admin/costs](../src/app/admin/costs/page.tsx) (`llm_scoring` stage where `metadata.type='truth_analysis'`)_ | $0 (local compute)                                                                                |
| Per-minute truth-chat cost            | _TODO: pull from [/admin/costs](../src/app/admin/costs/page.tsx) (`llm_scoring` stage where `metadata.type='truth_chat'`)_     | $0 (local compute)                                                                                |
| Resulting gross margin lift — Creator | n/a (baseline)                                                                                                                 | _TODO: pull from [/admin/costs](../src/app/admin/costs/page.tsx) margin projector after the swap_ |
| Resulting gross margin lift — Pro     | n/a (baseline)                                                                                                                 | _TODO: pull from [/admin/costs](../src/app/admin/costs/page.tsx) margin projector after the swap_ |
| Resulting gross margin lift — Agency  | n/a (baseline)                                                                                                                 | _TODO: pull from [/admin/costs](../src/app/admin/costs/page.tsx) margin projector after the swap_ |

The "today" column is reproducible at any time from the live cost ledger — the per-stage
breakdown on [`/admin/costs`](../src/app/admin/costs/page.tsx) divides total `CostEvent`
spend by `UsageMonth.processedMinutes` to yield a fully-loaded cost per minute. The
"after" column is structurally $0 for the LLM stages; remaining cost is the unchanged
download / transcription / FFmpeg / S3 pipeline.

> Compute hosting for the private model adds a fixed monthly bill (GPU instance or
> shared inference cluster). This converts a per-call variable cost into a fixed cost —
> margin improves as soon as throughput exceeds the breakeven point. The model is small
> enough (7-8B parameters per `CLAUDE.md`) that a single mid-tier GPU suffices.

---

## 5. Quality gate before switching

Cutover from Gemini to Ollama is **gated on a held-out A/B agreement test**. The
methodology:

1. **Hold-out set.** Reserve the last N (target 200+) examples from each training table
   (`TrainingExample`, `TruthTrainingExample` for both `analysis` and `chat`) before
   fine-tuning. Do not train on them.
2. **Parallel run.** Re-score every held-out example through both the production Gemini
   adapter and the candidate Ollama adapter. Use `providerOverride` in
   `scoreAndRankCandidatesLLM` (see `shared/lib/scoring/viral-scoring.ts`) — no code
   changes needed.
3. **Agreement metric.** For clip scoring: pairwise rank correlation on the `score` field
   plus exact-match rate on the `hasViralMoment` boolean. For truth analysis: agreement
   rate on `overallCredibility` bucket + Jaccard overlap on detected fallacy / bias sets.
   For chat: human spot-check on a 50-example random sample (no automatic gate possible
   for free-form generation).
4. **Pass threshold.** ≥90% agreement on the held-out set per task type, per the
   "When to switch" gate in [`polemicyst.com/CLAUDE.md`](../CLAUDE.md). Anything below
   triggers another fine-tune round, not a cutover.
5. **Staged rollout.** Once passing, flip `LLM_PROVIDER=ollama` first in dev, then a 10%
   sampled production rollout (using `providerOverride` keyed off `user.id % 10 === 0`),
   then 100%. Each stage holds for at least one billing cycle so cost + retention deltas
   are observable on [`/admin/metrics`](../src/app/admin/metrics/page.tsx) and
   [`/admin/costs`](../src/app/admin/costs/page.tsx).

---

## 6. Risk + rollback

| Risk                                                                                           | Mitigation                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Distilled model under-scores on novel content types not present in training set.               | Keep `LLM_PROVIDER=gemini` available as an instant rollback — env var flip + ECS task redeploy, no code change. The Gemini adapter is never deleted.                                                                  |
| Ongoing Gemini cost stays non-zero because we keep a "second opinion" gate forever.            | Phase distillation per task type so partial wins are bankable. Clip scoring first (highest volume → biggest cost impact), then truth analysis, then chat. Each task is independently switched.                        |
| A regression slips in between A/B test and 100% rollout because the held-out set was small.    | Mandatory 10% staged rollout window — if `paid_conversion` or `subscription_canceled` PostHog events deviate >20% from baseline during the staged window, automatic rollback by flipping `LLM_PROVIDER` back.         |
| Fine-tuned model drifts as content style mix shifts (new political moment, new content niche). | Keep `TrainingExample` collection live in parallel with Ollama serving. Refresh the fine-tune quarterly. Gemini stays warm as a "ground truth" re-score on a random 1% production sample to catch drift early.        |
| Self-hosted GPU instance fails or queue backs up.                                              | Fall back to Gemini on Ollama timeout — `viral-scoring.ts` is already provider-agnostic and the adapter factory in `scoring-provider.ts` can wrap an Ollama adapter with a Gemini fallback at the orchestrator level. |

---

## 7. Timeline

Anchored at **T+0 = first investor pitch**. All weeks-from-now numbers are placeholder
framing — they assume the Phase 2 volume gate clears at the projected rate; replace each
`_TODO_` with the real date once Phase 2 hits 1,000+ examples per task type.

| Milestone                                                                               | Target                               | Gate                                                                                                            |
| --------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| T+0 — Phase 2 active, training data accruing                                            | Now                                  | Verifiable: [`INVESTOR_METRICS.md` §6](./INVESTOR_METRICS.md#6-training-data-flywheel)                          |
| T+4 weeks — Phase 2 volume gate cleared                                                 | _TODO: depends on Gemini usage rate_ | ≥1,000 examples each in `TrainingExample`, `TruthTrainingExample` (`analysis`), `TruthTrainingExample` (`chat`) |
| T+8 weeks — Phase 3 fine-tune complete (clip scoring first)                             | _TODO: depends on Phase 2 close_     | Held-out A/B passes ≥90% agreement on clip scoring task                                                         |
| T+10 weeks — 10% staged production rollout for clip scoring                             | _TODO_                               | One billing cycle of observed cost + retention deltas with no >20% regression on PostHog conversion events      |
| T+12 weeks — 100% production cutover for clip scoring (Phase 4 complete for first task) | _TODO_                               | Sustained 10% staged rollout passes; `LLM_PROVIDER=ollama` flipped globally for clip scoring                    |
| T+16+ weeks — Truth analysis + chat fine-tunes, repeat A/B gate                         | _TODO_                               | Same pattern, lower priority because per-call volume is smaller                                                 |

The timeline is intentionally conservative on the fine-tune step — Phase 3 is not a
single training run, it is "iterate until ≥90% agreement". Plan for 2-4 fine-tune rounds
before clearing the quality gate.
