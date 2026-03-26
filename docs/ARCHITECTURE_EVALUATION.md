# Architecture Evaluation — Clean Architecture Conformance & Recommendations

> Produced: 2026-03-26 | Scope: full monorepo (`/workspace`)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Architecture Map](#current-architecture-map)
3. [Clean Architecture Audit](#clean-architecture-audit)
4. [What the App Gets Right](#what-the-app-gets-right)
5. [Architectural Violations & Risks](#architectural-violations--risks)
6. [Recommended Target Architecture](#recommended-target-architecture)
7. [Migration Path](#migration-path)

---

## Executive Summary

The application is a **monorepo** containing a Next.js 15 frontend, ~99 API route handlers, an Express sidecar, five BullMQ workers, mobile clients (Android/iOS), and shared libraries. It follows a **pragmatic layered architecture** — not a formal clean architecture. Business logic is partially extracted into `shared/lib/` and `shared/services/`, but many API routes still contain inline database queries, validation, and response shaping. The scoring/LLM subsystem is the most architecturally mature area; CRUD endpoints are the least.

**Overall clean architecture conformance: ~35–40%.**

The best architecture for this app, given its multi-platform nature (web, iOS, Android), async worker pipelines, and multiple external integrations, is a **Modular Monolith with Vertical Slices and explicit Ports/Adapters for external services**. Full hexagonal architecture would over-engineer the CRUD paths; vertical slices give a pragmatic middle ground that scales both in code complexity and team size.

---

## Current Architecture Map

```
┌─────────────────────────────────────────────────────┐
│                   PRESENTATION                       │
│  Next.js Pages (App Router)  │  Mobile (iOS/Android) │
│  ~30 pages, client-heavy     │  REST consumers       │
└──────────────┬───────────────┴───────────┬───────────┘
               │ fetch('/api/...')         │ Bearer JWT
               ▼                          ▼
┌─────────────────────────────────────────────────────┐
│                  HTTP LAYER                           │
│  ~99 Next.js Route Handlers  │  Express (port 3001)  │
│  Auth + validation + Prisma  │  Ollama + legacy clip  │
│  (inconsistent patterns)     │  pipeline              │
└──────────────┬───────────────┴───────────┬───────────┘
               │ direct imports            │ relative
               ▼                          ▼
┌─────────────────────────────────────────────────────┐
│              SHARED BUSINESS LOGIC                   │
│  shared/lib/scoring/     — LLM scoring, truth        │
│  shared/lib/plans.ts     — billing rules + DB        │
│  shared/services/        — clip, feed, upload svc    │
│  shared/lib/cost-tracking, training-collector, etc.  │
│  shared/virality.ts      — domain types + defaults   │
└──────────────┬──────────────────────────────────────┘
               │ direct Prisma
               ▼
┌─────────────────────────────────────────────────────┐
│                  DATA / INFRA                        │
│  Prisma ORM              │  BullMQ Queues            │
│  PostgreSQL (RDS)        │  Redis                    │
│  S3 (AWS SDK v2 + v3)    │  Gemini/Ollama (fetch)    │
│  Stripe (SDK)            │  FFmpeg (child process)   │
└─────────────────────────────────────────────────────┘
               ▲
               │ direct Prisma + shared/lib
┌─────────────────────────────────────────────────────┐
│                    WORKERS                           │
│  clip-metadata-worker  (clip-gen, transcription,     │
│                         reaction, thumbnail)         │
│  poller-worker         (interval + feed-download)    │
│  video-download-worker (download → S3 → transcribe)  │
│  transcription-worker  (Whisper / YouTube captions)   │
│  llm-worker            (standalone Ollama scorer)     │
└─────────────────────────────────────────────────────┘
```

### Dependency Flow Summary

| From → To | Pattern |
|-----------|---------|
| Pages → API Routes | Client `fetch` (good — HTTP boundary) |
| API Routes → Prisma | Direct `prisma.*` calls (no repository layer) |
| API Routes → shared/services | Partial — `trigger-clip` delegates; most routes inline |
| API Routes → shared/lib | Scoring, auth helpers, cost tracking (good extraction) |
| Workers → shared/lib | Heavy — scoring, transcription, plans, queues (good) |
| Workers → Prisma | Direct (no repository layer) |
| shared/lib → Prisma | Direct — `plans.ts`, `auth-helpers.ts`, services |
| Components → @prisma/client | One instance (`PlatformContext.tsx` — type leak) |
| shared → src/ | None (clean direction ✓) |

---

## Clean Architecture Audit

Clean Architecture (Robert C. Martin) prescribes four concentric layers with the **Dependency Rule**: source code dependencies must point inward — outer layers depend on inner layers, never the reverse.

| Layer | Clean Arch Expectation | Current State | Conformance |
|-------|----------------------|---------------|-------------|
| **Entities** (domain models) | Pure domain objects with business rules, no framework deps | Prisma models serve as entities; no separate domain layer | ❌ 10% |
| **Use Cases** (application logic) | Orchestrate entities, define app-specific rules, no I/O details | Partially in `shared/services/` and `shared/lib/scoring/`; most logic in route handlers | ⚠️ 35% |
| **Interface Adapters** (controllers, gateways, presenters) | Translate between use cases and external formats | Route handlers conflate controller + use case + repository; no presenter pattern | ⚠️ 30% |
| **Frameworks & Drivers** (DB, web, external) | Outermost ring; details isolated behind interfaces | Prisma, S3, Stripe, Gemini used directly without ports/interfaces | ❌ 20% |

### Dependency Rule Violations

1. **Business logic depends on Prisma directly.** `plans.ts` (domain rules about quotas) imports and queries `prisma`. In clean architecture, domain/use-case layers should define repository interfaces; Prisma is an implementation detail.

2. **API route handlers are "god functions."** Most routes handle auth → validation → business logic → DB queries → response formatting in a single function. No separation between controller, use case, and repository concerns.

3. **No domain entity layer.** The codebase uses Prisma-generated types as domain entities. There are no domain objects with business invariants or methods. Types like `ClipCandidate` in `viral-scoring.ts` are the closest thing to domain entities but are defined inside the scoring module rather than in a shared domain layer.

4. **External service coupling is direct.** S3 (`aws-sdk`), Stripe, Gemini, Ollama are called directly from business logic. No port/adapter pattern means switching providers requires touching business logic files.

5. **Duplicate type definitions.** `ScoringMode`, `ContentStyle`, `TargetPlatform` are defined in both `shared/virality.ts` (UI contract) and `shared/lib/scoring/viral-scoring.ts` (scoring internals) with slightly different shapes (`auto` only in virality.ts). This violates the single source of truth principle.

---

## What the App Gets Right

Despite not conforming to clean architecture, the codebase has several strong architectural qualities:

### 1. Clean Dependency Direction in Shared
`shared/` never imports from `src/`. Workers and API routes both import from `shared/`, keeping the dependency arrow consistent. This is the most important structural quality the app has.

### 2. Well-Extracted Scoring Domain
The `shared/lib/scoring/` subsystem is the architectural gold standard of this codebase:
- **Orchestrator pattern**: `viral-scoring.ts` coordinates the flow
- **Provider isolation**: `gemini-scoring.ts` and `ollama-scoring.ts` are selected via `LLM_PROVIDER` with dynamic imports
- **Composable cross-cutting concerns**: `CostTracker` and `TrainingCollector` follow identical accumulator-then-flush patterns and are injected by callers

### 3. Async Boundary via Message Queues
The API → BullMQ → Worker boundary is a genuine architectural boundary. Route handlers enqueue work; workers process it independently. This is good separation of concerns and enables independent scaling.

### 4. Unified Auth Helper
`getAuthenticatedUser()` in `shared/lib/auth-helpers.ts` provides a single entry point for both cookie-based (web) and Bearer (mobile) authentication, falling back gracefully.

### 5. Service Extraction (Partial)
`shared/services/clip-service.ts`, `feed-service.ts`, and `upload-service.ts` represent genuine use-case extraction from route handlers. The `trigger-clip` route is a model: thin controller that delegates to the service.

### 6. Non-Fatal Side Effects Pattern
Cost tracking, training data collection, and job logging all follow a consistent "accumulate + flush, never block the pipeline" pattern. This is mature operational thinking.

---

## Architectural Violations & Risks

### Critical (high impact on maintainability)

| # | Issue | Impact | Example |
|---|-------|--------|---------|
| 1 | **No repository layer** — Prisma queries scattered across 99+ route files and service modules | Changing the ORM or query patterns requires touching every file | `clips/route.ts`, `feedVideos/route.ts`, `plans.ts` all query `prisma` directly |
| 2 | **Route handler god functions** — auth, validation, business logic, DB, response formatting in one function | Untestable without spinning up Next.js; impossible to reuse logic across REST/GraphQL/CLI | Every route handler except `trigger-clip` |
| 3 | **No domain entity layer** — Prisma types serve as domain entities | Business invariants (e.g., "a clip must have a source video") exist only as scattered `if` checks in routes, not as enforced domain rules | `Video` used for both source videos and clips, distinguished only by `sourceVideoId` nullability |
| 4 | **Inconsistent auth patterns** — some routes use `getAuthenticatedUser()`, others use `getServerSession()` directly | Mobile Bearer tokens silently fail on routes using `getServerSession()` only | Stripe routes, some template routes |

### Moderate (technical debt with growing cost)

| # | Issue | Impact |
|---|-------|--------|
| 5 | **Dual AWS SDK versions** — `aws-sdk` v2 in `shared/lib/s3.ts`, `@aws-sdk/client-s3` v3 in workers/routes | Doubled bundle size, inconsistent API patterns, v2 in maintenance mode |
| 6 | **Duplicate type definitions** — `ScoringMode` etc. defined in two places with different values | Changes require updating both files; easy to introduce drift |
| 7 | **Redux wired but unused** — Store wraps entire app, but only `uiSlice` (theme/menu) exists and even that is bypassed by navbar's own `localStorage` | Dead code and misleading architecture signals |
| 8 | **Express sidecar is vestigial** — 3 routes (ping, Ollama generate, legacy clip-gen); uses Docker hostnames that don't resolve locally | Maintenance burden with no clear value; clip generation moved to workers |
| 9 | **MUI + Radix/shadcn dual UI stack** — MUI in navbar/sidenav, Radix everywhere else | Inconsistent styling, larger bundle, confusing for contributors |
| 10 | **OpenAPI spec covers ~24 of ~99 routes** — mobile clients have no contract for most endpoints | API drift between platforms, manual sync burden |

### Low (cosmetic or future concern)

| # | Issue |
|---|-------|
| 11 | `/api/page.tsx` coexists with `/api/*` route handlers — confusing URL space |
| 12 | `clips-genie/` and `multiple-file-upload/` are near-duplicates |
| 13 | No error tracking service (Sentry, etc.) — `console.error` only |
| 14 | Inconsistent response shapes — some routes return plain text errors, others JSON |

---

## Recommended Target Architecture

### Why Not Full Clean Architecture?

Full hexagonal / clean architecture would introduce **repository interfaces, use case classes, DTOs, mappers, and presenters** for every endpoint. For a team shipping a product with 99 endpoints, this is over-engineering. The overhead of interface definitions and mapping layers would slow development without proportional benefit for CRUD-heavy features.

### Recommended: Modular Monolith with Vertical Slices

The best fit for this app is a **Modular Monolith with Vertical Slices** and **Ports/Adapters only where complexity or replaceability warrants it**.

```
src/
├── modules/                      # Vertical slices by business domain
│   ├── clips/
│   │   ├── clips.repository.ts   # Prisma queries for clips
│   │   ├── clips.service.ts      # Business logic (quota checks, enqueue)
│   │   ├── clips.controller.ts   # Request parsing, response formatting
│   │   ├── clips.types.ts        # Domain types for this module
│   │   └── clips.routes.ts       # Route handler thin wrappers
│   ├── feeds/
│   │   ├── feeds.repository.ts
│   │   ├── feeds.service.ts
│   │   └── ...
│   ├── scoring/                   # Already well-structured in shared/lib/scoring
│   │   ├── scoring.ports.ts       # Interface: LLMProvider { score(...) }
│   │   ├── gemini.adapter.ts      # Implements LLMProvider
│   │   ├── ollama.adapter.ts      # Implements LLMProvider
│   │   ├── scoring.service.ts     # Orchestrator (current viral-scoring.ts)
│   │   └── ...
│   ├── billing/
│   │   ├── billing.ports.ts       # Interface: PaymentGateway
│   │   ├── stripe.adapter.ts      # Implements PaymentGateway
│   │   ├── plans.ts               # Pure domain rules (no Prisma)
│   │   └── ...
│   ├── storage/
│   │   ├── storage.ports.ts       # Interface: ObjectStorage
│   │   ├── s3.adapter.ts          # Implements ObjectStorage (one SDK version)
│   │   └── ...
│   ├── auth/
│   │   ├── auth.service.ts        # Unified auth (current auth-helpers.ts)
│   │   └── ...
│   ├── publishing/                # Already partially extracted
│   ├── truth-analysis/
│   └── admin/
├── shared/
│   ├── domain/                    # Shared domain types (ClipCandidate, etc.)
│   ├── ports/                     # Cross-cutting port interfaces
│   └── infra/                     # Cross-cutting infra (Prisma client, Redis, queue defs)
└── app/                           # Next.js App Router (thin routing layer)
    └── api/
        ├── clips/route.ts         # → delegates to modules/clips/clips.controller
        ├── feeds/route.ts         # → delegates to modules/feeds/feeds.controller
        └── ...
```

### Key Principles of This Architecture

1. **Vertical slices over horizontal layers.** Each business domain (clips, feeds, billing, scoring) owns its full stack: types, repository, service, controller. This keeps related code together and reduces cross-module coupling.

2. **Ports/Adapters only where warranted.** The scoring subsystem (Gemini vs Ollama), storage (S3), and billing (Stripe) benefit from interfaces because provider replaceability is a real requirement. CRUD queries against Prisma do not need a formal repository interface — a simple `clips.repository.ts` that centralizes queries is sufficient.

3. **Route handlers become thin.** Each `route.ts` file in `app/api/` should be 5–15 lines: parse request → call controller → return response. All logic lives in the module.

4. **Domain types are explicit.** Instead of using raw Prisma types everywhere, each module defines its own domain types. Prisma types are internal to the repository layer.

5. **Shared domain kernel.** Types used across multiple modules (e.g., `ClipCandidate`, `ViralitySettings`) live in `shared/domain/` — one definition, no duplication.

6. **Workers import from modules.** Workers use `modules/scoring/scoring.service.ts` instead of reaching into `shared/lib/scoring/` directly. This keeps the module boundary clear.

### Where Ports/Adapters Apply

| Concern | Port (Interface) | Adapters | Why |
|---------|-----------------|----------|-----|
| LLM Scoring | `LLMProvider` | `GeminiAdapter`, `OllamaAdapter`, future fine-tuned model | Explicit roadmap to swap providers |
| Object Storage | `ObjectStorage` | `S3Adapter` | Consolidate dual SDK versions; testability |
| Payment | `PaymentGateway` | `StripeAdapter` | Standard practice; enables test doubles |
| Transcription | `Transcriber` | `WhisperAdapter`, `YouTubeCaptionsAdapter` | Already two sources; might add more |

### Where Ports/Adapters Are Overkill

| Concern | Why Skip |
|---------|----------|
| Database (Prisma) | Single DB engine for foreseeable future; repository files suffice |
| Auth (NextAuth) | Framework-specific; wrapping adds no value |
| Queue (BullMQ) | Tight Redis coupling is fine; unlikely to change |
| FFmpeg | CLI tool, not a swappable service |

---

## Migration Path

### Phase 1: Repository Extraction (Low Risk, High Value)

Move inline Prisma queries from route handlers into co-located repository files. This is purely mechanical — no behavior changes. Start with the highest-traffic domains.

**Before:**
```ts
// src/app/api/clips/route.ts (current — 40 lines of mixed concerns)
export async function GET(req) {
  const user = await getAuthenticatedUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const clips = await prisma.video.findMany({
    where: { userId: user.id, OR: [{ sourceVideoId: { not: null } }, ...] },
    orderBy: { createdAt: 'desc' },
    include: { sourceVideo: { select: { id: true, videoTitle: true, s3Url: true } } },
  });
  return NextResponse.json(clips);
}
```

**After:**
```ts
// src/modules/clips/clips.repository.ts
export async function findClipsByUser(userId: string) {
  return prisma.video.findMany({
    where: { userId, OR: [{ sourceVideoId: { not: null } }, ...] },
    orderBy: { createdAt: 'desc' },
    include: { sourceVideo: { select: { id: true, videoTitle: true, s3Url: true } } },
  });
}

// src/app/api/clips/route.ts (thin)
export async function GET(req) {
  const user = await getAuthenticatedUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const clips = await findClipsByUser(user.id);
  return NextResponse.json(clips);
}
```

**Domains to migrate first:** clips, feedVideos, connected-accounts (highest route count and query complexity).

### Phase 2: Standardize Auth & Error Handling

1. Replace all `getServerSession()` calls in route handlers with `getAuthenticatedUser()` for consistent mobile support.
2. Create a shared `apiResponse` helper that enforces JSON error shapes.
3. Consider a route wrapper/middleware pattern for auth + error handling.

### Phase 3: Port/Adapter for Scoring & Storage

1. Define `LLMProvider` interface. Wrap `gemini-scoring.ts` and `ollama-scoring.ts` as adapters.
2. Consolidate S3 to AWS SDK v3 only. Create `ObjectStorage` port. Replace all S3 call sites.
3. Extract `plans.ts` domain rules from Prisma queries — pure functions that take quota counts as inputs.

### Phase 4: Cleanup

1. Remove Express sidecar (merge any needed routes into Next.js API).
2. Remove Redux (replace with React Context for the theme toggle).
3. Consolidate MUI → Radix/shadcn for navbar/sidenav.
4. Deduplicate `clips-genie/` and `multiple-file-upload/`.
5. Expand `openapi/spec.yaml` to cover all public endpoints.
6. Unify `shared/virality.ts` and `shared/lib/scoring/viral-scoring.ts` type definitions.

---

## Summary of Recommendations

| Priority | Action | Effort | Impact |
|----------|--------|--------|--------|
| **P0** | Extract repositories from route handlers | Low | High — testability, DRY |
| **P0** | Standardize auth to `getAuthenticatedUser()` everywhere | Low | High — mobile parity |
| **P1** | Shared API error response helper | Low | Medium — consistency |
| **P1** | LLM Provider port/adapter | Medium | High — enables model distillation goal |
| **P1** | Consolidate S3 to SDK v3 + storage port | Medium | Medium — reduces bundle, single pattern |
| **P2** | Remove Express sidecar | Low | Low — reduces surface area |
| **P2** | Remove unused Redux | Low | Low — reduces confusion |
| **P2** | Deduplicate type definitions | Low | Medium — prevents drift |
| **P3** | MUI → Radix consolidation | Medium | Low — cosmetic consistency |
| **P3** | Full OpenAPI spec coverage | High | Medium — contract safety |

The app does not need to adopt clean architecture wholesale. The Modular Monolith with Vertical Slices approach preserves the pragmatic speed the team clearly values while introducing boundaries exactly where the codebase needs them — around external providers, domain-critical scoring logic, and the 99 route handlers that currently carry too much responsibility.

---

## Appendix: Dead & Removable Files

A repo-wide import/reference analysis identified the following files and directories that are never imported, never referenced by active code, or fully superseded. Removing them reduces surface area, confusion for new contributors, and bundle/build overhead.

### Definitely Dead — Components (`src/app/_components/`)

These components are defined but never imported by any page, layout, or other component:

| File | What it is |
|------|-----------|
| `footer.tsx` | Footer component (app uses `DialogFooter` and inline `<footer>`, not this) |
| `alert.tsx` | Alert component (never used) |
| `custom-context-menu.tsx` | Custom right-click menu (never used) |
| `HomeHeroBackground.tsx` | Particle hero (replaced by `GlassAmbientBackground` in `SharedLayout`) |
| `section-separator.tsx` | Decorative separator (never used) |
| `notifications.tsx` | Notifications panel (only consumer of `/api/checkCases`, both dead) |
| `chat-gpt.tsx` | ChatGPT interface (never used; only consumer of `api-routes.ts`) |
| `login-buttons.tsx` | Login button set (never used) |
| `split-view.tsx` | Split view container (never imported; only real Redux consumer) |
| `chat/chatbar.tsx` | Chat input bar (never imported) |
| `chat/chatbot.tsx` | Chat bot interface (never imported) |
| `chat/splitview-button.tsx` | Split view toggle (never imported) |
| `circle-animation/circle-animation.tsx` | Circle animation + its CSS (never imported) |
| `circle-animation/circle-animation.css` | CSS for above (transitively dead) |

### Definitely Dead — Library Files (`src/lib/`)

| File | Why dead |
|------|----------|
| `isMobile.ts` | Never imported anywhere |
| `hooks.ts` | Redux typed hooks (`useAppDispatch`, `useAppSelector`) — never imported |
| `api-routes.ts` | Only imported by dead `chat-gpt.tsx` (transitively dead) |

### Definitely Dead — Shared Library

| File | Why dead |
|------|----------|
| `shared/lib/scoring/content-style.ts` | `detectContentStyle` is never called; `viral-scoring.ts` handles content style inline |
| `shared/util/downloadLatestFeedVideo.ts` | Never imported by any file |

### Definitely Dead — API Routes

These route handlers have no callers in the frontend, mobile clients, workers, or OpenAPI spec:

| Route | Why dead |
|-------|----------|
| `src/app/api/page.tsx` | HTML page at `/api` URL; POSTs to `/api/send-email` which doesn't exist |
| `src/app/api/gd/route.ts` | OpenAI + ffmpeg pipeline; no references anywhere |
| `src/app/api/checkCases/route.ts` | Only called by dead `notifications.tsx` |
| `src/app/api/clipVideo/route.ts` | Server-side clipping from `tmp/`; never called |
| `src/app/api/uploadVideoForClipping/route.ts` | Writes to `tmp/`; superseded by multipart/S3 upload stack |
| `src/app/api/feedVideos/delete/route.ts` | Redundant — `DELETE /api/feedVideos/[id]` is the canonical endpoint used by web + mobile |
| `src/app/api/uploads/presigned/route.ts` | No callers; multipart + `from-url` + `complete` are the active upload paths |
| `src/app/api/meta/account/route.ts` | Facebook/Instagram business lookup; no callers (only `meta/upload/*` is used) |
| `src/app/api/admin/upload-logs/route.ts` | No admin UI page calls this; no external references |
| `src/app/api/admin/instagram-repost/route.ts` | No callers anywhere in the repo |

### Vestigial Pages (Orphaned — No Navigation Links)

These pages exist but are not linked from the sidenav, any other page, or any navigation component:

| Route | What it is |
|-------|-----------|
| `src/app/donation-splitter/` | Standalone calculator app — no incoming links |
| `src/app/sushi-go/` | Card game scoring app — no incoming links |
| `src/app/multiple-file-upload/` | Near-duplicate of `clips-genie/`; not linked from sidenav; `clips-genie` is the canonical path |

### Superseded Directories

| Directory | Status | Replacement |
|-----------|--------|-------------|
| `backend/` (10 compiled `.js` files) | **Stale build artifacts.** No `.ts` source, no `package.json`, no Docker service, no `next.config.js` rewrites. Express on port 3001 is not part of the active architecture. | Next.js API routes + workers |
| `clip-worker/` (only `package-lock.json` + generated Prisma) | **Legacy.** Commented out in `docker-compose.yml`. No entrypoint. | `workers/clip-metadata-worker/` |

### Stale Scripts

| Script | Why stale |
|--------|----------|
| `scripts/smoke-clip-candidates.sh` | POSTs to `localhost:3001/api/clip-jobs/enqueue` (Express backend that no longer exists) |
| `scripts/deploy_aws.sh` | References `backend/workers/llm-worker` and `backend/workers/clip-worker` paths that don't exist in repo |

### One-Off Scripts (Low Priority — Keep or Archive)

These are manual-run utility scripts with no automation wiring. They're not "dead" in the traditional sense, but they add noise if never used:

`get-latest-video.ts`, `show-queue.ts`, `remove-clip-job.ts`, `inspect-latest-segments.ts`, `list-dev-ids.ts`, `show-feed-video.ts`, `update-video-url.ts`, `check-clips.ts`, `check-feed-videos.ts`, `label-philosophy-segment.ts`, `export-philosophy-training-data.ts`, `generate-ig-state.ts`, `migrate-substack-to-publishing-accounts.ts`

### Other Cleanup Opportunities

| Item | Description |
|------|-------------|
| **Redux store** (`src/lib/store.ts`, `src/lib/slices/uiSlice.ts`, `StoreProvider.tsx`) | Wraps entire app but effectively unused — navbar manages theme via its own `localStorage`, and `useAppSelector` / `useAppDispatch` hooks are never imported. Can be removed if theme is moved to React Context. |
| **MUI dependencies** (`@mui/material`, `@mui/icons-material`, `@emotion/react`, `@emotion/styled`) | Only used in `navbar.tsx` and `sidenav.tsx`. Migrating these two components to Radix/lucide would allow removing 4 heavy packages. |
| **`aws-sdk` v2** | Only used in `shared/lib/s3.ts` (3 functions). Workers and routes use `@aws-sdk/client-s3` v3. Consolidating to v3 removes a deprecated 60MB+ dependency. |
