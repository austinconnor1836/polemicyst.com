#!/bin/bash
set -e

if [ "$ENVIRONMENT" = "dev" ]; then
  echo "Starting in development mode..."
  exec npm run dev
else
  echo "Starting in production mode..."
  exec node dist/index.js
fi