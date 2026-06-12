# Clipfire

Turn long-form video into short, postable clips. Creators connect a YouTube
channel or upload a file; Clipfire transcribes, scores the moments most likely
to go viral, renders portrait/landscape variants, and publishes them out to
the platforms creators already post to.

The same pipeline powers a separate truth-analysis surface: AI scores video
transcripts for credibility, surfaces fallacies and biases, and lets users chat
with the analysis.

- **Web:** [polemicyst.com](https://polemicyst.com) (`main` → prod) /
  [dev.polemicyst.com](https://dev.polemicyst.com) (`develop` → dev). The web
  app brand is mid-migration from "Polemicyst" to "Clipfire" — the domain hasn't
  cut over yet; the iOS and Android apps already ship as "Clipfire."
- **iOS:** TestFlight + App Store ([`ios/`](ios/)) — ships as Clipfire
  (`com.clipfire.app`).
- **Android:** Firebase App Distribution + Play Store ([`android/`](android/)) —
  ships as Clipfire.

---

## What it does

**For creators.**

1. **Ingest** — connect a YouTube channel, paste a URL, or upload a file. New
   videos auto-ingest via RSS-style polling.
2. **Transcribe** — YouTube captions first (~100 ms), Whisper fallback
   (`shared/lib/scoring`).
3. **Score** — every transcript window scored by a council-style LLM
   (Gemini multimodal as the teacher model; Ollama local as the replacement
   target — see [`docs/DISTILLATION_ROADMAP.md`](docs/DISTILLATION_ROADMAP.md)).
   Scores include hook strength, context, captionability, and risk; aggregated
   with platform-specific weights (Reels vs Shorts vs YouTube).
4. **Render** — FFmpeg trims, applies captions, person-cutout overlays, and
   optional quote-graphic overlays. Portrait and landscape variants.
5. **Publish** — generic publish endpoints + per-platform OAuth (currently
   stubbed for Twitter / Bluesky / YouTube / Instagram / TikTok; each is its
   own follow-on integration).

**For everyone (truth analysis).** Drop a video URL into the app; get a structured
breakdown of claims, fallacies, biases, and a credibility score. Multi-turn AI
chat against the analysis. Same scoring infra; different prompts and surfaces.

---

## Why the unit economics work

Every Gemini call writes a training example into `TrainingExample` (clip scoring)
or `TruthTrainingExample` (truth/chat). The roadmap is to fine-tune a 7-8B model
on the collected examples, deploy it via Ollama, and switch `LLM_PROVIDER=gemini`
to `ollama` — a config change, not a re-architecture (the
`ScoringProvider` port already abstracts the provider). Inference cost goes
from ~$X/minute of source video to $0.

Live cost-per-minute and margin-per-plan ship in `/admin/costs`. Live MRR / ARR /
churn / cohort ship in `/admin/metrics`. See
[`docs/INVESTOR_METRICS.md`](docs/INVESTOR_METRICS.md) for the snapshot template
and [`docs/PRICING_STRATEGY.md`](docs/PRICING_STRATEGY.md) for the pricing
rationale.

---

## Architecture (one screen)

Modular monolith. Single Next.js deploy + independently-scaled BullMQ workers
on AWS ECS Fargate. PostgreSQL via Prisma, Redis for queues, S3 for video
storage. Ports & adapters used only where provider replaceability genuinely
matters: `ScoringProvider` (Gemini / Ollama) and `StorageProvider` (S3).

Full system topology, queue architecture, and data flow in
[`ARCHITECTURE.md`](ARCHITECTURE.md). Conventions for code changes in
[`CLAUDE.md`](CLAUDE.md).

---

## Operating posture

- **Error tracking.** Sentry on Next.js + workers (`@sentry/nextjs`); Firebase
  Crashlytics on iOS and Android.
- **Uptime.** `/api/health` checks DB + Redis + S3 with 2.5 s timeouts; returns
  503 on any failure.
- **CloudWatch alarms.** 10 prod alarms on ALB 5xx, ECS CPU/memory, RDS
  connections/storage. All fan-out via a single SNS topic. See
  [`docs/OPS.md`](docs/OPS.md).
- **Per-clip cost tracking.** Every billable stage (download, transcription,
  LLM scoring, render, S3 upload) writes a `CostEvent` row. Non-fatal — flush
  failures never block the pipeline.
- **CI gates** (PR #257). Web + Android + iOS lint/build/test gates run on every
  PR to `develop` and `main`.

---

## Repository layout

```
polemicyst.com/
  src/                Next.js App Router (web)
  shared/             Cross-cutting libs (Prisma client, scoring port, storage port, cost tracking)
  prisma/             Schema + migrations
  backend/            Express services
  workers/            BullMQ workers (clip-metadata, transcription, poller, download)
  scripts/            One-shot utilities (incl. scripts/run-prod-migrate.sh)
  ios/                Native iOS (XcodeGen + Fastlane)
  android/            Native Android (Gradle + Fastlane)
  infrastructure/     Terraform module set (state lives in S3, not committed)
  docs/               INVESTOR_READINESS, INVESTOR_METRICS, DISTILLATION_ROADMAP, OPS, ARCHITECTURE, PRICING_STRATEGY, ...
```

---

## Local development

Prereqs: Node 18+, Docker (for Postgres + Redis), FFmpeg, AWS creds for S3.

```bash
git clone git@github.com:austinconnor1836/polemicyst.com.git
cd polemicyst.com
npm install
cp ENV_VARS.template .env.local        # fill in DATABASE_URL, S3_*, NEXTAUTH_SECRET, etc.
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
npx prisma migrate dev --schema=prisma/schema.prisma
npm run dev                            # https://localhost:3000 (self-signed)
```

Background workers (clip-metadata-worker, etc.) run automatically via docker
compose. To iterate on a worker, see [`DEV.md`](DEV.md).

---

## Branch + release flow

- Feature branches → `develop` (PR with auto-merge).
- `develop` → `main` only via a release PR. Versioning is semver; tagging is
  automated by `.github/workflows/finalize-release.yml`. See `CLAUDE.md` →
  "Release process" for the full workflow.
- Production `main`: [polemicyst.com](https://polemicyst.com)
- Development `develop`: [dev.polemicyst.com](https://dev.polemicyst.com)

---

## Deployment

Push to `develop` → dev environment; merge to `main` → prod. Both happen via
GitHub Actions (`.github/workflows/deploy.yml`).

Pending DB migrations apply via:

```bash
bash scripts/run-prod-migrate.sh
```

(Runs `prisma migrate deploy` from a one-shot ECS Fargate task in the prod
private subnets. Idempotent.)

---

## Documentation map

- [`docs/INVESTOR_READINESS.md`](docs/INVESTOR_READINESS.md) — gap analysis and work-item map that drove the 2026-06 readiness push.
- [`docs/INVESTOR_READINESS_LOG.md`](docs/INVESTOR_READINESS_LOG.md) —
  execution record + known debt + what's left for a human.
- [`docs/INVESTOR_METRICS.md`](docs/INVESTOR_METRICS.md) — always-on metrics
  snapshot template (numbers pulled from `/admin/metrics`).
- [`docs/DISTILLATION_ROADMAP.md`](docs/DISTILLATION_ROADMAP.md) — Gemini →
  private model timeline, A/B gate, rollback.
- [`docs/PRICING_STRATEGY.md`](docs/PRICING_STRATEGY.md) — pricing rationale,
  competitor positioning.
- [`docs/OPS.md`](docs/OPS.md) — alarm table, on-page response, coverage gaps.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system topology, queue architecture,
  data flow.
- [`CLAUDE.md`](CLAUDE.md) — coding conventions, Prisma rules, cost
  instrumentation architecture, AI cost strategy.

---

## License

Proprietary. Contact the founder via the email on the website.
