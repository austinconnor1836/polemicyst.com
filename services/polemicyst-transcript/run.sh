#!/usr/bin/env bash
# Start the local Clipfire transcript service on 127.0.0.1:8791.
# Usage: ./run.sh            (open, no secret)
#        RENDER_SECRET=xyz ./run.sh   (require x-render-secret header)
set -euo pipefail
cd "$(dirname "$0")"
exec python3 server.py
