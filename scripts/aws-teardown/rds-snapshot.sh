#!/usr/bin/env bash
# Take a final RDS snapshot for one environment. Idempotent — if today's snapshot
# already exists and is available, no-op with exit 0.
#
# Usage:  bash rds-snapshot.sh <env>       # env = prod | dev
#
# Snapshot naming: clipfire-final-<env>-YYYY-MM-DD

set -euo pipefail

ENV="${1:?usage: rds-snapshot.sh <prod|dev>}"
DB_ID="polemicyst-${ENV}-db"
DATE=$(date +%Y-%m-%d)
SNAP_ID="clipfire-final-${ENV}-${DATE}"

echo "== RDS snapshot: $DB_ID -> $SNAP_ID =="

# Sanity: does the DB instance exist?
if ! aws rds describe-db-instances --db-instance-identifier "$DB_ID" >/dev/null 2>&1; then
  echo "[WARN] DB instance $DB_ID not found (already deleted?). Skipping snapshot."
  exit 0
fi

# Idempotency: already have this snapshot?
STATUS=$(aws rds describe-db-snapshots --db-snapshot-identifier "$SNAP_ID" \
  --query 'DBSnapshots[0].Status' --output text 2>/dev/null || echo "NONE")

case "$STATUS" in
  available)
    echo "[OK] Snapshot $SNAP_ID already exists and is available. No-op."
    exit 0
    ;;
  creating)
    echo "[WAIT] Snapshot $SNAP_ID is being created. Waiting for it to become available..."
    aws rds wait db-snapshot-available --db-snapshot-identifier "$SNAP_ID"
    echo "[OK] Snapshot $SNAP_ID now available."
    exit 0
    ;;
  NONE)
    echo "[CREATE] Creating snapshot $SNAP_ID..."
    aws rds create-db-snapshot \
      --db-instance-identifier "$DB_ID" \
      --db-snapshot-identifier "$SNAP_ID" \
      --tags Key=Purpose,Value=aws-teardown-final Key=Environment,Value="$ENV"
    echo "[WAIT] Waiting for snapshot to become available (this can take 5-30 min)..."
    aws rds wait db-snapshot-available --db-snapshot-identifier "$SNAP_ID"
    echo "[OK] Snapshot $SNAP_ID now available."
    ;;
  *)
    echo "[ERR] Snapshot $SNAP_ID in unexpected state: $STATUS"
    exit 1
    ;;
esac

# Print size for the record
SIZE=$(aws rds describe-db-snapshots --db-snapshot-identifier "$SNAP_ID" \
  --query 'DBSnapshots[0].AllocatedStorage' --output text)
echo "[INFO] Snapshot allocated storage: ${SIZE} GiB"
