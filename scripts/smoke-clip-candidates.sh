#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   FEED_VIDEO_ID=... USER_ID=... ./scripts/smoke-clip-candidates.sh
#
# Requires:
# - docker compose up (db, redis, backend, clip-worker)
# - feed_video row exists and is accessible (transcriptJson present OR s3Url reachable for transcription)

if [[ -z "${FEED_VIDEO_ID:-}" || -z "${USER_ID:-}" ]]; then
  echo "Missing FEED_VIDEO_ID or USER_ID."
  echo "Example: FEED_VIDEO_ID=... USER_ID=... $0"
  exit 1
fi

curl -sS -X POST "http://localhost:3001/api/clip-jobs/enqueue" \
  -H "Content-Type: application/json" \
  -d "{\"feedVideoId\":\"${FEED_VIDEO_ID}\",\"userId\":\"${USER_ID}\",\"aspectRatio\":\"9:16\",\"scoringMode\":\"${SCORING_MODE:-hybrid}\",\"includeAudio\":${INCLUDE_AUDIO:-true}}"

echo
echo "Enqueued. The clip-worker will call /api/clip-candidates and persist top candidates as Segment rows."
echo "To inspect results quickly, you can query the DB (Segment table) or call /api/clip-candidates directly."


