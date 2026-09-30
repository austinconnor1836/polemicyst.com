#!/usr/bin/env bash
#
# RDS → Neon Postgres migration.
#
# One-shot, idempotent enough to re-run: dumps SCHEMA + DATA from RDS with
# pg_dump, restores into Neon with pg_restore. Uses the custom format
# (`-Fc`) so we get parallelism + selective restore.
#
# Neon runs Postgres 16. If your RDS instance is on 15 that's fine —
# pg_dump from a 16 client against a 15 server works. Install PG 16
# client:
#
#   brew install postgresql@16
#   export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
#
# Required env:
#   RDS_URL   — postgres://user:pass@rds-host:5432/dbname
#   NEON_URL  — postgres://user:pass@ep-xxx.<region>.aws.neon.tech/neondb?sslmode=require
#               (use the DIRECT — non-pooler — URL for restore; pgBouncer breaks pg_restore)
#
# Optional env:
#   DUMP_FILE — where to stash the custom-format dump. Default: ./tmp/rds-dump.pgcustom
#   JOBS      — parallel restore workers. Default: 4
#
# Usage:
#   RDS_URL=... NEON_URL=... scripts/migrate-rds-to-neon.sh
#   RDS_URL=... NEON_URL=... scripts/migrate-rds-to-neon.sh --skip-dump  # re-run restore only
#
# Safety:
#   - Neon target must be a fresh empty database. If it has schema already,
#     pg_restore will complain about existing objects. Add --clean if you
#     want to drop-and-recreate (destructive).
#   - This script does NOT touch RDS beyond a read-only pg_dump.

set -euo pipefail

: "${RDS_URL:?RDS_URL env var required}"
: "${NEON_URL:?NEON_URL env var required (use the DIRECT — non-pooler — Neon URL)}"

DUMP_FILE="${DUMP_FILE:-./tmp/rds-dump.pgcustom}"
JOBS="${JOBS:-4}"
SKIP_DUMP=false
CLEAN=false

for arg in "$@"; do
  case "$arg" in
    --skip-dump) SKIP_DUMP=true ;;
    --clean) CLEAN=true ;;
    -h|--help)
      grep -E '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
  esac
done

mkdir -p "$(dirname "$DUMP_FILE")"

# Sanity: warn if NEON_URL looks like the pooler endpoint.
if [[ "$NEON_URL" == *"-pooler"* ]]; then
  echo "WARN: NEON_URL contains '-pooler' — pgBouncer's transaction pooling breaks pg_restore." >&2
  echo "      Use the DIRECT Neon URL (same host without '-pooler') for the restore." >&2
  exit 1
fi

if [[ "$SKIP_DUMP" == false ]]; then
  echo "[migrate] pg_dump RDS → $DUMP_FILE"
  # -Fc  custom format (parallel-restorable)
  # -Z 6 mid compression
  # --no-owner / --no-acl  Neon roles differ; drop ownership + grants
  # --no-privileges  same
  # --exclude-schema=aws_*  RDS-only schemas
  pg_dump \
    --format=custom \
    --compress=6 \
    --no-owner \
    --no-acl \
    --no-privileges \
    --verbose \
    --exclude-schema='aws_*' \
    --file="$DUMP_FILE" \
    "$RDS_URL"
  echo "[migrate] dump complete: $(du -h "$DUMP_FILE" | cut -f1)"
else
  echo "[migrate] skipping dump (--skip-dump); using existing $DUMP_FILE"
  if [[ ! -f "$DUMP_FILE" ]]; then
    echo "ERROR: --skip-dump set but $DUMP_FILE does not exist." >&2
    exit 1
  fi
fi

echo "[migrate] pg_restore → Neon"
# --clean drops existing objects first (destructive; only when --clean flag passed)
# -j parallel workers
# --no-owner / --no-acl  again, on the restore side
# --if-exists  paired with --clean so DROP doesn't error on empty target
RESTORE_FLAGS=(
  --no-owner
  --no-acl
  --exit-on-error
  --jobs="$JOBS"
  --verbose
  --dbname="$NEON_URL"
)
if [[ "$CLEAN" == true ]]; then
  RESTORE_FLAGS+=( --clean --if-exists )
fi
pg_restore "${RESTORE_FLAGS[@]}" "$DUMP_FILE"

echo "[migrate] done."
echo ""
echo "Post-restore checklist:"
echo "  1. Point DATABASE_URL at the POOLED Neon endpoint (?pgbouncer=true) for the app."
echo "  2. Point DIRECT_DATABASE_URL at the DIRECT Neon endpoint for future 'prisma migrate deploy'."
echo "  3. Run 'npx prisma migrate status' to confirm migration history is intact."
echo "  4. Verify row counts against RDS with a spot check on 3-5 critical tables."
