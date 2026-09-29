#!/usr/bin/env bash
# Disable Application Auto Scaling on all Polemicyst ECS services so nothing scales
# back up during teardown.
#
# Usage:  bash disable-autoscaling.sh

set -euo pipefail

echo "== Disabling autoscaling on polemicyst ECS services =="

# List all scalable targets in ECS namespace, filter to polemicyst
aws application-autoscaling describe-scalable-targets \
  --service-namespace ecs \
  --query 'ScalableTargets[?contains(ResourceId, `polemicyst`)].[ResourceId, ScalableDimension]' \
  --output text | while read -r RESOURCE_ID DIMENSION; do
    [ -z "$RESOURCE_ID" ] && continue
    echo "  deregistering $RESOURCE_ID ($DIMENSION)"

    # First delete any policies attached to this target
    aws application-autoscaling describe-scaling-policies \
      --service-namespace ecs \
      --resource-id "$RESOURCE_ID" \
      --scalable-dimension "$DIMENSION" \
      --query 'ScalingPolicies[].PolicyName' \
      --output text | tr '\t' '\n' | while read -r POLICY; do
        [ -z "$POLICY" ] && continue
        aws application-autoscaling delete-scaling-policy \
          --service-namespace ecs \
          --resource-id "$RESOURCE_ID" \
          --scalable-dimension "$DIMENSION" \
          --policy-name "$POLICY" || true
    done

    aws application-autoscaling deregister-scalable-target \
      --service-namespace ecs \
      --resource-id "$RESOURCE_ID" \
      --scalable-dimension "$DIMENSION" || true
done

REMAINING=$(aws application-autoscaling describe-scalable-targets \
  --service-namespace ecs \
  --query 'ScalableTargets[?contains(ResourceId, `polemicyst`)] | length(@)' \
  --output text)
echo "[VERIFY] polemicyst scalable targets remaining: $REMAINING"
[ "$REMAINING" = "0" ] || { echo "[ERR] Some targets did not deregister"; exit 1; }
echo "[OK] all polemicyst autoscaling deregistered"
