# AWS teardown scripts

Companion scripts to `docs/migration/aws-teardown.md`. Each is small, idempotent, safe to re-run.

## Order

Run in the order the doc's phase numbers imply:

| Phase          | Script                        | Purpose                                                                              |
| -------------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| 0              | `preflight.sh`                | Verify NEW stack (Vercel, Fly, Neon, R2, Upstash) is up before ANY destructive step. |
| 1.2 / 1.3      | `rds-snapshot.sh <env>`       | Take final RDS snapshot for one env.                                                 |
| 1.4            | `rds-export.sh <env>`         | Export snapshot to S3 as parquet (portable off AWS).                                 |
| 1.6            | `s3-to-r2-sync.sh`            | Sync S3 media bucket to Cloudflare R2. `--verify-only` to just count.                |
| 1.7            | `ecr-inventory.sh`            | Dump ECR tags to JSON so you know what was live.                                     |
| 2.1            | `disable-autoscaling.sh`      | Deregister all ECS scalable targets + policies.                                      |
| 2.2            | `ecs-scale-to-zero.sh`        | Scale all services to 0, wait for tasks to drain.                                    |
| (2.3 fallback) | `ecs-force-stop.sh`           | Force-stop stuck tasks. Only if scale-to-zero left runners.                          |
| 2.4            | `ecs-delete-services.sh`      | Delete all services.                                                                 |
| 2.5            | `ecs-deregister-task-defs.sh` | Deregister all ACTIVE task-def revisions.                                            |
| 8.2            | `s3-empty-bucket.sh <bucket>` | Empty a bucket (versions, delete markers, MPU) before delete.                        |
| 14.2           | `cost-check.sh`               | Post-teardown: verify AWS spend is going to zero.                                    |
| 14.3           | `orphan-sweep.sh`             | Post-teardown: catch stragglers (EIP, EBS, snapshots).                               |

## Env vars

Source your secrets file first. The scripts read (as needed):

```
# Preflight
NEW_STACK_URL              # https://clipfire.app
FLY_HEALTH_URL             # https://clip-worker.fly.dev/healthz
NEON_PROD_URL              # postgresql://...
UPSTASH_REDIS_URL          # rediss://...

# S3 -> R2 sync
S3_BUCKET                  # polemicyst-uploads-prod (default)
R2_ACCOUNT_ID              # Cloudflare account id
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET                  # clipfire-media (default)

# RDS export (optional — created if unset)
RDS_EXPORT_KMS_KEY_ARN
RDS_EXPORT_ROLE_ARN
```

## Safety

- Every script is a no-op if the resource is already in the target state.
- The preflight script (`preflight.sh`) is the only enforcement of "new stack is up before we tear down." Run it before every destructive phase.
- No script touches AWS credentials — they must be exported (`AWS_PROFILE=...` or `AWS_ACCESS_KEY_ID=...`) by the operator.
- Nothing in here executes on its own. Austin runs each step at the keyboard.
