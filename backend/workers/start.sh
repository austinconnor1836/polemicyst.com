#!/bin/bash
set -e

echo "📜 Running Prisma Migrate Deploy..."
npx prisma migrate deploy

echo "🚀 Starting Poller..."
node runPollFeeds.js
