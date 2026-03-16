# AWS Infrastructure

VPC layout, networking, compute, storage, and database architecture.

## Network Topology

```mermaid
graph TB
    subgraph internet["Internet"]
        users["Users / Clients"]
        gh["GitHub Actions"]
    end

    subgraph aws["AWS us-east-1"]
        subgraph vpc["VPC 10.0.0.0/16"]
            subgraph public["Public Subnets"]
                subgraph pub0["10.0.0.0/24 · AZ-a"]
                    alb["ALB<br/>HTTP → HTTPS redirect<br/>Host-based routing"]
                    nat["NAT Gateway<br/>+ Elastic IP"]
                end
                subgraph pub1["10.0.1.0/24 · AZ-b"]
                    alb2["ALB node<br/>(cross-zone)"]
                end
            end

            subgraph private["Private Subnets"]
                subgraph priv0["10.0.10.0/24 · AZ-a"]
                    web_prod["Web (prod)<br/>Fargate · 512 CPU · 1024 MB"]
                    redis_prod["Redis (prod)<br/>Fargate · 256 CPU · 512 MB<br/>redis-prod.polemicyst.local"]
                    clip_prod["Clip Worker (prod)<br/>Fargate · 1024 CPU · 2048 MB"]
                end
                subgraph priv1["10.0.11.0/24 · AZ-b"]
                    web_dev["Web (dev)<br/>Fargate"]
                    redis_dev["Redis (dev)<br/>redis-dev.polemicyst.local"]
                    clip_dev["Clip Worker (dev)"]
                    rds_dev["RDS (dev)<br/>PostgreSQL 15.5"]
                end
            end

            rds_prod["RDS (prod)<br/>db.t3.small · Multi-AZ<br/>PostgreSQL 15.5<br/>Encrypted (gp3)"]

            subgraph endpoints["VPC Endpoints"]
                s3_ep["S3 Gateway<br/>(FREE)"]
                ecr_dkr["ECR Docker<br/>(Interface)"]
                ecr_api["ECR API<br/>(Interface)"]
                logs_ep["CloudWatch Logs<br/>(Interface)"]
            end
        end

        igw["Internet Gateway"]
        r53["Route53<br/>polemicyst.com"]
        acm["ACM Certificate<br/>*.polemicyst.com"]
        ecr["ECR Repositories<br/>polemicyst-web<br/>polemicyst-clip-worker<br/>polemicyst-llm-worker"]
        s3["S3 Bucket<br/>prod/ · dev/ prefixes"]
        cw["CloudWatch Logs"]
    end

    users -->|HTTPS| r53
    r53 -->|Alias| alb
    acm -.->|TLS| alb
    alb -->|":3000"| web_prod
    alb -->|":3000"| web_dev
    gh -->|"Push images"| ecr

    web_prod --> redis_prod
    web_prod --> rds_prod
    clip_prod --> redis_prod
    clip_prod --> rds_prod

    web_dev --> redis_dev
    web_dev --> rds_dev
    clip_dev --> redis_dev
    clip_dev --> rds_dev

    nat -->|Egress| igw
    igw -->|Ingress| alb

    web_prod -.->|"via endpoint"| s3_ep
    clip_prod -.->|"via endpoint"| s3_ep
    s3_ep --> s3
    ecr_dkr --> ecr
    ecr_api --> ecr
    logs_ep --> cw

    classDef public fill:#e8f5e9,stroke:#2e7d32
    classDef private fill:#e3f2fd,stroke:#1565c0
    classDef endpoint fill:#fff3e0,stroke:#ef6c00
    classDef external fill:#fce4ec,stroke:#c62828

    class pub0,pub1 public
    class priv0,priv1 private
    class s3_ep,ecr_dkr,ecr_api,logs_ep endpoint
```

## Security Groups

```mermaid
graph LR
    subgraph alb_sg["ALB SG"]
        direction TB
        alb_in["Ingress: 80, 443<br/>from 0.0.0.0/0"]
        alb_out["Egress: all"]
    end

    subgraph ecs_sg["ECS Tasks SG"]
        direction TB
        ecs_in1["Ingress: 3000<br/>from ALB SG"]
        ecs_in2["Ingress: 6379<br/>self (Redis)"]
        ecs_in3["Ingress: 443<br/>self (VPC Endpoints)"]
        ecs_out["Egress: all<br/>0.0.0.0/0"]
    end

    subgraph rds_sg["RDS SG"]
        direction TB
        rds_in["Ingress: 5432<br/>from ECS Tasks SG"]
    end

    alb_sg -->|":3000"| ecs_sg
    ecs_sg -->|":5432"| rds_sg
```

## ALB Routing Rules

| Priority | Condition                                    | Target Group          | Port |
| -------- | -------------------------------------------- | --------------------- | ---- |
| —        | HTTP :80                                     | Redirect → HTTPS :443 | —    |
| 100      | Host: `polemicyst.com`, `www.polemicyst.com` | prod-web-tg           | 3000 |
| 101      | Host: `dev.polemicyst.com`                   | dev-web-tg            | 3000 |

## Service Discovery (Route53 Private DNS)

| DNS Name                      | Service      | Port |
| ----------------------------- | ------------ | ---- |
| `redis-prod.polemicyst.local` | Redis (prod) | 6379 |
| `redis-dev.polemicyst.local`  | Redis (dev)  | 6379 |

## Cost-Optimized Design

- **1 NAT Gateway** (reduced from 2) — saves ~$32/month
- **S3 Gateway Endpoint** — free, eliminates NAT data charges for S3 traffic
- **ECR/Logs Interface Endpoints** — ~$7/mo each, eliminates NAT charges for image pulls and log streaming
- **Fargate Spot** on LLM workers (provocativeness, comedic) — up to 70% savings
- See [AWS Cost Reduction](../AWS_COST_REDUCTION.md) for full analysis
