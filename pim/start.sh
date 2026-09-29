#!/usr/bin/env sh
# ─────────────────────────────────────────────────────────────────
# Container entrypoint: wait for Postgres → migrate → seed → run.
# Idempotent: migrations and the seed are safe to re-run.
# ─────────────────────────────────────────────────────────────────
set -e

echo "→ waiting for postgres at postgres:5432 ..."
until pg_isready -h postgres -U postgres >/dev/null 2>&1; do
  sleep 2
done
echo "→ postgres is ready"

echo "→ running Medusa migrations"
npx medusa db:migrate

echo "→ seeding products"
npx medusa exec ./src/scripts/seed-kaggle.ts || echo "! seed failed, continuing (inspect logs)"

echo "→ starting Medusa (develop)"
exec npx medusa develop
