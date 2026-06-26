# Operations — alerting + on-call

How we know when prod is broken. The investor-readiness companion to `ARCHITECTURE.md`
(system topology) and `docs/AWS_COST_REDUCTION.md` (cost guardrails).

For broader context see also `polemicyst.com/CLAUDE.md` (per-clip cost instrumentation,
admin dashboards).

---

## Notification fan-out

All prod alarms publish to a single SNS topic:

- **Topic:** `polemicyst-prod-alarms`
- **ARN:** `arn:aws:sns:us-east-1:746669200861:polemicyst-prod-alarms`
- **Subscriber:** `aconnor731@gmail.com` (email)

Each alarm is configured with both `AlarmActions` and `OKActions` so a recovery
notification follows every fire — silence does not mean OK.

The budget guardrail (`Monthly-Cost-Alert-150`) is a separate AWS Budgets alert and uses
its own delivery path; it does not flow through this topic.

## Alarms

| Alarm name                     | Metric                                         | Threshold               | Notes                                                                       |
| ------------------------------ | ---------------------------------------------- | ----------------------- | --------------------------------------------------------------------------- |
| `prod-alb-5xx-rate`            | `AWS/ApplicationELB.HTTPCode_Target_5XX_Count` | `> 10` over 5 min       | App-side errors (target 5xx, not LB 5xx) on `polemicyst-alb`.               |
| `prod-alb-unhealthy-targets`   | `AWS/ApplicationELB.UnHealthyHostCount`        | `> 0` for 2 of 2 min    | `polemicyst-prod-web-tg` lost a healthy host — likely deploy or task crash. |
| `prod-web-cpu-high`            | `AWS/ECS.CPUUtilization`                       | `> 85%` for 3 of 15 min | `polemicyst-prod-web` saturated — needs scale-out.                          |
| `prod-web-memory-high`         | `AWS/ECS.MemoryUtilization`                    | `> 85%` for 2 of 10 min | Risk of OOM kill on `polemicyst-prod-web`.                                  |
| `prod-clip-worker-cpu-high`    | `AWS/ECS.CPUUtilization`                       | `> 85%` for 3 of 15 min | Clip rendering backlog likely; check BullMQ queue depth.                    |
| `prod-clip-worker-memory-high` | `AWS/ECS.MemoryUtilization`                    | `> 85%` for 2 of 10 min | FFmpeg leak suspected if sustained.                                         |
| `prod-redis-memory-high`       | `AWS/ECS.MemoryUtilization`                    | `> 85%` for 2 of 10 min | Risk of queue OOM — BullMQ jobs lost.                                       |
| `prod-rds-cpu-high`            | `AWS/RDS.CPUUtilization`                       | `> 80%` for 3 of 15 min | `polemicyst-prod-db` saturated — query review or instance upsize.           |
| `prod-rds-connections-high`    | `AWS/RDS.DatabaseConnections`                  | `> 70` for 2 of 10 min  | `db.t3.small` caps at ~85 connections; connection leak likely.              |
| `prod-rds-storage-low`         | `AWS/RDS.FreeStorageSpace`                     | `< 5 GB` for 1 of 5 min | Storage auto-scaling will kick in but provision more before then.           |

All alarms use `TreatMissingData = notBreaching` so a scaled-to-zero service does not
self-page; this is intentional during the early-stage scale-to-zero posture (see
`AWS_COST_REDUCTION.md`).

## On-page response

When an alarm fires:

1. **Read the alarm body** — the email + SNS payload include `AlarmDescription` which
   is the short response hint (see table).
2. **Open CloudWatch** — `https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#alarmsV2:`
   to see the metric graph and the breach context.
3. **Open the relevant log group**:
   - Web: `/ecs/polemicyst-web`
   - Clip worker: `/ecs/polemicyst-clip-worker`
   - Or `aws logs tail /ecs/<group> --follow`
4. **Cross-check Sentry** — the operational error stream from W009 (PR #273).
   Aggregated error spikes usually precede the alarm by minutes.

## Coverage gaps (intentionally not alarmed)

- **BullMQ queue depth** — not surfaced as a native CloudWatch metric. Cover via a future
  cron that pushes a custom metric, or surface in `/admin/metrics`.
- **ECS task crash loop** — `AWS/ECS` doesn't expose `RunningCount` natively. Container
  Insights is required (extra cost). For now, `prod-alb-unhealthy-targets` catches the
  most painful manifestation (web crashing) and CPU + memory alarms catch the rest.
- **Cost burn rate** — handled by AWS Budgets (`Monthly-Cost-Alert-150`), not CloudWatch.
- **Cert expiry** — ACM auto-renews managed certs; no alarm needed.

## Creation script

The alarms above were provisioned via AWS CLI (see fleet item W011 from
`docs/INVESTOR_READINESS.md`). To recreate from scratch in a fresh account, the commands
in the W011 PR description are idempotent — `put-metric-alarm` is upsert.
