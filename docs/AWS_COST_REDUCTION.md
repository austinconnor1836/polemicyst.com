# AWS Cost Reduction Plan

> **Created**: 2026-03-15
> **Context**: AWS bill exceeded $1,000/month while the app is not live. This document outlines the root causes and a phased plan to bring costs to ~$0 during hibernation and ~$80-120/month when redeployed.

## Root Cause Analysis

### 1. CRITICAL: Prod services crash-looping → 27 TB of ECR pulls through NAT

**This is the primary cause of the $1,225/month NAT data processing charge.**

Both production ECS services are stuck in infinite crash-restart loops:

- **`prod-clip-worker`**: crashes every ~70 seconds with `Error: Cannot find module './shared/lib/prisma'`. ECS restarts it ~1,234 times/day, pulling the **696 MB** Docker image each time = **~838 GB/day**.
- **`polemicyst-prod-web`**: crashes every ~2.5 minutes with `Error: Cannot find module '@prisma/debug'`. ECS restarts it ~576 times/day, pulling the **168 MB** image each time = **~94 GB/day**.

**Combined: ~933 GB/day × 30 days = ~27 TB/month × $0.045/GB = ~$1,225/month.**

Both errors are Docker build issues — the prod images are missing required Node.js modules. Dev images work fine.

### 2. No VPC Endpoints (amplifies the crash-loop cost)

All ECS tasks run in **private subnets** with no VPC endpoints defined. Every ECR image pull, S3 read/write, and CloudWatch log write routes through the **NAT Gateways at $0.045/GB**. Even without the crash-loop, normal ECR pulls and S3 traffic would cost far more than necessary.

**Files**: `infrastructure/vpc.tf` — no `aws_vpc_endpoint` resources existed (now fixed, see below).

### 3. Two NAT Gateways ($65+/month fixed + data processing)

**File**: `infrastructure/vpc.tf` — was `count = 2`, one per AZ (now reduced to 1).

Fixed cost: ~$32.50/month each. Data processing: $0.045/GB for ALL outbound traffic from private subnets.

### 3. Two separate RDS instances ($110-140/month)

**File**: `infrastructure/rds.tf`, line 26 — `for_each = var.environments` creates a **separate RDS instance per environment** (prod + dev). Both potentially have Multi-AZ enabled (doubles cost).

- `db.t3.small` single-AZ: ~$28/month
- `db.t3.small` multi-AZ: ~$55/month
- Two instances with multi-AZ: ~$110/month

### 4. Always-on ECS Fargate tasks (~$145/month)

**File**: `infrastructure/ecs_services.tf` and `infrastructure/ecs_web.tf`

| Service            | CPU/Memory | Desired Count | ~Monthly Cost |
| ------------------ | ---------- | ------------- | ------------- |
| Web (prod)         | 512/1024   | 1             | $32           |
| Web (dev)          | 256/512    | 1             | $17           |
| Clip Worker (prod) | 1024/2048  | 1             | $63           |
| Redis (prod)       | 256/512    | 1             | $17           |
| Redis (dev)        | 256/512    | 1             | $17           |
| **Total**          |            |               | **~$145**     |

Note: Provocativeness + Comedic scorers are already scaled to 0.

### 5. ALB ($16-20/month)

**File**: `infrastructure/alb.tf` — costs money even with zero traffic.

### Estimated monthly breakdown

| Service                         | Estimated Cost   |
| ------------------------------- | ---------------- |
| NAT Gateways (fixed)            | $65              |
| NAT data processing             | $200-500+        |
| RDS (2 instances, multi-AZ)     | $110-140         |
| ECS Fargate (always-on)         | $145             |
| ALB                             | $16-20           |
| S3 + CloudWatch + ECR + Route53 | $15-30           |
| **Total**                       | **~$550-1,000+** |

## Actual Cost Breakdown (Feb 15 – Mar 15, 2026)

Confirmed via `aws ce get-cost-and-usage`:

| Service                         | Cost        | % of Total |
| ------------------------------- | ----------- | ---------- |
| **NAT Gateway data processing** | **$1,225**  | **85%**    |
| NAT Gateway hourly (2x)         | $60         | 4%         |
| ECS Fargate                     | $64         | 4%         |
| RDS                             | $62         | 4%         |
| ALB                             | $15         | 1%         |
| VPC                             | $13         | 1%         |
| ECR                             | $11         | <1%        |
| S3, Route53, CloudWatch, etc.   | ~$2         | <1%        |
| **Total**                       | **~$1,452** |            |

**85% of the bill is NAT Gateway data processing.** At $0.045/GB, $1,225 = ~27 TB of data routed through NAT Gateways. Because there are no VPC endpoints, every S3 read/write and every ECR image pull from ECS tasks goes through NAT.

> **Root cause confirmed**: Both `prod-clip-worker` and `polemicyst-prod-web` are crash-looping (broken Docker builds missing Prisma modules). Each restart pulls the full Docker image from ECR through NAT. Combined: ~933 GB/day = ~27 TB/month at $0.045/GB = $1,225/month in NAT data processing alone.

---

## Fixes Applied (2026-03-15 → 2026-03-16)

All infrastructure and operational fixes have been applied.

### Terraform changes (applied 2026-03-15)

1. **Added S3 Gateway VPC Endpoint** (FREE) — `infrastructure/vpc.tf`
   - All S3 traffic now routes through the AWS backbone, never touching NAT
   - This is the single highest-impact change

2. **Added ECR Docker + ECR API Interface Endpoints** (~$14/month) — `infrastructure/vpc.tf`
   - Container image pulls no longer go through NAT
   - Would have prevented the $1,225/month crash-loop cost entirely

3. **Added CloudWatch Logs Interface Endpoint** (~$7/month) — `infrastructure/vpc.tf`
   - Log streaming no longer goes through NAT

4. **Reduced NAT Gateways from 2 to 1** — `infrastructure/vpc.tf`
   - Saves ~$32.50/month fixed cost
   - Both private subnets now share one NAT Gateway

5. **Added HTTPS ingress rule to ECS security group** — `infrastructure/ecs.tf`
   - Required for Interface VPC endpoints to work (tasks need to reach endpoint ENIs on port 443)

### Manual fixes (applied 2026-03-16)

1. **Crash-looping prod services scaled to 0** — `prod-clip-worker` and `polemicyst-prod-web` confirmed at desired=0, running=0.

2. **Released leaked Elastic IP** — `eipalloc-059a3cc70181fa0ac` released (was ~$3.60/month).

3. **ECR lifecycle policies** added to all 3 repositories (`polemicyst-web`, `polemicyst-clip-worker`, `polemicyst-llm-worker`):
   - Expire untagged images after 1 day
   - Keep last 10 tagged images

4. **Clip workers switched to Fargate Spot** — both `prod-clip-worker` and `dev-clip-worker` recreated with `FARGATE_SPOT` capacity provider (~70% cost reduction). Safe because clip jobs are idempotent and retried via BullMQ.

5. **Prod Docker builds fixed** (PR #188, merged):
   - **Web**: Added `@prisma/engines` to runner stage install (standalone output excludes transitive Prisma deps). Added `NODE_OPTIONS="--max-old-space-size=4096"` to prevent OOM during build.
   - **Clip Worker**: Added `module-alias` to resolve `@shared/*` path aliases at runtime. Fixed `start.sh` entry point path. Narrowed `tsconfig.docker.json` includes to only used shared modules.

### Prevention measures (applied 2026-03-16)

1. **ECS deployment circuit breakers** (PR #189) — `deployment_circuit_breaker` with `rollback = true` on all 5 ECS services. Stops ECS from infinitely restarting crashed tasks.

2. **AWS budget alert** — `Monthly-Cost-Alert-150` sends email to `aconnor731@gmail.com` at 50%, 80%, and 100% of $150/month.

3. **VPC Endpoints** — Even if crash-looping recurs, ECR pulls go through VPC endpoints (fixed cost) instead of NAT ($0.045/GB).

### Prod is ready to redeploy

All Docker builds are fixed and verified. Scale prod services back up when ready.

### Terraform changes (applied 2026-03-19)

1. **Removed NAT Gateway entirely** — `infrastructure/vpc.tf`
   - Removed `aws_eip.nat` and `aws_nat_gateway.main`
   - Removed NAT routes from private route tables
   - ECS tasks moved to public subnets with `assign_public_ip = true`
   - Saves ~$33/month (fixed cost) + eliminates all NAT data processing charges

2. **Removed paid Interface VPC Endpoints** — `infrastructure/vpc.tf`
   - Removed ECR Docker, ECR API, and CloudWatch Logs endpoints
   - No longer needed: tasks in public subnets reach AWS services via Internet Gateway (free)
   - S3 Gateway Endpoint retained (free, routes S3 traffic over AWS backbone)
   - Saves ~$21/month

3. **Switched web service to Fargate Spot** — `infrastructure/ecs_web.tf`
   - Changed from `launch_type = "FARGATE"` to `capacity_provider_strategy` with `FARGATE_SPOT`
   - Circuit breakers already in place for graceful handling of Spot interruptions
   - Saves ~$20/month (~70% of web Fargate cost)

4. **Reduced web autoscaling minimum from 2 to 1** — `infrastructure/autoscaling.tf`
   - Pre-launch traffic doesn't require HA across availability zones
   - Saves ~$17-32/month depending on task size
   - Can be increased back to 2 when traffic warrants it

5. **Removed HTTPS SG ingress rule** — `infrastructure/ecs.tf`
   - Was only needed for Interface VPC Endpoint communication (now removed)

### Updated cost estimate (post all fixes)

| Service                            | Before  | After  | Savings   |
| ---------------------------------- | ------- | ------ | --------- |
| NAT Gateway (fixed + data)         | $33+    | $0     | ~$33/mo   |
| VPC Interface Endpoints (3x)       | $21     | $0     | ~$21/mo   |
| ECS Web (Fargate → Spot)           | $32     | ~$10   | ~$22/mo   |
| ECS Web (2 min → 1 min)            | $32     | $16    | ~$16/mo   |
| **Total infrastructure savings**   |         |        | **~$92/mo** |

### Remaining cost (prod only, post-optimization)

| Service                                 | Cost         |
| --------------------------------------- | ------------ |
| ECS Web (1x Spot, 512/1024)             | ~$10         |
| ECS Clip Worker (1x Spot, 1024/2048)    | ~$19         |
| ECS Redis (1x, 256/512)                 | ~$17         |
| RDS (db.t3.small, single-AZ)            | ~$28         |
| ALB                                     | ~$16         |
| S3 + Route53 + misc                     | ~$5          |
| **Total**                               | **~$95/mo**  |

---

## Phase 1: Hibernate (bring costs to ~$0.50/month)

Goal: Tear down all running resources while preserving data and IaC.

### Steps

1. **Snapshot RDS instances**, then stop or delete them
   - `aws rds create-db-snapshot` for both prod and dev
   - Then `aws rds stop-db-instance` (auto-restarts after 7 days) or delete
   - Snapshots cost ~$0.02/GB/month (cheap)

2. **Scale all ECS services to 0 desired count**
   - Web (prod + dev): `desired_count = 0`
   - Clip worker: `desired_count = 0`
   - Redis (prod + dev): `desired_count = 0`
   - Apply via Terraform or AWS Console

3. **Delete both NAT Gateways + release Elastic IPs**
   - Remove or comment out `aws_nat_gateway` and `aws_eip` in `infrastructure/vpc.tf`
   - Update private route tables to remove NAT routes
   - `terraform apply`

4. **Delete the ALB**
   - Remove or comment out resources in `infrastructure/alb.tf`
   - `terraform apply`

### What stays (essentially free)

| Resource                                    | Monthly Cost      |
| ------------------------------------------- | ----------------- |
| VPC, subnets, security groups, route tables | $0                |
| S3 bucket with existing data                | pennies           |
| Route53 hosted zone                         | $0.50             |
| ECR repositories                            | pennies           |
| RDS snapshots                               | ~$0.40 (for 20GB) |
| All Terraform code                          | $0                |
| **Total**                                   | **~$1/month**     |

---

## Phase 2: Cheaper redeployment (~$80-120/month)

When ready to go live again, apply these changes before redeploying.

### ~~2a. Add VPC Endpoints~~ — SUPERSEDED (2026-03-19)

Interface VPC endpoints (ECR, CloudWatch) were added on 2026-03-15 then **removed** on 2026-03-19 when ECS tasks moved to public subnets. S3 Gateway Endpoint (free) is retained.

### ~~2b. Remove NAT Gateway~~ — DONE (2026-03-19)

NAT Gateway removed entirely. ECS tasks now run in public subnets with `assign_public_ip = true` and reach AWS services via the Internet Gateway (free). RDS remains in private subnets (doesn't need outbound access).

### 2c. Single RDS instance with two databases

In `infrastructure/rds.tf`, replace the `for_each` with a single instance. Create both `clipsgenie` and `polemicyst_dev` as databases within one Postgres instance.

Savings: ~$55-70/month.

### 2d. Disable Multi-AZ on RDS

Set `multi_az = false`. Not needed for a pre-launch app.

Savings: ~$28/month.

### ~~2e. Use Fargate Spot for all ECS services~~ — DONE (2026-03-16 / 2026-03-19)

- **Clip workers**: Switched to Fargate Spot on 2026-03-16 (~$44/month savings).
- **Web services**: Switched to Fargate Spot on 2026-03-19 (~$22/month savings). Circuit breakers handle Spot interruptions.
- ECR lifecycle policies added to all 3 repos (expire untagged after 1 day, keep 10 tagged).

### ~~2g. Reduce web autoscaling minimum~~ — DONE (2026-03-19)

Lowered web autoscaling minimum from 2 to 1. Pre-launch traffic doesn't need HA across AZs. Saves ~$16-32/month.

### 2f. Eliminate the dev environment from AWS

Use local `docker compose` for dev instead of deploying a full dev environment to AWS. This eliminates:

- Dev web service: $17/month
- Dev Redis: $17/month
- Dev RDS instance: $55-70/month

Savings: ~$90-105/month.

### Redeployed cost estimate (updated 2026-03-19)

| Service                                  | Cost               |
| ---------------------------------------- | ------------------ |
| NAT Gateway                              | $0 (removed)       |
| VPC Endpoints                            | $0 (S3 Gateway only, free) |
| RDS (1 instance, single-AZ, db.t3.micro) | $14                |
| ECS Web (Fargate Spot, 1 task)           | ~$10               |
| ECS Clip Worker (Fargate Spot)           | $19                |
| ECS Redis (prod only)                    | $17                |
| ALB                                      | $16                |
| S3 + Route53 + misc                      | $5                 |
| **Total**                                | **~$80/month**     |

With RDS consolidation (2c) and dev elimination (2f), this drops to **~$50-65/month**.

---

## Phase 3: Long-term architecture considerations

### Option A: Move off ECS Fargate entirely (~$0-20/month)

For the lowest possible costs:

- **Web app**: Deploy to Vercel (free tier) or AWS Amplify — Next.js is natively supported
- **Workers**: Use AWS Lambda for event-driven processing instead of always-on Fargate
- **Redis**: Use Upstash (serverless Redis, free tier available) instead of self-hosted on Fargate
- **Database**: Use Neon or Supabase (free tier Postgres) during pre-launch

### Option B: Keep Fargate, optimize further (~$30-50/month)

If staying on ECS:

- **Replace self-hosted Redis with ElastiCache Serverless** — scales to zero when idle, eliminates the $17/mo Fargate Redis task. Cost: ~$0-5/mo for low traffic.
- **Use RDS Aurora Serverless v2** — scales to 0 ACU when idle (~$0 when not in use). Replaces always-on db.t3.small (~$28/mo).
- **Scale clip worker to zero when idle** — custom CloudWatch metric on BullMQ queue depth to drive auto-scaling. Currently min=1, which costs ~$19/mo even with no jobs.
- **Consolidate RDS** (2c above) — single instance with multiple databases saves ~$28-55/mo.
- **Eliminate dev environment from AWS** (2f above) — use docker-compose locally instead.
