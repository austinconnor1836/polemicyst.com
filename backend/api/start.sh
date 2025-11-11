#!/bin/bash
set -e

if [ "$ENVIRONMENT" = "dev" ]; then
  echo "Starting api in development mode..."
  exec npm run dev
else
  echo "Starting api in production mode..."
  node dist/index.js
fi