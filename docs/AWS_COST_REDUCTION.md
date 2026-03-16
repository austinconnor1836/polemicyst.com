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

### Still needed before redeploying prod

1. **Fix prod Docker builds**:
   - `prod-clip-worker` needs `shared/lib/prisma` in its build context
   - `prod-web` needs `@prisma/debug` (likely missing `prisma generate` step)

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

### ~~2a. Add VPC Endpoints~~ — DONE (2026-03-15)

Applied in `infrastructure/vpc.tf` and confirmed live:

- S3 Gateway Endpoint (FREE)
- ECR Docker + ECR API Interface Endpoints (~$14/month)
- CloudWatch Logs Interface Endpoint (~$7/month)

### ~~2b. Reduce to 1 NAT Gateway~~ — DONE (2026-03-15)

Reduced from `count = 2` to `count = 1` in `infrastructure/vpc.tf`. Both private subnets share one NAT Gateway. Leaked second EIP released (2026-03-16).

Consider **removing the NAT Gateway entirely** — with VPC endpoints covering S3 + ECR + CloudWatch, the only remaining outbound traffic is Gemini API calls and YouTube downloads. Those could use a public subnet with `assign_public_ip = true` instead.

### 2c. Single RDS instance with two databases

In `infrastructure/rds.tf`, replace the `for_each` with a single instance. Create both `clipsgenie` and `polemicyst_dev` as databases within one Postgres instance.

Savings: ~$55-70/month.

### 2d. Disable Multi-AZ on RDS

Set `multi_az = false`. Not needed for a pre-launch app.

Savings: ~$28/month.

### ~~2e. Use Fargate Spot for clip worker~~ — DONE (2026-03-16)

Both `prod-clip-worker` and `dev-clip-worker` ECS services recreated with `FARGATE_SPOT` capacity provider strategy. Terraform code updated in `infrastructure/ecs_services.tf`. ECR lifecycle policies also added to all 3 repos (expire untagged after 1 day, keep 10 tagged).

Savings: ~$44/month (70% of $63).

### 2f. Eliminate the dev environment from AWS

Use local `docker compose` for dev instead of deploying a full dev environment to AWS. This eliminates:

- Dev web service: $17/month
- Dev Redis: $17/month
- Dev RDS instance: $55-70/month

Savings: ~$90-105/month.

### Redeployed cost estimate

| Service                                  | Cost               |
| ---------------------------------------- | ------------------ |
| NAT Gateway (1x) or none                 | $0-33              |
| RDS (1 instance, single-AZ, db.t3.micro) | $14                |
| ECS Web (prod only)                      | $32                |
| ECS Clip Worker (Fargate Spot)           | $19                |
| ECS Redis (prod only)                    | $17                |
| VPC Endpoints (S3 free, ECR+Logs ~$14)   | $14                |
| ALB                                      | $16                |
| S3 + Route53 + misc                      | $5                 |
| **Total**                                | **~$80-120/month** |

---

## Phase 3: Long-term architecture considerations

### Move off ECS Fargate entirely

For even lower costs, consider:

- **Web app**: Deploy to Vercel (free tier) or AWS Amplify — Next.js is natively supported
- **Workers**: Use AWS Lambda for event-driven processing instead of always-on Fargate
- **Redis**: Use Upstash (serverless Redis, free tier available) instead of self-hosted
- **Database**: Use Neon or Supabase (free tier Postgres) during pre-launch

This could bring costs to **$0-20/month** total.

### Keep Fargate but optimize

If staying on ECS:

- Use **ECS Service Auto Scaling** with scale-to-zero for the clip worker (only runs when jobs are queued)
- Use **RDS Aurora Serverless v2** (scales to 0 ACU when idle, ~$0 when not in use)
- Consider **ECS tasks in public subnets** with `assign_public_ip = true` to eliminate NAT Gateways entirely (security trade-off: tasks get public IPs, but security groups still control access)
