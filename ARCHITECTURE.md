# Architecture

System-level overview of the Polemicyst / Clipfire platform. For coding conventions and repo standards, see the `CLAUDE.md` files.

## Service Topology

```
┌─────────────────────────────────────────────────────────────┐
│  Next.js Web App (App Router)                               │
│  ┌─────────────┐  ┌───────────────┐  ┌───────────────────┐ │
│  │ Pages / UI  │  │ API Routes    │  │ Server Actions    │ │
│  │ (React)     │  │ /api/*        │  │                   │ │
│  └─────────────┘  └───────┬───────┘  └───────────────────┘ │
└───────────────────────────┼─────────────────────────────────┘
                            │ enqueue jobs
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Redis (BullMQ)                                              │
│  Queues: feed-download, transcription, clip-generation,      │
│          speaker-transcription, video-download                │
└──────────┬──────────┬──────────────┬─────────────────────────┘
           │          │              │
           ▼          ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌─────────────────────┐
│ Poller       │ │ Download     │ │ Clip-Metadata Worker │
│ Worker       │ │ Worker       │ │ (transcription +     │
│              │ │ (feed-       │ │  clip-generation)    │
│ polls feeds  │ │  download)   │ │                      │
└──────────────┘ └──────────────┘ └──────────┬───────────┘
                                             │
                         ┌───────────────────┼───────────────┐
                         ▼                   ▼               ▼
                   ┌──────────┐     ┌──────────────┐  ┌──────────┐
                   │ Faster-  │     │ Gemini API / │  │ FFmpeg   │
                   │ Whisper  │     │ Ollama       │  │          │
                   └──────────┘     └──────────────┘  └──────────┘

┌────────────────┐  ┌──────────────┐
│ PostgreSQL     │  │ AWS S3       │
│ (Prisma ORM)  │  │ (videos,     │
│                │  │  clips)      │
└────────────────┘  └──────────────┘
```

## Queue Architecture (BullMQ)

| Queue                   | Producer                                        | Consumer              | Job Shape                                                |
| ----------------------- | ----------------------------------------------- | --------------------- | -------------------------------------------------------- |
| `feed-download`         | API routes, Poller                              | Download Worker       | `{ feedVideoId, url, title?, feedId?, userId? }`         |
| `transcription`         | API routes, Download Worker                     | Clip-Metadata Worker  | `{ feedVideoId, sourceUrl?, title? }`                    |
| `clip-generation`       | API routes, Clip-Metadata Worker (auto-trigger) | Clip-Metadata Worker  | `{ feedVideoId, userId, aspectRatio, scoringMode, ... }` |
| `speaker-transcription` | API routes                                      | Clip-Metadata Worker  | `{ feedVideoId, numSpeakers? }`                          |
| `video-download`        | Legacy API routes                               | Video-Download Worker | `{ feedId, videoId, sourceUrl, userId, title }`          |

All queues use `jobId: feedVideoId` for deduplication.

## Video Processing Pipeline

There are four entry paths into the pipeline. All converge at transcription → clip-generation.

### Path 1: Feed Creation (YouTube/C-SPAN)

```
POST /api/feeds
  → Create VideoFeed
  → pollYouTubeFeed() / pollCspanFeed() → get latest video
  → Create FeedVideo (status: pending, s3Url: youtube_url)
  → Enqueue feed-download
  → If YouTube: enqueue transcription in parallel  ← NEW (parallel)
```

### Path 2: URL Import (Manual)

```
POST /api/uploads/from-url
  → Find/create "Manual Uploads" feed
  → Create FeedVideo (status: pending, s3Url: source_url)
  → Enqueue feed-download
  → If YouTube URL: enqueue transcription in parallel  ← NEW (parallel)
```

### Path 3: File Upload

```
POST /api/uploads/complete
  → Create FeedVideo (status: ready, s3Url: s3://...)
  → Enqueue clip-generation directly (file is already on S3)
```

### Path 4: Feed Polling (Automated)

```
Poller Worker (every 60s)
  → pollYouTubeFeed() / pollCspanFeed()
  → downloadAndUploadToS3() (synchronous — video is ready before FeedVideo is created)
  → Create FeedVideo (status: ready, s3Url: s3://...)
  → Enqueue transcription
```

### Download → Transcription → Clip-Generation Flow

```
Download Worker (feed-download queue)
  → Download video via yt-dlp → upload to S3
  → Update FeedVideo: s3Url = s3://..., status = 'ready'
  → Enqueue transcription (re-enqueue; deduped by jobId)

Transcription Worker (transcription queue, in clip-metadata-worker)
  → transcribeFeedVideo(feedVideoId)
    → If transcript exists in DB → return early (idempotent)
    → Try YouTube captions first (~100ms HTTP)
    → Fallback to Whisper (~5-30min via Faster-Whisper API)
    → Save transcript + segments to DB
  → If feed.autoGenerateClips:
    → Status gate: if status='pending' → skip (download still running)
    → If status='ready' → enqueue clip-generation

Clip-Generation Worker (clip-generation queue, in clip-metadata-worker)
  → Download video to /tmp
  → Transcribe (hits DB cache from prior transcription)
  → Build candidate windows from transcript segments
  → Score via LLM (Gemini multimodal or Ollama text-only)
  → Apply philosophy rhetoric scoring
  → For each top candidate:
    → Create Segment + Clip + Video records
    → FFmpeg render → S3 upload
  → Flush cost events
  → Cleanup temp files
```

### Parallel YouTube Transcription

For YouTube imports, transcription is enqueued alongside download because YouTube captions are fetched via HTTP (~100ms) while the download takes minutes. A status gate in the transcription worker prevents premature clip-generation:

```
API enqueues: download + transcription (parallel)
  ┌─── Transcription (~100ms): fetch captions → save to DB
  │    → sees status='pending' → skips clip-gen
  │
  └─── Download (minutes): yt-dlp → S3
       → sets status='ready'
       → re-enqueues transcription (deduped by jobId, or idempotent return)
       → transcription sees status='ready' → enqueues clip-gen
```

Race conditions are handled by:

- **Idempotent transcription**: `transcribeFeedVideo()` returns early if transcript exists
- **BullMQ dedup**: `jobId: feedVideoId` prevents duplicate queue entries
- **Status gate**: clip-gen only triggers when `status !== 'pending'`

## ECS Deployment

| ECS Service             | Container             | Queues Consumed                    |
| ----------------------- | --------------------- | ---------------------------------- |
| `{env}-web`             | Next.js (Dockerfile)  | — (serves HTTP)                    |
| `{env}-clip-worker`     | clip-metadata-worker  | `clip-generation`, `transcription` |
| `{env}-poller`          | poller-worker         | — (polling loop)                   |
| `{env}-download-worker` | video-download-worker | `feed-download`, `video-download`  |

Auxiliary containers (Faster-Whisper, Ollama) run as ECS services or sidecars depending on environment.

## Key Data Models

- **VideoFeed** — Source feed (YouTube channel, C-SPAN). Has `sourceType`, `pollingInterval`, `autoGenerateClips`, `viralitySettings`.
- **FeedVideo** — Individual video from a feed. Tracks `status` (pending/ready/failed), `transcript`, `transcriptJson`, `transcriptSource` (whisper/youtube-auto/youtube-manual).
- **Video** — Parent video or generated clip. Self-referencing via `sourceVideoId` for clip→parent relationship.
- **Segment** — Scored time window within a Video. Contains `tStartS`, `tEndS`, `score`, `features` (JSON with LLM subscores).
- **Clip** — Rendered clip variant linked to a Segment.
- **CostEvent** — Per-stage cost tracking (download, transcription, llm_scoring, ffmpeg_render, s3_upload).
- **JobLog** — Job execution history with status transitions and error details.

## Key Design Decisions

1. **Idempotent transcription** — `transcribeFeedVideo()` checks for existing transcript before doing any work. Safe to call multiple times.
2. **Unified clip-metadata-worker** — Single ECS service handles both `transcription` and `clip-generation` queues, reducing infrastructure complexity.
3. **Status-gated clip-generation** — The transcription worker only triggers auto clip-gen when `feedVideo.status !== 'pending'`, preventing premature processing during parallel YouTube imports.
4. **Council-style LLM scoring** — Single LLM call returns multiple specialist subscores (hook, context, captionability, risk) that are deterministically aggregated with platform-specific weights.
5. **Non-fatal cost tracking** — `CostTracker` accumulates events in memory and flushes once at job end. Flush failures don't block the pipeline.
6. **YouTube-first transcription** — Always tries fetching YouTube captions (~100ms) before falling back to Whisper (~5-30min), saving significant processing time and cost.
