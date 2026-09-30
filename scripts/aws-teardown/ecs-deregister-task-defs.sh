#!/usr/bin/env bash
# Deregister every ACTIVE task definition revision whose family starts with 'polemicyst'.
# AWS keeps deregistered task defs indefinitely (as INACTIVE) — that's fine, they're free
# to store. We just want none marked ACTIVE.
#
# Usage:  bash ecs-deregister-task-defs.sh

set -euo pipefail

echo "== Deregistering all ACTIVE polemicyst task definition revisions =="

FAMILIES=$(aws ecs list-task-definition-families --family-prefix polemicyst --status ACTIVE \
  --query 'families[]' --output text)

if [ -z "$FAMILIES" ]; then
  echo "[OK] no ACTIVE polemicyst task-def families remain"
  exit 0
fi

for FAMILY in $FAMILIES; do
  REVS=$(aws ecs list-task-definitions --family-prefix "$FAMILY" --status ACTIVE \
    --query 'taskDefinitionArns[]' --output text)
  for REV in $REVS; do
    echo "  [DEREG] $REV"
    aws ecs deregister-task-definition --task-definition "$REV" >/dev/null
  done
done

REMAINING=$(aws ecs list-task-definitions --family-prefix polemicyst --status ACTIVE \
  --query 'taskDefinitionArns | length(@)' --output text)
echo "[VERIFY] ACTIVE polemicyst task defs: $REMAINING"
[ "$REMAINING" = "0" ] || { echo "[ERR] some remain ACTIVE"; exit 1; }
echo "[OK] all task-def revisions deregistered"
