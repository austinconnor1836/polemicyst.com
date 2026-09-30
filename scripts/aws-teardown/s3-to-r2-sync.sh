#!/usr/bin/env bash
# Sync S3 media bucket to Cloudflare R2. Idempotent — re-running after a full sync
# copies 0 objects (aws s3 sync compares by size + mtime).
#
# Uses two `aws` invocations pointed at two different endpoints. R2 is S3-compatible,
# so `aws s3 sync` works with the R2 endpoint override.
#
# Env vars:
#   S3_BUCKET               — source bucket (default: polemicyst-uploads-prod)
#   R2_ACCOUNT_ID           — Cloudflare account id
#   R2_ACCESS_KEY_ID        — R2 access key
#   R2_SECRET_ACCESS_KEY    — R2 secret
#   R2_BUCKET               — target R2 bucket (default: clipfire-media)
#
# Flags:
#   --verify-only    — do not sync; just count objects in both and diff.
#   --dry-run        — pass --dryrun to the underlying aws s3 sync

set -euo pipefail

MODE="sync"
DRYRUN=""
for arg in "$@"; do
  case "$arg" in
    --verify-only) MODE="verify" ;;
    --dry-run) DRYRUN="--dryrun" ;;
  esac
done

S3_BUCKET="${S3_BUCKET:-polemicyst-uploads-prod}"
R2_BUCKET="${R2_BUCKET:-clipfire-media}"

: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID not set}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID not set}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY not set}"

R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

echo "== S3 -> R2 sync =="
echo "  source: s3://$S3_BUCKET (via AWS creds)"
echo "  target: s3://$R2_BUCKET (via R2 endpoint $R2_ENDPOINT)"
echo "  mode:   $MODE"
echo

# 1. Count objects in S3
S3_COUNT=$(aws s3api list-objects-v2 --bucket "$S3_BUCKET" \
  --query 'KeyCount' --output text 2>/dev/null || echo "0")
S3_SIZE_BYTES=$(aws s3api list-objects-v2 --bucket "$S3_BUCKET" \
  --query 'sum(Contents[].Size)' --output text 2>/dev/null || echo "0")
echo "[SRC] s3://$S3_BUCKET — $S3_COUNT objects, $S3_SIZE_BYTES bytes"

# 2. Count objects in R2
R2_COUNT=$(AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  aws s3api list-objects-v2 --bucket "$R2_BUCKET" --endpoint-url "$R2_ENDPOINT" \
  --query 'KeyCount' --output text 2>/dev/null || echo "0")
R2_SIZE_BYTES=$(AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  aws s3api list-objects-v2 --bucket "$R2_BUCKET" --endpoint-url "$R2_ENDPOINT" \
  --query 'sum(Contents[].Size)' --output text 2>/dev/null || echo "0")
echo "[DST] r2://$R2_BUCKET — $R2_COUNT objects, $R2_SIZE_BYTES bytes"

if [ "$MODE" = "verify" ]; then
  if [ "$S3_COUNT" = "$R2_COUNT" ] && [ "$S3_SIZE_BYTES" = "$R2_SIZE_BYTES" ]; then
    echo "[OK] S3 and R2 are in parity ($S3_COUNT objects, $S3_SIZE_BYTES bytes each)"
    exit 0
  else
    echo "[FAIL] Parity mismatch: S3 $S3_COUNT/$S3_SIZE_BYTES vs R2 $R2_COUNT/$R2_SIZE_BYTES"
    exit 1
  fi
fi

# 3. Two-hop sync: aws s3 sync from S3 to a local temp dir? No — that's terabytes.
# Instead, use `aws s3 cp --recursive` streaming via presigned URLs? No — no CLI support.
# Correct approach: `rclone` if installed (native s3-to-s3), OR `aws s3 sync` with a custom
# endpoint. Since R2 is S3-compatible, the cleanest wire path is:
#   1. read from S3 (default endpoint, AWS creds)
#   2. write to R2 (R2 endpoint, R2 creds)
# `aws s3 sync` cannot switch credentials mid-command, so we use `rclone` if present, and
# fall back to a two-pass (list + per-object cp) if not.

if command -v rclone >/dev/null 2>&1; then
  echo "[SYNC] using rclone (fastest, streams s3-to-r2 without local disk)"
  # Expect rclone remotes named 'aws' and 'r2' to be configured. Print instructions if not.
  if ! rclone listremotes | grep -q '^aws:'; then
    cat <<EOF
[ERR] rclone remote 'aws' not configured. Run:
  rclone config
  # Add a new remote named 'aws' of type 's3', provider 'AWS', use env auth
EOF
    exit 1
  fi
  if ! rclone listremotes | grep -q '^r2:'; then
    cat <<EOF
[ERR] rclone remote 'r2' not configured. Run:
  rclone config
  # Add a new remote named 'r2' of type 's3', provider 'Cloudflare', endpoint $R2_ENDPOINT
EOF
    exit 1
  fi
  rclone sync "aws:$S3_BUCKET" "r2:$R2_BUCKET" \
    --checksum --transfers 32 --checkers 32 --progress $DRYRUN
else
  echo "[SYNC] rclone not installed — falling back to per-object cp (slower)"
  echo "[HINT] brew install rclone; then rclone config"
  aws s3api list-objects-v2 --bucket "$S3_BUCKET" --query 'Contents[].Key' --output text | tr '\t' '\n' | while read -r KEY; do
    [ -z "$KEY" ] && continue
    # Check if key already exists in R2 (idempotent)
    if AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
       aws s3api head-object --bucket "$R2_BUCKET" --key "$KEY" --endpoint-url "$R2_ENDPOINT" >/dev/null 2>&1; then
      continue
    fi
    TMP=$(mktemp)
    aws s3api get-object --bucket "$S3_BUCKET" --key "$KEY" "$TMP" >/dev/null
    AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
      aws s3api put-object --bucket "$R2_BUCKET" --key "$KEY" --body "$TMP" --endpoint-url "$R2_ENDPOINT" >/dev/null
    rm -f "$TMP"
    echo "  copied $KEY"
  done
fi

# 4. Re-count for verification
NEW_R2_COUNT=$(AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  aws s3api list-objects-v2 --bucket "$R2_BUCKET" --endpoint-url "$R2_ENDPOINT" \
  --query 'KeyCount' --output text 2>/dev/null || echo "0")
echo "[POST] r2://$R2_BUCKET now has $NEW_R2_COUNT objects (was $R2_COUNT, source has $S3_COUNT)"

if [ "$NEW_R2_COUNT" = "$S3_COUNT" ]; then
  echo "[OK] parity reached"
  exit 0
else
  echo "[WARN] object count still mismatched — re-run the script; it's idempotent"
  exit 1
fi
