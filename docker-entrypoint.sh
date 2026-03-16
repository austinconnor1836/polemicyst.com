#!/bin/sh

echo "Running database migrations..."
if npx prisma migrate deploy; then
  echo "Migrations completed successfully."
else
  echo "WARNING: Migration failed (exit code $?). Starting server anyway."
fi

echo "Starting server..."
exec node server.js
