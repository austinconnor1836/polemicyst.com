#!/bin/bash
# Start the standalone Tailscale daemon (not the sandboxed GUI).
# Usage: sudo bash scripts/tailscale-start.sh

set -euo pipefail

TAILSCALE="/opt/homebrew/bin/tailscale"
TAILSCALED="/opt/homebrew/bin/tailscaled"
SOCKET="/tmp/tailscaled.sock"
STATE="/tmp/tailscaled.state"

# Kill any existing standalone daemon
pkill -f "tailscaled.*socket=$SOCKET" 2>/dev/null || true
sleep 1

# Start daemon in background
echo "Starting tailscaled..."
$TAILSCALED --state="$STATE" --socket="$SOCKET" &
DAEMON_PID=$!
sleep 2

# Connect with SSH enabled
echo "Connecting to Tailscale network..."
$TAILSCALE --socket="$SOCKET" up --ssh --accept-routes

echo ""
echo "=== Tailscale is running ==="
$TAILSCALE --socket="$SOCKET" status
echo ""
echo "Daemon PID: $DAEMON_PID"
echo "Socket: $SOCKET"
echo "SSH: enabled (Termius connects without key)"
echo ""
echo "To stop: sudo kill $DAEMON_PID"
