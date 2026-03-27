#!/bin/sh

# Force Next.js to bind to all interfaces. ECS Fargate sets HOSTNAME to the
# container task ID at runtime (overriding the Dockerfile ENV), which causes
# Next.js standalone server.js to bind to an unreachable address.
export HOSTNAME="0.0.0.0"

echo "Running database migrations..."
if npx prisma migrate deploy; then
  echo "Migrations completed successfully."
else
  echo "WARNING: Migration failed (exit code $?). Starting server anyway."
fi

echo "Starting server..."
exec node server.js
