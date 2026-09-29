#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# Run the Intently demo — the ONE canonical setup.
#
#   bash intently/scripts/run-demo.sh        (from the repo root or intently/)
#
# Topology (the only supported shape — see wiki/concepts/deployment-topology):
#   Medusa (Docker, pim/)                       :9000  products + cart + catalogue (the PIM)
#   Storefront (storefront/)                    :8000  THE STORE — browse / filter / cart (entry point)
#   Intently (intently/, basePath /discovery)   :3017  the discovery plugin, proxied at :8000/discovery
#
#     →  http://localhost:8000                    the store
#     →  http://localhost:8000/discovery          Shop by situation (tiered-AI discovery)
#     →  http://localhost:3017/discovery/admin    the Studio (catalogue mgmt · situation tuner · vision)
#
# TIERED AI is ON: free text → DeepSeek comprehension → the deterministic engine
# (which DECIDES everything) → DeepSeek re-voices the prose, behind a
# deterministic faithfulness gate (template fallback). Needs DEEPSEEK_API_KEY in
# your environment — this script warns if it is missing; without it discovery
# silently runs the deterministic fallback (the "I can't see the tiered AI" symptom).
#
# Discovery runs over the VISION catalogue (real photos + attributes read from
# them) while products map to the MEDUSA catalogue for the shared cart — the
# enrichment bridge matches the two by article number (src/lib/discovery/retrieve.ts).
#
# This script is self-wiring: it pulls the Medusa publishable key straight from
# the running stack and writes storefront/.env.local + passes it to the plugin,
# so there is no manual copy step. Every run rebuilds against the LATEST source
# (deps refresh + .next clear + vector re-seed) and frees any stale :8000/:3017.
#
# Only prereq: Docker Desktop must be RUNNING (this waits for it, can't start the GUI daemon).
# ─────────────────────────────────────────────────────────────────
#
# Note: NO `set -e`. This orchestrator has several best-effort steps (key
# lookup, port cleanup, vector seed) whose non-zero exit is expected and must
# NOT abort the run. Must-succeed steps fail loudly + explicitly below.
set -uo pipefail
HERE="$(cd "$(dirname "$0")/../.." && pwd)"   # repo root (parent of intently/)
PIM="$HERE/pim"; STORE="$HERE/storefront"; APP="$HERE/intently"
MEDUSA_URL="http://localhost:9000"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# Upsert KEY=VALUE in an env file (replace the line if present, else append).
upsert_env() {
  local f=$1 k=$2 v=$3
  if grep -qE "^${k}=" "$f" 2>/dev/null; then
    sed -i.bak -E "s|^${k}=.*|${k}=${v}|" "$f" && rm -f "$f.bak"
  else
    printf '%s=%s\n' "$k" "$v" >> "$f"
  fi
}

# Free a TCP port by killing whatever is LISTENing on it (stale demo servers).
free_port() {
  local pids; pids=$(lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then echo "  freeing :$1 (was pid ${pids//$'\n'/ })"; kill $pids 2>/dev/null || true; sleep 1; fi
}

# 0 — Tiered-AI key preflight (warn, don't block — the deterministic path works).
if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
  say "⚠  DEEPSEEK_API_KEY is not set — the tiered-AI conversation will fall back to"
  echo "   the deterministic engine (templated prose). Export it (e.g. in ~/.zshenv)"
  echo "   to demo the LLM comprehension + re-voicing."
fi

# 1 — Docker daemon (must succeed)
if ! docker info >/dev/null 2>&1; then
  say "Docker isn't running. Start Docker Desktop, then re-run this script."
  echo "  (macOS: open -a Docker  — wait for the whale icon to settle)"
  exit 1
fi

# 2 — Medusa stack (postgres + redis + medusa). First boot builds + seeds; slow.
say "Bringing up Medusa (pim/) — first boot builds the image + seeds the catalogue (can take a few minutes)…"
( cd "$PIM" && docker compose up -d --build ) || { say "Medusa failed to start. See: cd pim && docker compose logs"; exit 1; }
echo "Waiting for Medusa on :9000…"
until curl -sf -o /dev/null "$MEDUSA_URL/health" 2>/dev/null; do sleep 3; done
echo "  ✓ Medusa up"

# 3 — Resolve the Medusa publishable key (the storefront + the plugin both need
# it). Robust + validated: query Postgres directly (survives log rotation), then
# the container logs (printed on first seed), then any real key already in
# storefront/.env.local. Each candidate is verified against the Store API.
pk_valid() { [ -n "$1" ] && curl -sf "$MEDUSA_URL/store/products?limit=1" -H "x-publishable-api-key: $1" >/dev/null 2>&1; }
PK=""
for cand in \
  "$(cd "$PIM" && docker compose exec -T postgres psql -U postgres -d intently_pim -t -A -c "select token from api_key where type='publishable' order by created_at limit 1;" 2>/dev/null | tr -d '[:space:]')" \
  "$(cd "$PIM" && docker compose logs medusa 2>&1 | grep -oE 'pk_[A-Za-z0-9]{32,}' | tail -1)" \
  "$(grep -E '^NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_' "$STORE/.env.local" 2>/dev/null | head -1 | cut -d= -f2-)" ; do
  if pk_valid "$cand"; then PK="$cand"; break; fi
done
if [ -n "$PK" ]; then
  echo "  ✓ publishable key resolved (${PK:0:12}…) and verified against the Store API"
else
  say "⚠  Couldn't resolve a working Medusa publishable key automatically."
  echo "   Open $MEDUSA_URL/app → Settings → Publishable API keys, copy the pk_… , and set"
  echo "   NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY in storefront/.env.local. (Continuing; the store"
  echo "   product pages + discovery-over-Medusa will be empty until it's set.)"
fi

# 4 — Wire the key into storefront/.env.local (create from template if missing).
[ -f "$STORE/.env.local" ] || { [ -f "$STORE/.env.template" ] && cp "$STORE/.env.template" "$STORE/.env.local"; }
if [ -f "$STORE/.env.local" ]; then
  upsert_env "$STORE/.env.local" MEDUSA_BACKEND_URL "$MEDUSA_URL"
  [ -n "$PK" ] && upsert_env "$STORE/.env.local" NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY "$PK"
fi

# 5 — Build the LATEST: refresh deps, clear stale Next caches, reset the vector store.
say "Refreshing dependencies + clearing build caches (so you run the latest source)…"
( cd "$STORE" && npm install --no-audit --no-fund ) || { say "storefront npm install failed"; exit 1; }
( cd "$APP"   && npm install --no-audit --no-fund ) || { say "intently npm install failed"; exit 1; }
rm -rf "$STORE/.next" "$APP/.next"
rm -f "$APP/.enrichment/vectors.json"   # re-seed from the current catalogue (lazy seed skips a non-empty store)

# 6 — Free any stale demo servers from a previous run (these cause the
# "discovery is still scripted / admin not up" symptom — a zombie on :8000).
say "Clearing any previous demo servers on :8000 / :3017…"
free_port 8000
free_port 3017
rm -f /tmp/intently-storefront.pid /tmp/intently-plugin.pid

# 7 — Storefront (:8000) + Intently plugin (:3017, basePath /discovery), tiered AI ON.
#   PIM_SOURCE=medusa            — vector candidates map to real storefront products → one shared cart
#   MEDUSA_PUBLISHABLE_KEY       — the plugin's enrichment sync reads the Medusa Store API
#   NEXT_PUBLIC_CATALOG=vision   — discovery reasons + renders over the rich vision attributes
#   DISCOVERY_PARSER/GENERATION  — DeepSeek comprehension + re-voicing (engine still decides everything)
say "Starting the store (:8000) and Intently discovery (:3017 under /discovery)…"
( cd "$STORE" && npm run dev >/tmp/intently-storefront.log 2>&1 & echo $! >/tmp/intently-storefront.pid )
( cd "$APP" && \
    DISCOVERY_RETRIEVAL=vector DISCOVERY_SITUATION=on \
    DISCOVERY_PARSER=deepseek DISCOVERY_GENERATION=deepseek \
    PIM_SOURCE=medusa NEXT_PUBLIC_CATALOG=vision NEXT_PUBLIC_BASE_PATH=/discovery \
    MEDUSA_BACKEND_URL="$MEDUSA_URL" MEDUSA_PUBLISHABLE_KEY="$PK" \
    npm run dev -- -p 3017 >/tmp/intently-plugin.log 2>&1 & echo $! >/tmp/intently-plugin.pid )

echo "Waiting for the storefront on :8000…"
until curl -sf -o /dev/null "http://localhost:8000" 2>/dev/null; do sleep 2; done
echo "Waiting for the Intently plugin on :3017…"
until curl -sf -o /dev/null "http://localhost:3017/discovery" 2>/dev/null; do sleep 2; done

# Seed the vector store over the Medusa catalogue (Xenova, local, no key, ~3s).
# Enrichment routes live under the basePath. On failure discovery falls back to
# the deterministic engine, so the demo never dead-ends.
echo "Embedding the catalogue for semantic search…"
if curl -sf -X POST "http://localhost:3017/discovery/api/enrichment/sync" --max-time 180 >/dev/null 2>&1; then
  echo "  ✓ catalogue embedded"
else
  echo "  (sync skipped/failed — discovery falls back to deterministic retrieval; see /tmp/intently-plugin.log)"
fi

cat <<URLS

  ✦ Intently demo ready — one store, tiered-AI discovery bolted in.

    THE STORE (browse / filter / cart):
      http://localhost:8000

    SHOP BY SITUATION (Intently discovery — tiered AI):
      http://localhost:8000/discovery        ← also in the storefront nav as "Shop by situation ✨"

    THE STUDIO (catalogue mgmt · situation tuner · vision · the PM action loop):
      http://localhost:3017/discovery/admin

  Add to cart from a discovery card → it lands in the SAME storefront cart (shared cookie).
  Try a messy brief to see the tiered AI:
    "something for a rainy festival weekend, I hate florals"  ·  "a black dress for a party, might get cold"

  Servers run in the background. Logs: /tmp/intently-storefront.log · /tmp/intently-plugin.log
  Stop: kill \$(cat /tmp/intently-storefront.pid /tmp/intently-plugin.pid) ; (cd "$PIM" && docker compose down)
URLS
