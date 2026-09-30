#!/usr/bin/env bash
# Force-stop every running task in polemicyst-cluster. Use this only when
# ecs-scale-to-zero.sh has left tasks in a stuck state (e.g. draining, restarting).
#
# Usage:  bash ecs-force-stop.sh

set -euo pipefail

CLUSTER=polemicyst-cluster

if ! aws ecs describe-clusters --clusters "$CLUSTER" --query 'clusters[0].status' --output text 2>/dev/null | grep -q ACTIVE; then
  echo "[SKIP] Cluster $CLUSTER not active. Nothing to do."
  exit 0
fi

TASKS=$(aws ecs list-tasks --cluster "$CLUSTER" --query 'taskArns[]' --output text)
if [ -z "$TASKS" ]; then
  echo "[OK] No tasks running."
  exit 0
fi

for T in $TASKS; do
  echo "  [STOP] $T"
  aws ecs stop-task --cluster "$CLUSTER" --task "$T" --reason "teardown" >/dev/null || true
done

echo "[WAIT] waiting for stop to propagate"
sleep 20

REMAINING=$(aws ecs list-tasks --cluster "$CLUSTER" --query 'taskArns | length(@)' --output text)
if [ "$REMAINING" = "0" ]; then
  echo "[OK] all tasks stopped"
else
  echo "[WARN] $REMAINING tasks still listed (may be in STOPPING). Re-run in 30s if needed."
fi
