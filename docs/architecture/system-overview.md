# System Overview

C4 Context diagram showing all major systems and their interactions.

```mermaid
C4Context
    title Polemicyst / Clipfire — System Context

    Person(user, "User", "Content creator managing video feeds and clips")
    Person(admin, "Admin", "Platform operator viewing costs, logs, training data")

    System(web, "Next.js Web App", "App Router, UI, API routes<br/>Port 3000 · ECS Fargate")
    System(workers, "Background Workers", "Clip generation, transcription,<br/>metadata, polling<br/>ECS Fargate")

    System_Ext(youtube, "YouTube", "Video source, captions, channel data")
    System_Ext(cspan, "C-SPAN", "Video source")
    System_Ext(gemini, "Google Gemini", "Multimodal LLM scoring<br/>(Flash model)")
    System_Ext(google_oauth, "Google OAuth", "Web + mobile sign-in")
    System_Ext(apple_auth, "Apple Sign-In", "iOS sign-in")
    System_Ext(github, "GitHub Actions", "CI/CD pipelines")

    SystemDb(rds, "PostgreSQL (RDS)", "Users, feeds, videos, clips,<br/>segments, costs, training data")
    SystemQueue(redis, "Redis", "BullMQ job queues<br/>ECS Fargate")
    SystemDb(s3, "Amazon S3", "Source videos, generated clips")

    Rel(user, web, "Uses", "HTTPS")
    Rel(admin, web, "Manages", "HTTPS")
    Rel(web, rds, "Reads/writes", "TCP 5432")
    Rel(web, redis, "Enqueues jobs", "TCP 6379")
    Rel(web, s3, "Uploads/downloads", "HTTPS via VPC Endpoint")
    Rel(workers, rds, "Reads/writes", "TCP 5432")
    Rel(workers, redis, "Consumes jobs", "TCP 6379")
    Rel(workers, s3, "Stores clips", "HTTPS via VPC Endpoint")
    Rel(workers, youtube, "Downloads videos,<br/>fetches captions", "HTTPS")
    Rel(workers, cspan, "Downloads videos", "HTTPS")
    Rel(workers, gemini, "Scores candidates", "HTTPS")
    Rel(web, google_oauth, "Authenticates", "OAuth 2.0")
    Rel(web, apple_auth, "Verifies tokens", "JWKS")
    Rel(github, web, "Deploys", "ECR → ECS")
    Rel(github, workers, "Deploys", "ECR → ECS")
```

## Component Summary

| Component     | Technology                | Hosting                   | Purpose                           |
| ------------- | ------------------------- | ------------------------- | --------------------------------- |
| Web App       | Next.js 14 (App Router)   | ECS Fargate               | UI, API routes, auth              |
| Clip Worker   | Node.js + FFmpeg + yt-dlp | ECS Fargate               | Transcription, scoring, rendering |
| Poller Worker | Node.js                   | Docker (dev)              | Feed polling, video discovery     |
| PostgreSQL    | PostgreSQL 15.5           | RDS (prod) / Docker (dev) | Primary datastore                 |
| Redis         | Redis Alpine              | ECS Fargate               | BullMQ queue backend              |
| S3            | Amazon S3                 | AWS                       | Video and clip storage            |
| Gemini        | Google Gemini Flash       | Google Cloud              | Multimodal LLM scoring            |
| Ollama        | Ollama (local)            | Docker sidecar            | Free LLM alternative (dev/future) |
