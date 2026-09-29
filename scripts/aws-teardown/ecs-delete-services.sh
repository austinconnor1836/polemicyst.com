#!/usr/bin/env bash
# Delete every ECS service in polemicyst-cluster. Requires desired_count=0 first
# (see ecs-scale-to-zero.sh). Idempotent — already-deleted services are skipped.
#
# Usage:  bash ecs-delete-services.sh

set -euo pipefail

CLUSTER=polemicyst-cluster

if ! aws ecs describe-clusters --clusters "$CLUSTER" --query 'clusters[0].status' --output text 2>/dev/null | grep -q ACTIVE; then
  echo "[SKIP] Cluster $CLUSTER not active."
  exit 0
fi

SERVICES=$(aws ecs list-services --cluster "$CLUSTER" \
  --query 'serviceArns[]' --output text)

if [ -z "$SERVICES" ]; then
  echo "[OK] no services to delete"
  exit 0
fi

for SVC_ARN in $SERVICES; do
  SVC_NAME=$(basename "$SVC_ARN")
  DESIRED=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SVC_ARN" \
    --query 'services[0].desiredCount' --output text)
  if [ "$DESIRED" != "0" ]; then
    echo "  [ERR] $SVC_NAME desired=$DESIRED (not 0). Run ecs-scale-to-zero.sh first."
    exit 1
  fi
  echo "  [DELETE] $SVC_NAME"
  aws ecs delete-service --cluster "$CLUSTER" --service "$SVC_ARN" >/dev/null
done

# Poll for INACTIVE
sleep 5
REMAINING=$(aws ecs list-services --cluster "$CLUSTER" \
  --query 'serviceArns | length(@)' --output text)
echo "[VERIFY] services remaining: $REMAINING"
[ "$REMAINING" = "0" ] || { echo "[WARN] some services still listed — likely draining; poll again in 30s"; exit 1; }
echo "[OK] all services deleted"
