#!/usr/bin/env bash
#
# Run pending Prisma migrations against PROD RDS by launching a one-shot
# ECS Fargate task in the prod private subnets, using the prod-web task
# definition with a command override of `npx prisma migrate deploy`.
#
# Prereqs:
#   - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION in env (or .env)
#   - aws CLI installed
#
# Idempotent: `prisma migrate deploy` is a no-op when there are no pending
# migrations. Safe to re-run.
#
# Investor readiness fleet — companion to docs/INVESTOR_READINESS.md W027.

set -euo pipefail

CLUSTER="${ECS_CLUSTER:-polemicyst-cluster}"
TASK_DEF="${MIGRATE_TASK_DEF:-polemicyst-prod-web}"
SUBNETS="${MIGRATE_SUBNETS:-subnet-078e83e418e605652,subnet-0d7564ff4f8415aae}"
SECURITY_GROUPS="${MIGRATE_SECURITY_GROUPS:-sg-09a27b41866a5e5eb}"
CONTAINER_NAME="${MIGRATE_CONTAINER:-web}"

cd "$(dirname "$0")/.."

if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]] && [[ -f .env ]]; then
  echo "Sourcing AWS creds from .env..."
  set -a; source .env; set +a
fi

if ! command -v aws >/dev/null; then
  echo "ERROR: aws CLI not installed" >&2
  exit 1
fi

echo "Cluster:         $CLUSTER"
echo "Task definition: $TASK_DEF"
echo "Subnets:         $SUBNETS"
echo "Security groups: $SECURITY_GROUPS"
echo "Container:       $CONTAINER_NAME"
echo
echo "Pending local migrations:"
ls -1 prisma/migrations | grep -v migration_lock.toml | tail -10
echo
read -r -p "Run prisma migrate deploy against PROD RDS? [y/N] " yn
case "$yn" in
  [Yy]*) ;;
  *) echo "Aborted."; exit 1 ;;
esac

echo
echo "Launching ECS task..."
OVERRIDES_JSON=$(printf '{"containerOverrides":[{"name":"%s","command":["npx","prisma","migrate","deploy"]}]}' "$CONTAINER_NAME")
TASK_ARN=$(aws ecs run-task \
  --cluster "$CLUSTER" \
  --task-definition "$TASK_DEF" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUPS],assignPublicIp=DISABLED}" \
  --overrides "$OVERRIDES_JSON" \
  --query 'tasks[0].taskArn' --output text)

if [[ -z "$TASK_ARN" || "$TASK_ARN" == "None" ]]; then
  echo "ERROR: run-task returned no taskArn (see AWS console for failures)" >&2
  exit 1
fi

echo "Launched task: $TASK_ARN"
echo "Polling until it exits..."

while true; do
  STATUS=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
    --query 'tasks[0].lastStatus' --output text 2>/dev/null || echo "UNKNOWN")
  echo "  status: $STATUS"
  case "$STATUS" in
    STOPPED)
      EXIT_CODE=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
        --query 'tasks[0].containers[0].exitCode' --output text)
      STOPPED_REASON=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
        --query 'tasks[0].stoppedReason' --output text)
      echo
      echo "Container exit code: $EXIT_CODE"
      echo "Stopped reason:      $STOPPED_REASON"
      echo
      echo "Container logs: aws logs tail /ecs/polemicyst-web --since 10m"
      if [[ "$EXIT_CODE" == "0" ]]; then
        echo "Migration deploy succeeded."
        exit 0
      else
        echo "Migration deploy FAILED. Inspect logs immediately." >&2
        exit "$EXIT_CODE"
      fi
      ;;
    UNKNOWN)
      echo "ERROR: cannot read task status" >&2
      exit 1
      ;;
    *)
      sleep 10
      ;;
  esac
done
