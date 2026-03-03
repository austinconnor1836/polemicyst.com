#!/usr/bin/env bash
# dispatch-todos.sh — Parse TODO.md and launch a Cursor Cloud Agent for each
# unchecked item via the Cursor Cloud Agents API.
#
# Usage:
#   CURSOR_API_KEY=<key> ./scripts/dispatch-todos.sh [--dry-run] [--max N]
#
# Environment:
#   CURSOR_API_KEY   — Required. Obtain from Cursor Dashboard → Integrations.
#   REPO_URL         — Optional. Defaults to origin remote URL.
#   SOURCE_BRANCH    — Optional. Branch agents start from. Default: develop.
#   TODO_FILE        — Optional. Path to the TODO file. Default: TODO.md.
#   DISPATCHED_FILE  — Optional. Tracking file. Default: .dispatched-todos.

set -euo pipefail

DRY_RUN=false
MAX_AGENTS=0  # 0 = unlimited

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY_RUN=true; shift ;;
    --max)     MAX_AGENTS="$2"; shift 2 ;;
    *)         echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

TODO_FILE="${TODO_FILE:-TODO.md}"
DISPATCHED_FILE="${DISPATCHED_FILE:-.dispatched-todos}"
SOURCE_BRANCH="${SOURCE_BRANCH:-develop}"

if [[ "$DRY_RUN" == "false" ]]; then
  : "${CURSOR_API_KEY:?Set CURSOR_API_KEY (Cursor Dashboard → Integrations)}"
fi

if [[ -n "${REPO_URL:-}" ]]; then
  REPO="$REPO_URL"
else
  REPO=$(git remote get-url origin 2>/dev/null | sed 's|.*github\.com[:/]\(.*\)\.git$|https://github.com/\1|; s|.*github\.com[:/]\(.*\)$|https://github.com/\1|')
fi

if ! command -v jq &>/dev/null; then
  echo "Error: jq is required but not installed." >&2
  exit 1
fi

touch "$DISPATCHED_FILE"

# Patterns that indicate an item needs production access, external console
# access, or manual verification that an agent cannot perform.
BLOCKED_PATTERNS=(
  "production RDS"
  "ECS services healthy"
  "SSL certificate and DNS"
  "Google OAuth works in production"
  "Stripe webhooks reach production"
  "Test full user flow.*sign up"
  "End-to-end revenue flow"
  "Verify ECS"
  "Verify SSL"
  "Verify Google OAuth in production"
  "Configure Stripe webhooks for production"
  "Verify Stripe Customer Portal"
  "Run production database migrations"
  "CloudWatch alarms"
  "billing alerts in AWS"
  "CloudFront CDN"
  "automated RDS backups"
  "ECS auto-scaling"
  "Register new App ID.*Apple Developer"
  "provisioning profile"
  "App Store Connect app record"
  "GitHub Secrets"
  "Google Play Console"
  "Verify Android CI secrets"
  "Verify iOS CI secrets"
  "Firebase Crashlytics.*SPM"
  "crash-free rate gate"
  "Firebase.*google-services"
)

is_blocked() {
  local task="$1"
  for pattern in "${BLOCKED_PATTERNS[@]}"; do
    if echo "$task" | grep -qiE "$pattern"; then
      return 0
    fi
  done
  return 1
}

launched=0

# Parse TODO.md: track current section headers, extract unchecked items
current_h2=""
current_h3=""

while IFS= read -r line; do
  # Track section headers for context
  if [[ "$line" =~ ^##[[:space:]]+(.*) ]]; then
    current_h2="${BASH_REMATCH[1]}"
    current_h3=""
    continue
  fi
  if [[ "$line" =~ ^###[[:space:]]+(.*) ]]; then
    current_h3="${BASH_REMATCH[1]}"
    continue
  fi

  # Match unchecked items: "- [ ] ..." with optional bold prefix
  if [[ "$line" =~ ^-[[:space:]]\[[[:space:]]\][[:space:]]+(.*) ]]; then
    raw_task="${BASH_REMATCH[1]}"
    # Strip leading bold marker for display
    task=$(echo "$raw_task" | sed 's/^\*\*[^*]*\*\*[[:space:]]*—[[:space:]]*//')

    # Build a stable hash from the raw task text
    hash=$(echo "$raw_task" | md5sum | cut -d' ' -f1 | cut -c1-12)

    # Already dispatched?
    if grep -q "^$hash " "$DISPATCHED_FILE" 2>/dev/null; then
      echo "SKIP (dispatched): $task"
      continue
    fi

    # Blocked (needs prod/external access)?
    if is_blocked "$raw_task"; then
      echo "SKIP (blocked — needs external access): $task"
      continue
    fi

    # Build section context
    section="$current_h2"
    [[ -n "$current_h3" ]] && section="$section > $current_h3"

    # Build the agent prompt
    prompt="You are working on the polemicyst.com repository.

Read TODO.md for full project context. Your task is the following unchecked item:

Section: $section
Item: $raw_task

Instructions:
1. Create a new branch from develop: git checkout develop && git pull origin develop && git checkout -b feature/todo-${hash}
2. Implement the change described above.
3. Ensure the code passes lint (npm run lint) and build (npx next build) before committing.
4. Do NOT modify TODO.md — the dispatcher will handle tracking.
5. Commit your changes with a descriptive message and push the branch.
6. Create a PR targeting develop with a clear title and description."

    if [[ "$DRY_RUN" == "true" ]]; then
      echo "DRY RUN — would launch agent for:"
      echo "  Section: $section"
      echo "  Task:    $raw_task"
      echo "  Hash:    $hash"
      echo ""
    else
      response=$(curl -sf -X POST "https://api.cursor.com/v0/agents" \
        -H "Authorization: Bearer $CURSOR_API_KEY" \
        -H "Content-Type: application/json" \
        -d "$(jq -n \
          --arg prompt "$prompt" \
          --arg repo "$REPO" \
          --arg ref "$SOURCE_BRANCH" \
          '{
            prompt: { text: $prompt },
            source: { repository: $repo, ref: $ref }
          }')" 2>&1) || {
        echo "ERROR: API call failed for: $task"
        echo "  Response: $response"
        continue
      }

      agent_id=$(echo "$response" | jq -r '.id // "unknown"')
      timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
      echo "$hash $agent_id $timestamp $raw_task" >> "$DISPATCHED_FILE"
      echo "LAUNCHED agent $agent_id: $task"
    fi

    launched=$((launched + 1))
    if [[ "$MAX_AGENTS" -gt 0 && "$launched" -ge "$MAX_AGENTS" ]]; then
      echo "Reached max agent limit ($MAX_AGENTS). Stopping."
      break
    fi
  fi
done < "$TODO_FILE"

echo ""
echo "Done. Launched $launched agent(s)."
