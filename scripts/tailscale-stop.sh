#!/bin/bash
# Stop the standalone Tailscale daemon.
# Usage: sudo bash scripts/tailscale-stop.sh

set -euo pipefail

TAILSCALE="/opt/homebrew/bin/tailscale"
SOCKET="/tmp/tailscaled.sock"

# Turn off tailscale serve
$TAILSCALE --socket="$SOCKET" serve reset 2>/dev/null || true

# Disconnect
$TAILSCALE --socket="$SOCKET" down 2>/dev/null || true

# Kill the daemon
pkill -f "tailscaled.*socket=$SOCKET" 2>/dev/null || true

# Clean up socket
rm -f "$SOCKET"

echo "Tailscale stopped."
