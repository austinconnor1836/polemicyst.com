# Vercel Migration Assessment

Analysis of moving the Next.js web app from ECS Fargate to Vercel.

## Current Architecture (ECS)

| Resource                         | Monthly Cost (est.) |
| -------------------------------- | ------------------- |
| ECS Fargate (web task, prod+dev) | ~$15                |
| ALB                              | ~$18                |
| NAT Gateway (shared)             | ~$33                |
| RDS (shared, not moving)         | ~$30                |
| ECR (web images)                 | ~$4                 |
| **Web subtotal**                 | **~$100**           |

The web task shares NAT Gateway and ALB with other services. Moving to Vercel would **not** eliminate these resources entirely since the clip worker still needs them.

## Vercel Pricing

| Tier         | Cost      | Key Limits                                                                |
| ------------ | --------- | ------------------------------------------------------------------------- |
| Hobby (free) | $0/month  | 100 GB bandwidth, 100 hrs build, 10s function timeout, 1 concurrent build |
| Pro          | $20/month | 1 TB bandwidth, 50s function timeout, unlimited builds                    |

## Pros

1. **Cost reduction**: Eliminate web ECS task (~$15/month) and potentially reduce ALB cost if only workers remain
2. **Zero infra management**: No Docker builds, no ECS deployments, no health check tuning
3. **Built for Next.js**: Vercel is the canonical deployment target — ISR, middleware, edge functions, image optimization all work out of the box
4. **Preview deployments**: Every PR gets a unique URL automatically — excellent for QA
5. **Faster deploys**: Vercel builds take ~1-2 min vs Docker build + ECR push + ECS rolling deploy (~5-8 min)
6. **Edge network**: Static assets and edge functions served from 100+ locations globally
7. **Simplified CI**: Can remove the `deploy-web` job from `deploy.yml` entirely

## Cons / Risks

### 1. API Route Timeout Limits

**Risk: Medium-High**

All `src/app/api/` routes become Vercel Serverless Functions:

- **Hobby**: 10s max execution time
- **Pro**: 50s max

Routes at risk of hitting limits:

- `POST /api/trigger-clip` — enqueues BullMQ jobs (usually fast, but includes DB writes)
- `POST /api/feedVideos/:id/truth-analysis` — calls Gemini LLM (can take 10-30s)
- `POST /api/feedVideos/:id/truth-analysis/chat` — Gemini chat responses (5-15s)
- `POST /api/connected-accounts` — YouTube channel metadata fetch + DB writes

**Mitigation**: Most of these are already async (enqueue + return). The Gemini calls are the main concern — they'd need Pro tier (50s) or be moved to a background worker.

### 2. Database Migration Script

**Risk: Medium**

Current flow: `docker-entrypoint.sh` runs `prisma migrate deploy` on container start.

Vercel has no container startup hook. Alternatives:

- Run migrations in a **GitHub Actions step** before Vercel deploy
- Use a **standalone migration job** (e.g., ECS task run, or a script in CI)
- Use Vercel's `postbuild` script (runs during build, but has no DB access unless connection string is available at build time)

**Recommended**: Add a `migrate` step to `deploy.yml` that runs `prisma migrate deploy` via a short-lived ECS task or direct DB connection from CI.

### 3. Redis / BullMQ Connectivity

**Risk: Low-Medium**

API routes that enqueue BullMQ jobs need TCP access to Redis (ECS Fargate, private subnet).

- Vercel functions **cannot** reach private VPC resources directly
- Would need **Redis accessible from internet** (e.g., ElastiCache with public access, or managed Redis like Upstash)
- Alternative: expose a thin API on the backend that Vercel calls to enqueue jobs

**Recommended**: Switch to **Upstash Redis** ($0 free tier, $10/month pro) which is accessible from Vercel. Or add an API gateway in front of Redis.

### 4. WebSocket / Real-time Features

**Risk: Low (currently)**

Vercel doesn't support persistent WebSocket connections. Currently the app uses polling for job status, so this isn't a blocker. But if real-time features are planned, they'd need a separate service (e.g., Pusher, Ably, or a small Socket.io server on ECS).

### 5. Cold Starts

**Risk: Low**

Serverless functions have cold starts (~200-500ms). For API routes called infrequently, users may notice a slight delay. Pro tier has `cron` and `always-on` options to mitigate.

### 6. Environment Variable Management

**Risk: Low**

Env vars move from ECS task definitions (Terraform) to the Vercel dashboard. This is a one-time migration — not a technical blocker, just a workflow change.

### 7. Vendor Lock-in

**Risk: Low-Medium**

Next.js itself is portable, but Vercel-specific features (edge config, KV, middleware edge runtime) create soft lock-in. As long as you avoid Vercel-only APIs, migration back to self-hosted is straightforward.

### 8. S3 Access

**Risk: Low**

Currently uses VPC Endpoint (free, private). From Vercel, S3 access goes over the public internet — requires the bucket policy to allow the Vercel function's IAM credentials. This already works via AWS SDK with access keys.

## Recommendation

**Move to Vercel Pro ($20/month)** with these prerequisites:

1. **Switch Redis to Upstash** (or expose Redis via a public endpoint)
2. **Move `prisma migrate deploy` to a CI step** in GitHub Actions
3. **Verify Gemini API routes complete within 50s** (they should — typical response is 5-15s)
4. **Keep ALB + clip worker on ECS** (they still need VPC access)

### Net Savings Estimate

| Change                           | Monthly Savings            |
| -------------------------------- | -------------------------- |
| Remove web ECS task (prod + dev) | +$15                       |
| Vercel Pro                       | -$20                       |
| Upstash Redis (if needed)        | -$10                       |
| **Net**                          | **-$15** (slight increase) |

However, the **developer experience gains** (preview deploys, faster builds, zero Docker maintenance) may justify the slight cost increase. If using Vercel Hobby tier ($0), net savings would be ~$5/month.

### Alternative: Keep Current Architecture

The current ECS setup is already well-optimized after the NAT Gateway reduction. The main benefit of Vercel is DX, not cost. If DX isn't a pain point, keeping ECS is simpler (one less platform to manage).

## Action Items (if proceeding)

- [ ] Release leaked EIP: `aws ec2 release-address --allocation-id eipalloc-059a3cc70181fa0ac`
- [ ] Set up Upstash Redis or expose Redis endpoint
- [ ] Add `prisma migrate deploy` step to GitHub Actions deploy workflow
- [ ] Create Vercel project, connect GitHub repo
- [ ] Configure environment variables in Vercel dashboard
- [ ] Update DNS (Route53) to point to Vercel
- [ ] Remove `deploy-web` job from `deploy.yml`
- [ ] Remove web ECS service + task definition from Terraform
- [ ] Test all API routes for timeout compliance
