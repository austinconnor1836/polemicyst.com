# Architecture Diagrams

Visual documentation of the Polemicyst/Clipfire system architecture. All diagrams use [Mermaid](https://mermaid.js.org/) and render natively on GitHub.

## Diagrams

| Diagram                                     | Description                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| [System Overview](system-overview.md)       | C4 Context diagram — major systems and external integrations                      |
| [AWS Infrastructure](aws-infrastructure.md) | VPC, subnets, ALB, ECS, RDS, S3, NAT, VPC Endpoints                               |
| [Data Flow](data-flow.md)                   | End-to-end: video ingestion → transcription → scoring → clip rendering → delivery |
| [Queue Architecture](queue-architecture.md) | BullMQ queue topology — producers, consumers, job shapes, retry flows             |
| [Auth Flow](auth-flow.md)                   | Web (NextAuth) and mobile (Bearer JWT) authentication flows                       |
| [Deployment](deployment.md)                 | CI/CD: GitHub Actions → ECR → ECS, iOS → TestFlight, Android → Firebase           |

## Related Documentation

- [ARCHITECTURE.md](../../ARCHITECTURE.md) — System topology and design decisions (prose)
- [AWS Cost Reduction](../AWS_COST_REDUCTION.md) — NAT Gateway optimization and cost analysis
- [LLM System](../LLM_SYSTEM.md) — Scoring pipeline, model distillation, cost tracking
