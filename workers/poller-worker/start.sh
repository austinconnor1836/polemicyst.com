#!/bin/bash
set -e

if [ "$ENVIRONMENT" = "dev" ]; then
  echo "Starting in development mode..."
  npm install
  npx prisma generate --schema=./prisma/schema.prisma
  npx prisma migrate deploy --schema=prisma/schema.prisma
  exec npm run dev
else
  echo "Starting in production mode..."
  exec node dist/index.js
fi