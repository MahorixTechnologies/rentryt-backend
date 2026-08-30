#!/bin/sh
set -e

echo "Running Prisma migrations..."
npx prisma migrate deploy

echo "Seeding database (idempotent)..."
npx prisma db seed || true

echo "Starting Nest.js server..."
exec node dist/src/main
