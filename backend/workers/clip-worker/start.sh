#!/bin/bash
set -e

if [ "$ENVIRONMENT" = "dev" ]; then
  echo "Starting Clip Worker in development mode..."
  exec npm run dev
else
  echo "Starting Clip Worker in production mode..."
  exec node dist/index.js
fi