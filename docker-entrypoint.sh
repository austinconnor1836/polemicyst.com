#!/bin/sh
set -e

echo "Running database schema sync..."
node node_modules/prisma/build/index.js db push --accept-data-loss --skip-generate

echo "Starting server..."
exec node server.js
