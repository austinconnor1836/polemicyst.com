#!/bin/bash
set -e

if [ "$ENVIRONMENT" = "dev" ]; then
  echo "Starting api in development mode..."
  npm install
  npx prisma generate --schema=./prisma/schema.prisma
  exec npm run dev
else
  echo "Starting api in production mode..."
  node dist/index.js
fi