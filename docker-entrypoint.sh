#!/bin/sh
set -e

echo "Running database schema sync..."
npx prisma db push --accept-data-loss --skip-generate

echo "Starting server..."
exec node server.js
