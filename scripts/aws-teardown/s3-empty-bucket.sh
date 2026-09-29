#!/usr/bin/env bash
# Empty an S3 bucket (all current versions, all noncurrent versions, all delete markers)
# so it can be deleted. Idempotent — an already-empty bucket is a no-op.
#
# Usage:  bash s3-empty-bucket.sh <bucket-name>

set -euo pipefail

BUCKET="${1:?usage: s3-empty-bucket.sh <bucket>}"

if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "[SKIP] Bucket $BUCKET does not exist (or no permission)."
  exit 0
fi

echo "== Emptying s3://$BUCKET =="

# 1. Fast path: delete all current-version objects
OBJ_COUNT=$(aws s3api list-objects-v2 --bucket "$BUCKET" --query 'KeyCount' --output text 2>/dev/null || echo 0)
if [ "$OBJ_COUNT" != "0" ] && [ "$OBJ_COUNT" != "None" ]; then
  echo "  [OBJ] $OBJ_COUNT current objects — running aws s3 rm --recursive"
  aws s3 rm "s3://$BUCKET" --recursive
fi

# 2. Delete all noncurrent versions + delete markers (only relevant if versioning was ever enabled)
VERSIONING=$(aws s3api get-bucket-versioning --bucket "$BUCKET" --query 'Status' --output text 2>/dev/null || echo "Disabled")

if [ "$VERSIONING" = "Enabled" ] || [ "$VERSIONING" = "Suspended" ]; then
  echo "  [VER] versioning=$VERSIONING — purging non-current versions + delete markers"
  aws s3api list-object-versions --bucket "$BUCKET" \
    --query '{Objects: Versions[].{Key: Key, VersionId: VersionId}}' \
    --output json > /tmp/s3-versions-$$.json
  if [ -s /tmp/s3-versions-$$.json ] && grep -q Key /tmp/s3-versions-$$.json; then
    aws s3api delete-objects --bucket "$BUCKET" --delete file:///tmp/s3-versions-$$.json || true
  fi
  aws s3api list-object-versions --bucket "$BUCKET" \
    --query '{Objects: DeleteMarkers[].{Key: Key, VersionId: VersionId}}' \
    --output json > /tmp/s3-markers-$$.json
  if [ -s /tmp/s3-markers-$$.json ] && grep -q Key /tmp/s3-markers-$$.json; then
    aws s3api delete-objects --bucket "$BUCKET" --delete file:///tmp/s3-markers-$$.json || true
  fi
  rm -f /tmp/s3-versions-$$.json /tmp/s3-markers-$$.json
fi

# 3. Abort any in-progress multipart uploads
MPU_COUNT=$(aws s3api list-multipart-uploads --bucket "$BUCKET" --query 'Uploads | length(@)' --output text 2>/dev/null || echo 0)
if [ "$MPU_COUNT" != "0" ] && [ "$MPU_COUNT" != "None" ]; then
  echo "  [MPU] $MPU_COUNT in-progress multipart uploads — aborting"
  aws s3api list-multipart-uploads --bucket "$BUCKET" \
    --query 'Uploads[].[Key, UploadId]' --output text | while read -r K U; do
    [ -z "$K" ] && continue
    aws s3api abort-multipart-upload --bucket "$BUCKET" --key "$K" --upload-id "$U" || true
  done
fi

# 4. Verify
FINAL=$(aws s3api list-objects-v2 --bucket "$BUCKET" --query 'KeyCount' --output text 2>/dev/null || echo 0)
echo "[VERIFY] $BUCKET KeyCount = $FINAL"
[ "$FINAL" = "0" ] || [ "$FINAL" = "None" ] || { echo "[ERR] bucket not empty"; exit 1; }
echo "[OK] $BUCKET is empty"
