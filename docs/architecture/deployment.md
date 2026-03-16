# Deployment

CI/CD pipelines for web, workers, iOS, and Android.

## Overview

```mermaid
flowchart LR
    subgraph triggers["Triggers"]
        pr["Pull Request"]
        push_dev["Push to develop"]
        push_main["Push to main"]
        manual["Manual / Release workflow"]
    end

    subgraph ci["CI (ci.yml)"]
        lint["Lint + Type Check"]
        build_check["Next.js Build"]
    end

    subgraph deploy["Deploy (deploy.yml)"]
        subgraph web_deploy["Web"]
            build_web["Docker Build"]
            ecr_web["Push to ECR<br/>polemicyst-web:{env}"]
            ecs_web["Update ECS Service<br/>polemicyst-{env}-web"]
        end
        subgraph worker_deploy["Clip Worker"]
            build_worker["Docker Build"]
            ecr_worker["Push to ECR<br/>polemicyst-clip-worker:{env}"]
            ecs_worker["Update ECS Service<br/>{env}-clip-worker"]
        end
        subgraph llm_deploy["LLM Worker"]
            build_llm["Docker Build"]
            ecr_llm["Push to ECR<br/>polemicyst-llm-worker:{env}"]
        end
    end

    subgraph ios_deploy["iOS (deploy.yml)"]
        xcodegen["XcodeGen"]
        xcode_build["Xcode Build"]
        fastlane_ios["Fastlane → TestFlight"]
    end

    subgraph android_deploy["Android (deploy.yml)"]
        gradle["Gradle Build"]
        firebase["Firebase App Distribution"]
    end

    pr --> ci
    push_dev -->|"env=dev"| deploy
    push_main -->|"env=prod"| deploy
    push_dev --> ios_deploy
    push_dev --> android_deploy
    push_main --> ios_deploy
    push_main --> android_deploy

    build_web --> ecr_web --> ecs_web
    build_worker --> ecr_worker --> ecs_worker
    build_llm --> ecr_llm
```

## CI Pipeline (Pull Requests)

```mermaid
flowchart TB
    pr["PR opened/updated<br/>to main or develop"]
    detect["Detect changed paths<br/>(dorny/paths-filter)"]
    changed{"App code<br/>changed?"}
    skip["Skip CI ✓"]
    setup["Setup Node 20"]
    install["npm ci --legacy-peer-deps"]
    prisma["npx prisma generate"]
    typecheck["npx tsc --noEmit"]
    lint["npm run lint"]
    build["npm run build"]
    pass["CI Passed ✓"]

    pr --> detect --> changed
    changed -->|No| skip
    changed -->|Yes| setup --> install --> prisma --> typecheck --> lint --> build --> pass
```

## Deploy Pipeline (Push to main/develop)

Runs three jobs in parallel:

```mermaid
flowchart TB
    push["Push to main or develop"]
    env{"Branch?"}
    dev["env=dev"]
    prod["env=prod"]

    subgraph parallel["Parallel Jobs"]
        subgraph j1["deploy-web"]
            w1["Checkout"]
            w2["AWS Credentials"]
            w3["ECR Login"]
            w4["Docker Build + Push<br/>polemicyst-web:{env}"]
            w5["aws ecs update-service<br/>--force-new-deployment"]
            w1 --> w2 --> w3 --> w4 --> w5
        end

        subgraph j2["deploy-clip-worker"]
            c1["Checkout"]
            c2["AWS Credentials"]
            c3["ECR Login"]
            c4["Docker Build + Push<br/>polemicyst-clip-worker:{env}"]
            c5["aws ecs update-service<br/>--force-new-deployment"]
            c1 --> c2 --> c3 --> c4 --> c5
        end

        subgraph j3["deploy-llm-worker"]
            l1["Docker Build + Push<br/>polemicyst-llm-worker:{env}"]
            l2["(Workers scaled to 0)"]
            l1 --> l2
        end
    end

    push --> env
    env -->|develop| dev --> parallel
    env -->|main| prod --> parallel
```

## ECS Rolling Deployment

```mermaid
sequenceDiagram
    participant GH as GitHub Actions
    participant ECR as ECR
    participant ECS as ECS Service
    participant ALB as ALB

    GH->>ECR: Push new image (tag: prod/dev)
    GH->>ECS: update-service --force-new-deployment
    ECS->>ECR: Pull new image
    ECS->>ECS: Launch new task
    ECS->>ALB: Register new task in target group
    ALB->>ECS: Health check (GET / every 30s)
    ALB-->>ECS: 2x healthy responses
    ALB->>ALB: Route traffic to new task
    ECS->>ECS: Drain old task connections
    ECS->>ECS: Stop old task
```

## iOS Deployment

| Stage              | Tool                     | Target                                      |
| ------------------ | ------------------------ | ------------------------------------------- |
| Project generation | XcodeGen (`project.yml`) | `Clipfire.xcodeproj`                        |
| Build              | Xcode (xcodebuild)       | `ClipfireApp` scheme                        |
| Sign               | Fastlane Match           | App Store Distribution cert                 |
| Upload             | Fastlane Pilot           | TestFlight (dev) / App Store Connect (prod) |

**Runner:** `macos-15`
**Bundle ID:** `com.clipfire.app`
**Team ID:** `L6AS5GG2MB`

## Android Deployment

| Stage             | Tool                      | Target           |
| ----------------- | ------------------------- | ---------------- |
| Build             | Gradle                    | APK / AAB        |
| Distribute (dev)  | Firebase App Distribution | Internal testers |
| Distribute (prod) | Play Store Console        | Production       |

**Runner:** `ubuntu-latest`

## Release Process

```mermaid
flowchart TB
    trigger["Run 'Prepare Release' workflow<br/>or /release command"]
    bump["Create release/vX.Y.Z branch<br/>Update version.json"]
    pr_dev["PR → develop<br/>(auto-merges on CI pass)"]
    pr_main["PR → main<br/>(Release PR with changelog)"]
    review["Review + merge<br/>(merge commit, NOT squash)"]
    finalize["Finalize Release workflow<br/>(auto-fires on merge)"]
    tag["Create GitHub Release + git tag"]
    ff["Fast-forward develop to main"]

    trigger --> bump --> pr_dev
    bump --> pr_main --> review --> finalize --> tag --> ff
```

## Branch Strategy

```
main ← production deployments, tagged releases
  ↑
develop ← integration branch, dev deployments
  ↑
feature/* / fix/* / chore/* ← work branches (PR → develop)
```

## Environment Variables

Stored as GitHub Secrets (repo-level):

| Category | Secrets                                                        |
| -------- | -------------------------------------------------------------- |
| AWS      | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`                   |
| Database | `DATABASE_URL_PROD`, `DATABASE_URL_DEV`                        |
| Auth     | `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`  |
| iOS      | `MATCH_PASSWORD`, `APP_STORE_CONNECT_API_KEY`, `APPLE_TEAM_ID` |
| Android  | `FIREBASE_APP_ID`, `FIREBASE_TOKEN`                            |
