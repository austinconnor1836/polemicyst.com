#!/usr/bin/env bash
# Scale every ECS service in polemicyst-cluster to desired_count=0, then wait for
# all tasks to drain. Idempotent — services already at 0 are skipped.
#
# Usage:  bash ecs-scale-to-zero.sh

set -euo pipefail

CLUSTER=polemicyst-cluster

if ! aws ecs describe-clusters --clusters "$CLUSTER" --query 'clusters[0].status' --output text 2>/dev/null | grep -q ACTIVE; then
  echo "[SKIP] Cluster $CLUSTER not active. Nothing to do."
  exit 0
fi

echo "== Scaling all $CLUSTER services to 0 =="

SERVICES=$(aws ecs list-services --cluster "$CLUSTER" \
  --query 'serviceArns[]' --output text)

if [ -z "$SERVICES" ]; then
  echo "[SKIP] No services in cluster."
  exit 0
fi

for SVC_ARN in $SERVICES; do
  SVC_NAME=$(basename "$SVC_ARN")
  CURRENT=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SVC_ARN" \
    --query 'services[0].desiredCount' --output text)
  if [ "$CURRENT" = "0" ]; then
    echo "  [SKIP] $SVC_NAME already at 0"
    continue
  fi
  echo "  [SCALE] $SVC_NAME: $CURRENT -> 0"
  aws ecs update-service --cluster "$CLUSTER" --service "$SVC_ARN" --desired-count 0 >/dev/null
done

echo
echo "[WAIT] Waiting for all tasks to drain (up to 5 min)..."
for i in $(seq 1 20); do
  RUNNING=$(aws ecs list-tasks --cluster "$CLUSTER" --query 'taskArns | length(@)' --output text)
  echo "  poll $i: $RUNNING tasks still running"
  [ "$RUNNING" = "0" ] && break
  sleep 15
done

FINAL=$(aws ecs list-tasks --cluster "$CLUSTER" --query 'taskArns | length(@)' --output text)
if [ "$FINAL" = "0" ]; then
  echo "[OK] all tasks drained"
  exit 0
else
  echo "[WARN] $FINAL tasks still running. Consider force-stopping via ecs-force-stop.sh"
  exit 1
fi
