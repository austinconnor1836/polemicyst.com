#!/usr/bin/env bash
# Dump a JSON inventory of every image tag currently in the three ECR repos, so if
# the corpus needs to be rebuilt after teardown you know exactly which tags were live.
#
# Usage:  bash ecr-inventory.sh > ~/backups/clipfire/ecr-inventory-$(date +%Y-%m-%d).json

set -euo pipefail

REPOS=(polemicyst-web polemicyst-clip-worker polemicyst-llm-worker)

echo "{"
FIRST=1
for REPO in "${REPOS[@]}"; do
  [ $FIRST -eq 0 ] && echo ","
  FIRST=0
  echo "  \"$REPO\": "
  aws ecr describe-images --repository-name "$REPO" \
    --query 'imageDetails[].{tags:imageTags, digest:imageDigest, pushedAt:imagePushedAt, sizeMB:imageSizeInBytes}' \
    2>/dev/null || echo "[]"
done
echo "}"
