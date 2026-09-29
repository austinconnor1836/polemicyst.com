# LLM Strategy — Retire self-hosted Ollama, adopt managed API + fallback chain

**Status**: draft (agent-authored 2026-09-29, awaiting review)
**Owner**: Austin
**Related**: `CLAUDE.md` — "AI cost strategy — Gemini → self-hosted model",
`docs/LLM_SYSTEM.md`, `ARCHITECTURE.md`

## TL;DR

- **Recommendation**: **retire the self-hosted Ollama container**. Use
  **Groq as primary → Gemini 2.5 Flash-Lite as fallback → DeepInfra as
  tertiary**. Keep the Ollama code path for local dev + as the eventual
  Phase 4 distilled-model target.
- **Cost delta**: pre-launch, essentially **$0/mo saved on paper** because
  Groq's free tier + Gemini's free tier cover expected volume. But the
  Fly.io Ollama VM we _were_ about to provision would have cost
  ~$62–$186/mo (see cost model below) for _worse_ latency and no
  redundancy. So the real delta is **$62–$186/mo avoided** with a
  vendor-diverse fallback chain replacing a single-VM SPOF.
- **No new npm deps.** The adapter uses native `fetch`, same as every
  existing Ollama call site.
- **Feature-flagged rollout.** Legacy call sites keep working until the
  follow-up commit that switches them to `getLLM().chat(...)`.

## 1 — Findings from the grep (what Ollama is used for today)

Ollama is called from **9 distinct entry points**, all text-only:

| Entry point                  | File                                                                            | What it does                                                      | Volume shape                        |
| ---------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------- |
| Viral scoring (text path)    | `shared/lib/scoring/ollama-scoring.ts` → `ollama-adapter.ts`                    | Score a transcript window for virality when `LLM_PROVIDER=ollama` | ~5–15 windows / video               |
| Truth analysis               | `shared/lib/scoring/truth-analysis.ts` → `analyzeTranscriptWithOllama`          | Extract assertions / fallacies / biases from full transcript      | 1 call / user-triggered analysis    |
| Truth chat                   | `shared/lib/scoring/truth-chat.ts` → `chatWithOllama`                           | Multi-turn analysis chat                                          | 1 call / message                    |
| Metadata generation (shared) | `shared/lib/metadata-generation.ts` → `generateMetadataWithOllama`              | Post-transcription title + description                            | 1 call / video                      |
| Metadata generation (route)  | `src/app/api/feedVideos/[id]/generate-metadata/route.ts` → `generateWithOllama` | Same, called from web UI                                          | 1 call / manual regen               |
| Metadata worker              | `workers/clip-metadata-worker/generate/generateMetadataWorker.ts`               | Same, as a BullMQ worker                                          | 1 call / video                      |
| Legacy description gen       | `src/app/api/generateDescription/route.ts`                                      | Wraps `generateMetadataWithOllama` + adds hashtags                | 1 call / video (legacy)             |
| Social post caption          | `src/app/api/social-posts/generate-description/route.ts`                        | Reaction video caption for a chosen platform                      | 1 call / publish                    |
| Publish meta                 | `src/app/api/publish/generate-meta/route.ts`                                    | Multi-platform title + caption for a publish flow                 | 1 call / publish                    |
| Quote detection              | `shared/lib/quote-detection.ts` → `detectQuotesWithOllama`                      | Find cited quotes in a transcript                                 | 1 call / composition when enabled   |
| Thumbnail vision hint        | `shared/util/thumbnailGenerator.ts` → `moondream` calls                         | Score candidate frames for face + emotion                         | 1 vision call / thumbnail candidate |

**Models used**:

- `llama3` (default for every text task via `OLLAMA_MODEL`).
- `moondream` (default vision model for thumbnails via `OLLAMA_VISION_MODEL`).

**Prompt shape**: JSON-mode prompts of ~2–4KB, capped output ~256–2048
tokens. Every call site defensively repairs truncated JSON. All-in per
viral-scoring window is ~5–8k input tokens + ~1k output.

**Fallback logic today**:

- `generate-metadata` route: Gemini → Ollama.
- Everywhere else: Ollama → hard-error (no fallback).

**Per-video / per-user shape (pre-launch estimate)**:

- Video ingestion pipeline touches Ollama **~8–15 times** (scoring windows + metadata + optional truth + optional quote-detection).
- Chat + regen flows: 1 call per user action, bursty.
- Thumbnail vision: 1–10 frames per candidate, currently disabled by default.

## 2 — Cost model

Prices as of **2026-09-29**, sourced from each provider's public pricing page.

### 2a — Self-hosting on Fly.io (the alternative we're rejecting)

Fly.io Machines are billed per-second when running; the numbers below are
the "running 24×7" upper bound. See <https://docs.fly.io/about/pricing/>.

| VM preset          | RAM        | Approx $/mo (24×7)                           | Realistic Llama-3 8B q4 throughput    |
| ------------------ | ---------- | -------------------------------------------- | ------------------------------------- |
| shared-cpu-4x      | 8 GB       | ~$62/mo                                      | ~1–3 tok/s (unusable for interactive) |
| shared-cpu-8x      | 16 GB      | ~$124/mo                                     | ~2–4 tok/s                            |
| performance-cpu-4x | 8 GB       | ~$115/mo                                     | ~5–8 tok/s                            |
| performance-cpu-8x | 16 GB      | ~$230/mo                                     | ~8–12 tok/s                           |
| a10 GPU (per-hour) | 24 GB VRAM | ~$1.50/hr → $65/mo (10%) or $1,080/mo (24×7) | 40–80 tok/s                           |

The 8 GB shared-cpu-4x we were sizing for is functionally _worse than
Ollama on Fargate today_. Any managed inference API is 10–100× faster
per token AND has redundancy.

Fly.io GPU is competitive with managed inference only at high utilization
(> 40% of 24 h), which pre-launch traffic can't support.

**Fly.io self-host cost: ~$62–$230/mo for a single-VM SPOF with 1–12 tok/s.**

### 2b — Managed inference APIs

Blended price for our workload profile (~7 K input tokens + 1 K output
per scoring call, ~2 K input + 500 output per metadata / caption call).

| Provider       | Model                             | $/1M input                      | $/1M output   | Free tier                     | Tokens/sec (Artificial Analysis) | Notes                                          |
| -------------- | --------------------------------- | ------------------------------- | ------------- | ----------------------------- | -------------------------------- | ---------------------------------------------- |
| **Groq**       | `llama-3.1-8b-instant`            | $0.05 blended                   | $0.05 blended | Yes (generous, per-model RPM) | ~640 tok/s                       | Winner on price + speed                        |
| **Groq**       | `openai/gpt-oss-120b`             | $0.15                           | $0.60         | Yes                           | ~470 tok/s                       | Bigger model, still cheap                      |
| **Groq**       | `llama-3.3-70b-versatile`         | Enterprise-only (contact sales) | —             | Free tier only                | ~310 tok/s                       | Can't get paid access on self-serve            |
| **Gemini**     | `gemini-2.5-flash-lite`           | $0.10                           | $0.40         | Yes (RPM + daily)             | n/a                              | Already integrated                             |
| **Gemini**     | `gemini-2.5-flash`                | $0.30                           | $2.50         | Yes                           | n/a                              | Multimodal; used for scoring today             |
| **DeepInfra**  | `Llama-3.3-70B-Instruct-Turbo`    | $0.10                           | $0.32         | No                            | ~80 tok/s                        | Cheapest paid 70B                              |
| **DeepInfra**  | `Llama-3.1-8B-Instruct-Turbo`     | $0.02                           | $0.04         | No                            | ~200 tok/s                       | Cheapest 8B anywhere                           |
| **DeepInfra**  | `Qwen 2.5 72B Instruct`           | $0.36                           | $0.40         | No                            | —                                | Alt 70B-class model                            |
| **Together**   | `Llama-3.3-70B-Instruct-Turbo`    | $1.04                           | $1.04         | No                            | ~120 tok/s                       | 10× DeepInfra — reject                         |
| **Fireworks**  | `Llama-3.3-70B-Instruct`          | $0.90 blended                   | $0.90 blended | Limited                       | ~150 tok/s                       | Expensive vs DeepInfra                         |
| **Anthropic**  | `claude-haiku-4.5`                | $1.00                           | $5.00         | No                            | —                                | 10× Groq, 5× Gemini Lite                       |
| **OpenRouter** | `llama-3.3-70b-instruct` (broker) | ~$0.13                          | ~$0.40        | No                            | Varies                           | Broker; useful for redundancy but not cheapest |

**Sources**:

- Groq — <https://groq.com/pricing/> (blended 7:2:1 cache-hit / input / output).
- Gemini — <https://ai.google.dev/pricing> (standard tier).
- DeepInfra — <https://deepinfra.com/pricing> (per-token table).
- Together — <https://www.together.ai/pricing>.
- Fireworks — model page e.g. <https://fireworks.ai/models/fireworks/llama-v3p3-70b-instruct> ($0.90/M blended).
- Anthropic — <https://claude.com/pricing>.
- OpenRouter — inferred from typical upstream routing.

### 2c — Cost @ 1,000 videos / month (illustrative)

Per video: ~10 Ollama-equivalent calls, avg 5 K input + 800 output tokens
= ~50 K input + 8 K output tokens / video.

| Provider                             | Cost / 1K videos | Cost / 10K videos             |
| ------------------------------------ | ---------------- | ----------------------------- |
| Groq (llama-3.1-8b)                  | $2.90            | $29                           |
| DeepInfra (llama-3.1-8b)             | $0.42            | $4.20                         |
| Gemini 2.5 Flash-Lite                | $8.20            | $82                           |
| Gemini 2.5 Flash                     | $35              | $350                          |
| DeepInfra (llama-3.3-70b)            | $7.56            | $75.60                        |
| Claude Haiku 4.5                     | $90              | $900                          |
| Self-host on Fly (shared-cpu-4x/8GB) | $62/mo flat      | $62/mo flat + queue explosion |

**Conclusion**: **any of Groq / DeepInfra / Gemini Lite beat self-hosting
Ollama on Fly** unless we're doing millions of videos / month, at which
point a dedicated GPU stops looking crazy — but not before Phase 4 of the
distillation plan.

## 3 — Recommendation

### Primary: **Groq** (`llama-3.1-8b-instant`)

Why:

1. **Cheapest paid tier that's also free at pre-launch volume** — $0.05/M
   blended, plus a genuinely useful free tier.
2. **Fastest** — ~640 tok/s on the 8B model. Sub-second response for our
   ~1K output tokens/call. Solves the "Ollama on CPU is slow" complaint
   without any infra work.
3. **OpenAI-compatible** wire format — the adapter is dead simple.
4. **Low vendor lock-in** — same wire format works on Together / Fireworks /
   DeepInfra / OpenRouter, so switching primary is a 1-line env change.

### Fallback: **Gemini 2.5 Flash-Lite**

Why:

1. **Already integrated** — `GOOGLE_API_KEY` is set in prod, no new
   signup, no new secret to rotate. Zero human-time cost to enable.
2. **Cheap** — $0.10 in / $0.40 out per M, well under Gemini 2.0 Flash
   which the existing multimodal path uses.
3. **Different failure domain** from Groq. If Groq hits a service-wide
   429 or 5xx, Gemini is on entirely separate infra + team + region.

### Tertiary: **DeepInfra** (`llama-3.3-70b-instruct-turbo`)

Why:

1. **Cheapest 70B-class Llama** — $0.10 in / $0.32 out per M. Same cost
   as Gemini Flash-Lite but a larger + Llama-family model, so if Gemini
   is the outage this is a genuine capability replacement.
2. **Broad catalog** — DeepSeek V3, Qwen 2.5 72B, and every Llama tier
   are behind the same endpoint. Future model swaps cost 1 env var.
3. **No overlap** with Groq or Google outage domains.

### Why NOT `Anthropic Haiku`

10× the price of Groq for negligible quality gain on JSON-mode
transcript scoring. Save Anthropic for capability-differentiated use
cases (deep reasoning / tool use), not this workload.

### Why NOT `OpenRouter` primary

Broker adds latency + a middle-mile SPOF for no cost win vs direct
DeepInfra. It's a fine _fourth_ fallback, but not worth wiring in
pre-launch — the current 3-provider chain already has vendor diversity.

### Why NOT `keep self-hosted Ollama`

- $62–$230/mo for a single-VM SPOF.
- 1–12 tok/s on CPU vs 200–640 tok/s on Groq.
- Zero redundancy.
- All the same failure modes (OOM on big prompts, slow cold-starts on
  scale-to-zero) we've been fighting on Fargate.
- The eventual "distilled private model on Ollama" story from Phase 4
  is **still preserved** — this migration doesn't lose it, it just says
  "not on CPU-only Fly, and not until we have the fine-tuned weights."

## 4 — Fallback chain

Configured via `LLM_PROVIDER_CHAIN` (comma-separated). Default:

```
LLM_PROVIDER_CHAIN=groq,gemini,deepinfra
```

Behavior (implemented in `shared/lib/llm/llm-provider.ts`):

1. **At call time**, walk the chain in order.
2. For each provider, check `isAvailable()` first (credentials + reachable).
   Providers with no API key set are silently skipped — the chain acts as
   a declarative preference, not a strict requirement.
3. Fire `.chat()`. Catch:
   - **`LLMTransientError`** (429 / 5xx / network / timeout) → advance to
     next provider, log the failure with context.
   - **Any other error** (4xx auth, 400 bad prompt) → propagate. These
     represent bugs, not outages; burning through the whole chain would
     mask the real problem.
4. If EVERY provider fails, throw with a summary of every attempt.

Local dev pattern:

```
LLM_PROVIDER_CHAIN=ollama,groq,gemini
```

— tries local Ollama first, falls back to managed if the container isn't
running.

## 5 — Env vars

Consumed by `shared/lib/llm/*` (production stack):

| Var                                  | Required?               | Default                                             | Purpose                        |
| ------------------------------------ | ----------------------- | --------------------------------------------------- | ------------------------------ |
| `LLM_PROVIDER_CHAIN`                 | No                      | `groq,gemini,deepinfra`                             | Comma-separated fallback order |
| `GROQ_API_KEY`                       | Yes for Groq            | —                                                   | Groq API key                   |
| `GROQ_MODEL`                         | No                      | `llama-3.1-8b-instant`                              | Override model                 |
| `GOOGLE_API_KEY` or `GEMINI_API_KEY` | Yes for Gemini          | —                                                   | Google AI Studio key           |
| `GEMINI_MODEL`                       | No                      | `gemini-2.5-flash-lite`                             | Override model                 |
| `DEEPINFRA_API_KEY`                  | Yes for DeepInfra       | —                                                   | DeepInfra key                  |
| `DEEPINFRA_MODEL`                    | No                      | `meta-llama/Llama-3.3-70B-Instruct-Turbo`           | Override model                 |
| `TOGETHER_API_KEY`                   | Only if used            | —                                                   | For Together in chain          |
| `TOGETHER_MODEL`                     | No                      | `meta-llama/Llama-3.3-70B-Instruct-Turbo`           | Override                       |
| `FIREWORKS_API_KEY`                  | Only if used            | —                                                   | For Fireworks in chain         |
| `FIREWORKS_MODEL`                    | No                      | `accounts/fireworks/models/llama-v3p3-70b-instruct` | Override                       |
| `OPENROUTER_API_KEY`                 | Only if used            | —                                                   | For OpenRouter in chain        |
| `OPENROUTER_MODEL`                   | No                      | `meta-llama/llama-3.3-70b-instruct`                 | Override                       |
| `OPENROUTER_SITE_URL`                | No                      | `https://clipfire.ai`                               | Attribution header             |
| `OLLAMA_BASE_URL`                    | Only if Ollama in chain | —                                                   | Existing var, still respected  |
| `OLLAMA_MODEL`                       | No                      | `llama3`                                            | Existing var, still respected  |

**Add to `ENV_VARS.template`** in the follow-up commit.

## 6 — Signup checklist for Austin

Only the top of the chain strictly needs credentials at launch. The
others are for redundancy — enable them later.

- [ ] **Groq** — sign up at <https://console.groq.com>, generate an API
      key, add as `GROQ_API_KEY` to prod + preview envs. Free tier is
      enough for the first month or two of launch traffic.
- [x] **Gemini** — `GOOGLE_API_KEY` already exists in prod (used by the
      multimodal scoring path). Nothing to do; the chain will find it.
- [ ] **DeepInfra** — sign up at <https://deepinfra.com>, generate an API
      key, add as `DEEPINFRA_API_KEY` to prod. Prepay $10 to unlock
      higher rate limits.
- [ ] _(Optional)_ **Together** or **Fireworks** — only if you want a
      fourth fallback layer. Not worth the signup pre-launch.
- [ ] _(Optional)_ **OpenRouter** — same reasoning. Their attribution
      headers require setting `OPENROUTER_SITE_URL` to the real
      production domain.

## 7 — Migration steps

**Phase A — land the adapter (this PR)**:

- [x] `shared/lib/llm/` — new unified adapter package with fallback chain.
- [x] `docs/migration/llm-strategy.md` — this doc.
- [ ] `ENV_VARS.template` — document new env vars (follow-up commit).

**Phase B — swap the call sites (follow-up PR)**:

- Replace direct Ollama fetches in these files with `import { chat } from
'@shared/lib/llm'`:
  - `shared/lib/metadata-generation.ts` — trivial swap.
  - `shared/lib/scoring/truth-analysis.ts::analyzeTranscriptWithOllama`.
  - `shared/lib/scoring/truth-chat.ts::chatWithOllama`.
  - `shared/lib/scoring/ollama-scoring.ts::scoreSegmentWithOllama`.
  - `shared/lib/quote-detection.ts::detectQuotesWithOllama`.
  - `src/app/api/feedVideos/[id]/generate-metadata/route.ts`.
  - `src/app/api/generateDescription/route.ts`.
  - `src/app/api/publish/generate-meta/route.ts`.
  - `src/app/api/social-posts/generate-description/route.ts`.
  - `workers/clip-metadata-worker/generate/generateMetadataWorker.ts`.
- Add cost estimates to `CostTracker` — the unified adapter already
  returns `usage.estimatedCostUsd` so this is a plumbing change, not new
  logic.
- The `thumbnailGenerator.ts` moondream vision path is OUT OF SCOPE.
  Vision is not a strength of the managed providers we're picking, and
  it's an opt-in feature disabled by default. Keep it on Ollama for now
  (local dev) or gate it entirely off in prod.

**Phase C — feature-flag rollout**:

- Ship Phase B behind `LLM_UNIFIED_CHAIN=true`. When false, code paths
  keep their current direct-Ollama fetch. Flip in prod after a week of
  staging soak.
- Watch `CostEvent` for anomalies (unexpected input/output token counts
  from the new providers — models tokenize differently).

**Phase D — retire the container**:

- Delete `docker-compose.yml::ollama:` block.
- Delete `workers/ollama-worker/` (Dockerfile + start script).
- Remove Ollama sidecar from ECS task defs / Fly.io machine plan.
- Remove the "Ollama" option from the user-facing LLM provider selector
  in `src/app/settings/automation/page.tsx` (or relabel it "local dev
  only").
- Update `CLAUDE.md`, `docs/LLM_SYSTEM.md`, `ARCHITECTURE.md` to reflect
  new provider chain.

## 8 — Open questions

1. **Which env is Groq's free tier billed against?** Pre-launch we assume
   generous, but a single free-tier org across dev + staging + prod may
   hit the shared cap. Consider separate Groq orgs per env.
2. **Should we keep Ollama in the chain for dev machines?** Recommendation
   is yes — local hackers benefit from zero-network inference. Configure
   via `LLM_PROVIDER_CHAIN` per-env.
3. **Does the moondream vision path move too?** Not in this PR. Vision
   is a separable concern with different provider economics — a
   follow-up ADR should evaluate replacing moondream with Gemini
   multimodal or a cheap vision API.
4. **Do we need to gate paid provider usage per user tier?** The
   `PricingStrategy` doc argues "best quality for all tiers" — so no
   gating today. But at scale a `Free tier → Groq only` policy could
   preserve margin. Revisit after 30 days of production data.

## 9 — References

- Provider pricing (2026-09-29 fetched):
  - Groq: <https://groq.com/pricing/>
  - Gemini: <https://ai.google.dev/pricing>
  - DeepInfra: <https://deepinfra.com/pricing>
  - Together: <https://www.together.ai/pricing>
  - Fireworks: <https://fireworks.ai/pricing> + model pages
  - Anthropic: <https://claude.com/pricing>
- Fly.io machine pricing: <https://docs.fly.io/about/pricing/>
- Existing distillation roadmap: `CLAUDE.md` § "AI cost strategy —
  Gemini → self-hosted model"
- Existing LLM system doc: `docs/LLM_SYSTEM.md`
