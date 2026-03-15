# Queue Architecture

BullMQ queue topology — all queues are backed by Redis (ECS Fargate, service-discovered at `redis-{env}.polemicyst.local:6379`).

## Queue Topology

```mermaid
flowchart LR
    subgraph producers["Producers"]
        api["Next.js API Routes"]
        poller["Poller Worker"]
        clipw["Clip Worker<br/>(self-enqueue)"]
    end

    subgraph queues["BullMQ Queues (Redis)"]
        fd["feed-download"]
        tx["transcription"]
        cg["clip-generation"]
        stx["speaker-transcription"]
    end

    subgraph consumers["Consumers"]
        dw["Download Worker"]
        tw["Transcription Worker<br/>(clip-metadata-worker)"]
        cw["Clip Metadata Worker"]
        sw["Speaker Transcription Worker"]
    end

    api -->|"POST /api/trigger-clip"| cg
    api -->|"POST /api/feedVideos/:id/transcribe"| tx
    api -->|"POST /api/connected-accounts"| fd
    api -->|"POST /api/connected-accounts"| tx
    poller -->|"New videos found"| fd
    poller -->|"Parallel transcription"| tx
    clipw -->|"Auto-trigger if<br/>autoGenerateClips"| cg

    fd --> dw
    tx --> tw
    cg --> cw
    stx --> sw

    dw -->|"FeedVideo created"| db[(PostgreSQL)]
    tw -->|"Transcript saved"| db
    cw -->|"Segments + clips"| db
    sw -->|"Speaker labels"| db

    dw -->|"Source video"| s3[(S3)]
    cw -->|"Rendered clips"| s3
```

## Queue Details

### `feed-download`

Downloads source videos from external platforms.

```mermaid
flowchart LR
    subgraph job["Job Shape"]
        direction TB
        j1["feedVideoId: string"]
        j2["url: string"]
        j3["title: string"]
        j4["feedId: string"]
        j5["userId: string"]
    end

    poller["Poller Worker"] -->|enqueue| q["feed-download"]
    api["API (connected-accounts)"] -->|enqueue| q
    q --> dw["Download Worker"]
    dw -->|"yt-dlp / curl"| ext["YouTube / C-SPAN"]
    dw -->|"Upload"| s3["S3"]
    dw -->|"Create FeedVideo"| db["PostgreSQL"]
```

**Config:** `removeOnComplete: true`, `removeOnFail: true`

### `transcription`

Converts video audio to text. Runs in parallel with download for YouTube imports.

```mermaid
flowchart LR
    subgraph job["Job Shape"]
        direction TB
        j1["feedVideoId: string"]
        j2["sourceUrl?: string"]
        j3["title?: string"]
    end

    api["API Routes"] -->|enqueue| q["transcription"]
    poller["Poller"] -->|enqueue| q
    q --> tw["Clip Metadata Worker<br/>(transcription handler)"]
    tw -->|"Try first"| yt["YouTube Captions<br/>(~100ms HTTP)"]
    tw -->|"Fallback"| whisper["Whisper STT"]
    tw -->|"Save transcript"| db["PostgreSQL"]
    tw -->|"If autoGenerateClips<br/>& status != pending"| cg["clip-generation queue"]
```

**Dedup:** `jobId: feedVideoId` prevents duplicate transcription jobs.

**Status gate:** Auto-trigger only fires when `feedVideo.status !== 'pending'` (prevents premature triggering during parallel imports).

### `clip-generation`

The main processing pipeline — scoring, selection, rendering.

```mermaid
flowchart LR
    subgraph job["Job Shape"]
        direction TB
        j1["feedVideoId · userId"]
        j2["aspectRatio: 16:9 | 9:16 | 1:1"]
        j3["scoringMode: heuristic | hybrid | gemini"]
        j4["llmProvider: gemini | ollama"]
        j5["targetPlatform · contentStyle"]
        j6["saferClips · includeAudio"]
        j7["minCandidates · maxCandidates"]
        j8["minScore · percentile"]
        j9["maxGeminiCandidates · clipLength"]
    end

    api["POST /api/trigger-clip"] -->|enqueue| q["clip-generation"]
    auto["transcription worker<br/>(auto-trigger)"] -->|enqueue| q
    q --> cw["Clip Metadata Worker"]
    cw -->|"Transcribe → Build candidates<br/>→ Score → Select → Render"| pipeline["Full Pipeline"]
    pipeline -->|"Segments + clips"| db["PostgreSQL"]
    pipeline -->|"Rendered clips"| s3["S3"]
    pipeline -->|"Cost events"| costs["CostEvent table"]
    pipeline -->|"Training data"| train["TrainingExample table"]
```

### `speaker-transcription`

Speaker diarization (identifies who is speaking when).

```mermaid
flowchart LR
    subgraph job["Job Shape"]
        direction TB
        j1["feedVideoId: string"]
        j2["numSpeakers?: number"]
    end

    api["Manual trigger"] -->|enqueue| q["speaker-transcription"]
    q --> sw["Speaker Transcription Worker"]
    sw -->|"Pyannote diarization"| sw
    sw -->|"speakerTranscriptJson"| db["PostgreSQL"]
```

## Retry & Error Handling

| Queue                   | Max Retries | Backoff     | On Failure                       |
| ----------------------- | ----------- | ----------- | -------------------------------- |
| `feed-download`         | 3           | Exponential | Mark FeedVideo status=failed     |
| `transcription`         | 3           | Exponential | Log error, skip auto-trigger     |
| `clip-generation`       | 2           | Exponential | Mark clipGenerationStatus=failed |
| `speaker-transcription` | 2           | Exponential | Log error                        |

All queues use `removeOnComplete: true` and `removeOnFail: true` to avoid unbounded Redis memory growth.

## Job Logging

Every queue records lifecycle events in the `JobLog` table:

```
queued → started → completed | failed
```

Each entry captures: `jobType`, `status`, `durationMs`, `errorMessage`, `metadata` (JSON).

Admin dashboard: `/admin/logs`
