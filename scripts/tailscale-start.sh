#!/bin/bash
# Start the standalone Tailscale daemon (not the sandboxed GUI).
# Usage: sudo bash scripts/tailscale-start.sh

set -euo pipefail

TAILSCALE="/opt/homebrew/bin/tailscale"
TAILSCALED="/opt/homebrew/bin/tailscaled"
SOCKET="/tmp/tailscaled.sock"
STATE="/tmp/tailscaled.state"
STATEDIR="/var/lib/tailscale"

# Kill any existing standalone daemon and clean up stale socket
pkill -f "tailscaled.*socket=$SOCKET" 2>/dev/null || true
sleep 1
rm -f "$SOCKET"

# Start daemon in background
echo "Starting tailscaled..."
mkdir -p "$STATEDIR"
$TAILSCALED --state="$STATE" --socket="$SOCKET" --statedir="$STATEDIR" &
DAEMON_PID=$!
sleep 2

# Connect with SSH enabled
echo "Connecting to Tailscale network..."
$TAILSCALE --socket="$SOCKET" up --ssh --accept-routes

echo ""
echo "=== Tailscale is running ==="
$TAILSCALE --socket="$SOCKET" status
echo ""

# Expose dev server (port 3000) over Tailscale
# Next.js uses --experimental-https (self-signed), so use https+insecure://
echo "Exposing localhost:3000 via Tailscale serve..."
$TAILSCALE --socket="$SOCKET" serve --bg https+insecure://localhost:3000
sleep 1

TAILSCALE_HOSTNAME=$($TAILSCALE --socket="$SOCKET" status --json 2>/dev/null | grep -o '"DNSName":"[^"]*"' | head -1 | sed 's/"DNSName":"//;s/\.$//' | sed 's/"$//')
SERVE_URL="https://${TAILSCALE_HOSTNAME}"

echo ""
echo "Daemon PID: $DAEMON_PID"
echo "Socket: $SOCKET"
echo "SSH: enabled (Termius connects without key)"
echo "Dev server: $SERVE_URL → https://127.0.0.1:3000 (insecure)"
echo ""
echo "To stop: sudo bash scripts/tailscale-stop.sh"
