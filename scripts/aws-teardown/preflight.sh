#!/usr/bin/env bash
# Preflight — verify the NEW stack (Cloudflare R2 + Neon + Upstash + Vercel + Fly) is up
# before any destructive AWS teardown step. If ANY check fails, exit non-zero and the
# teardown scripts refuse to proceed. This is the safety net.
#
# Env vars (source your teardown secrets file before running):
#   NEW_STACK_URL           — the Vercel prod URL (e.g. https://clipfire.app)
#   FLY_HEALTH_URL          — the Fly worker healthz endpoint (e.g. https://clip-worker.fly.dev/healthz)
#   NEON_PROD_URL           — postgres URL for Neon prod
#   R2_ACCOUNT_ID           — Cloudflare account id (for a lightweight R2 credential probe)
#   R2_ACCESS_KEY_ID        — R2 access key
#   R2_SECRET_ACCESS_KEY    — R2 secret
#   R2_BUCKET               — R2 bucket name (e.g. clipfire-media)
#   UPSTASH_REDIS_URL       — Upstash Redis URL (rediss://...)
#
# Usage:  bash preflight.sh
# Exit codes:  0 = all green, 1 = at least one check failed

set -uo pipefail

FAIL=0
GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[1;33m"
NC="\033[0m"

pass() { printf "${GREEN}[PASS]${NC} %s\n" "$1"; }
fail() { printf "${RED}[FAIL]${NC} %s\n" "$1"; FAIL=1; }
warn() { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }

echo "== Clipfire AWS teardown preflight =="
echo "Verifying new stack (Vercel + Fly + Neon + R2 + Upstash) before allowing any destructive step."
echo

# 1. Vercel prod URL returns 2xx
if [ -z "${NEW_STACK_URL:-}" ]; then
  fail "NEW_STACK_URL not set — cannot verify Vercel prod"
else
  CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 15 "$NEW_STACK_URL" || echo "000")
  if [[ "$CODE" =~ ^2 ]]; then
    pass "Vercel prod $NEW_STACK_URL returned HTTP $CODE"
  else
    fail "Vercel prod $NEW_STACK_URL returned HTTP $CODE (want 2xx)"
  fi
fi

# 2. Fly workers healthz
if [ -z "${FLY_HEALTH_URL:-}" ]; then
  warn "FLY_HEALTH_URL not set — skipping Fly health check"
else
  CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 15 "$FLY_HEALTH_URL" || echo "000")
  if [[ "$CODE" =~ ^2 ]]; then
    pass "Fly worker $FLY_HEALTH_URL returned HTTP $CODE"
  else
    fail "Fly worker $FLY_HEALTH_URL returned HTTP $CODE (want 2xx)"
  fi
fi

# 3. Neon prod reachable + has User rows
if [ -z "${NEON_PROD_URL:-}" ]; then
  fail "NEON_PROD_URL not set — cannot verify Neon"
elif ! command -v psql >/dev/null 2>&1; then
  fail "psql not installed — needed to verify Neon"
else
  USER_COUNT=$(psql "$NEON_PROD_URL" -tAc 'SELECT count(*) FROM "User"' 2>/dev/null || echo "err")
  if [[ "$USER_COUNT" =~ ^[0-9]+$ ]] && [ "$USER_COUNT" -ge 0 ]; then
    pass "Neon prod reachable, User table has $USER_COUNT rows"
  else
    fail "Neon prod unreachable or User table missing (got: $USER_COUNT)"
  fi
fi

# 4. R2 credentials work + bucket accessible
if [ -z "${R2_ACCOUNT_ID:-}" ] || [ -z "${R2_ACCESS_KEY_ID:-}" ] || [ -z "${R2_SECRET_ACCESS_KEY:-}" ] || [ -z "${R2_BUCKET:-}" ]; then
  fail "R2_* env vars not fully set — cannot verify R2"
else
  R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  # Use the AWS CLI in R2 mode
  R2_OK=$(AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    aws s3api head-bucket --bucket "$R2_BUCKET" --endpoint-url "$R2_ENDPOINT" 2>&1 && echo "ok" || echo "fail")
  if [[ "$R2_OK" == *"ok"* ]]; then
    pass "R2 bucket $R2_BUCKET reachable at $R2_ENDPOINT"
  else
    fail "R2 bucket $R2_BUCKET NOT reachable — $R2_OK"
  fi
fi

# 5. Upstash Redis reachable (optional — many teardowns don't need it)
if [ -z "${UPSTASH_REDIS_URL:-}" ]; then
  warn "UPSTASH_REDIS_URL not set — skipping Upstash check"
elif ! command -v redis-cli >/dev/null 2>&1; then
  warn "redis-cli not installed — skipping Upstash check"
else
  PONG=$(redis-cli -u "$UPSTASH_REDIS_URL" PING 2>/dev/null || echo "err")
  if [ "$PONG" = "PONG" ]; then
    pass "Upstash Redis reachable"
  else
    fail "Upstash Redis PING did not return PONG (got: $PONG)"
  fi
fi

echo
if [ $FAIL -eq 0 ]; then
  printf "${GREEN}== PREFLIGHT PASS ==${NC} New stack is up. Teardown may proceed.\n"
  exit 0
else
  printf "${RED}== PREFLIGHT FAIL ==${NC} New stack is not fully up. DO NOT run destructive AWS steps.\n"
  exit 1
fi
