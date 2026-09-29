#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# Intently PIM · setup.sh
#
# One-shot bootstrapper for the Medusa v2 PIM. Idempotent — running
# it twice does no harm.
#
# Steps:
#   1. Verify Node 20+ and PostgreSQL are present.
#   2. Create the `intently_pim` database if missing.
#   3. Copy .env.template → .env when .env is missing.
#   4. npm install (if node_modules absent).
#   5. Run Medusa's framework migrations.
#   6. Seed 10 Kaggle products.
#   7. Print the admin URL.
#
# Run from the pim/ directory:
#
#   ./setup.sh
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# ── colours ──────────────────────────────────────────────────────
if [ -t 1 ]; then
  GREEN=$'\033[0;32m'
  YELLOW=$'\033[0;33m'
  RED=$'\033[0;31m'
  RESET=$'\033[0m'
else
  GREEN=""; YELLOW=""; RED=""; RESET=""
fi

say()  { printf "%s→%s %s\n" "$GREEN" "$RESET" "$1"; }
warn() { printf "%s!%s %s\n" "$YELLOW" "$RESET" "$1"; }
die()  { printf "%s×%s %s\n" "$RED" "$RESET" "$1" >&2; exit 1; }

# ── 1. Tooling check ─────────────────────────────────────────────
command -v node >/dev/null 2>&1 || die "node not found. Install Node 20+ first."
NODE_MAJOR=$(node -v | sed -E 's/^v([0-9]+).*/\1/')
[ "$NODE_MAJOR" -ge 20 ] || die "Node 20+ required (have $(node -v))."
say "node $(node -v)"

command -v psql >/dev/null 2>&1 || die "psql not found. On macOS: brew install postgresql@16 && brew services start postgresql@16"
say "psql $(psql --version | awk '{print $3}')"

command -v createdb >/dev/null 2>&1 || die "createdb not found (it ships with PostgreSQL — your install is incomplete)."

# Ensure Postgres is actually accepting connections.
if ! psql -h localhost -d postgres -c 'select 1' >/dev/null 2>&1; then
  die "Can't connect to PostgreSQL on localhost. Is it running? Try: brew services start postgresql@16"
fi

# ── 2. Database ──────────────────────────────────────────────────
DB_NAME=${INTENTLY_PIM_DB:-intently_pim}
if psql -h localhost -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
  say "database '$DB_NAME' exists"
else
  say "creating database '$DB_NAME'"
  createdb -h localhost "$DB_NAME"
fi

# ── 3. .env ─────────────────────────────────────────────────────
if [ ! -f .env ]; then
  if [ -f .env.template ]; then
    say "copying .env.template → .env"
    cp .env.template .env
    # Substitute DATABASE_URL with the local one we just confirmed.
    PG_USER=$(whoami)
    sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=postgres://$PG_USER@localhost:5432/$DB_NAME|" .env
    rm -f .env.bak
  else
    warn "no .env.template found; you'll need to create .env manually"
  fi
else
  say ".env already exists; leaving it alone"
fi

# ── 4. Dependencies ──────────────────────────────────────────────
if [ ! -d node_modules ]; then
  say "installing npm dependencies (this takes a couple of minutes)"
  npm install
else
  say "node_modules present; skipping install"
fi

# ── 5. Migrations ────────────────────────────────────────────────
say "running Medusa migrations"
npx medusa db:migrate

# ── 6. Seed ─────────────────────────────────────────────────────
say "seeding 10 Kaggle products"
npx medusa exec ./src/scripts/seed-kaggle.ts

# ── 7. Done ─────────────────────────────────────────────────────
say "done."
cat <<EOF

  Next:
    npm run dev

  Admin UI:   http://localhost:9000/app
  Store API:  http://localhost:9000/store/products

  Admin login (from .env):
    email:    \$ADMIN_EMAIL
    password: \$ADMIN_PASSWORD

EOF
