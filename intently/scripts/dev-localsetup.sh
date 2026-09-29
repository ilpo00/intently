#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# Intently · dev:localsetup
#
# Boots `next dev` on http://localhost:3017 with:
#   * NEXT_PUBLIC_DATA_MODE=supabase       (live Supabase, real RLS)
#   * NEXT_PUBLIC_AI_MODE=tiered           (DeepSeek + Claude guardrail)
#   * keys loaded from ~/.zshenv           (defensive — usually already
#                                           in process.env if started
#                                           from zsh; we source again
#                                           for non-zsh launchers)
#
# This is the "I want to run Intently on my laptop the way it was meant to
# run" entry point. CI uses scripted mode + local data; this script
# does the opposite — everything live, nothing stubbed.
#
# Required env vars (the script aborts with a pointed error if any
# are missing after sourcing .zshenv):
#   DEEPSEEK_API_KEY
#   NEXT_PUBLIC_SUPABASE_URL
#   NEXT_PUBLIC_SUPABASE_ANON_KEY
#   SUPABASE_SERVICE_ROLE_KEY
#
# Optional (warns but proceeds):
#   ANTHROPIC_API_KEY   — enables Tier 3 (Haiku) + Tier 4 (Sonnet)
#                          guardrail. Without it the tiered path runs
#                          DeepSeek + deterministic validator only.
#
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

# ── colors ──────────────────────────────────────────────────────
if [ -t 1 ]; then
  GREEN=$'\033[0;32m'
  YELLOW=$'\033[0;33m'
  RED=$'\033[0;31m'
  DIM=$'\033[2m'
  RESET=$'\033[0m'
else
  GREEN=""; YELLOW=""; RED=""; DIM=""; RESET=""
fi

note()  { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn()  { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
fail()  { printf '%s✗%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }
header() { printf '\n%s── %s ──%s\n' "$DIM" "$*" "$RESET"; }

# ── 1. cwd check ────────────────────────────────────────────────
# Must be run from intently/ — next dev resolves config relative to cwd.
if [ ! -f "package.json" ] || ! grep -q '"name": "intently"' package.json; then
  fail "Run this from the intently/ directory (got $(pwd))."
fi

header "Loading environment"

# ── 2. source ~/.zshenv defensively ─────────────────────────────
# If the user started this from zsh, .zshenv already ran and the vars
# are in process.env. If they started from bash or a non-login shell,
# sourcing here pulls them in. `set -a` auto-exports anything defined
# during the source; `|| true` lets us survive non-bash syntax in the
# user's .zshenv without aborting the whole script.
if [ -f "$HOME/.zshenv" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$HOME/.zshenv" 2>/dev/null || true
  set +a
  note "sourced ~/.zshenv"
else
  warn "no ~/.zshenv found — relying on existing process.env"
fi

# ── 3. project .env.local as a secondary source ─────────────────
# Existing pattern: scripts/check-service-role.mjs uses dotenv to
# pick up project-scoped keys from .env.local. Mirror that here.
# Shell env wins (we only fill in missing values), matching dotenv's
# default `override: false` behavior.
if [ -f ".env.local" ]; then
  while IFS='=' read -r raw_key raw_val; do
    # skip blanks and comments
    case "$raw_key" in ''|'#'*) continue ;; esac
    key="${raw_key// /}"
    # only fill if the var isn't already set in env
    if [ -z "${!key:-}" ]; then
      # strip surrounding single/double quotes if present
      val="${raw_val%\"}"; val="${val#\"}"
      val="${val%\'}"; val="${val#\'}"
      export "$key=$val"
    fi
  done < <(grep -E '^[A-Z_][A-Z0-9_]*=' .env.local || true)
  note "filled gaps from .env.local"
fi

# ── 4. assert required ──────────────────────────────────────────
header "Verifying credentials"

missing=()
for v in \
  DEEPSEEK_API_KEY \
  NEXT_PUBLIC_SUPABASE_URL \
  NEXT_PUBLIC_SUPABASE_ANON_KEY \
  SUPABASE_SERVICE_ROLE_KEY; do
  if [ -z "${!v:-}" ]; then
    missing+=("$v")
  fi
done

if [ "${#missing[@]}" -gt 0 ]; then
  printf '\n%sMissing required env vars:%s\n' "$RED" "$RESET"
  for v in "${missing[@]}"; do printf '  · %s\n' "$v"; done
  cat <<EOF

Fix one of:
  1. Add the missing var(s) to ~/.zshenv (recommended for keys you
     reuse across projects), e.g.
       export DEEPSEEK_API_KEY="sk-..."
     then open a new terminal or run \`source ~/.zshenv\`.

  2. Add them to intently/.env.local for project-scoped keys.

The defaults in intently/.env.example document what each one does.
EOF
  exit 1
fi
note "all required env vars present"

# Optional — warn but proceed.
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  warn "ANTHROPIC_API_KEY unset — Tier 3 (Haiku) + Tier 4 (Sonnet) will be skipped"
else
  note "ANTHROPIC_API_KEY present — full tiered stack available"
fi

# ── 5. force the runtime modes ──────────────────────────────────
# These are the entire point of this script — make sure they're
# right regardless of what .env.local or shell env says.
export NEXT_PUBLIC_DATA_MODE=supabase
export NEXT_PUBLIC_AI_MODE=tiered

header "Runtime config"
printf '  %s\n' "NEXT_PUBLIC_DATA_MODE=supabase"
printf '  %s\n' "NEXT_PUBLIC_AI_MODE=tiered"
printf '  %s\n' "supabase: ${NEXT_PUBLIC_SUPABASE_URL}"
printf '  %s\n' "admin gate: ${ADMIN_AUTH_ENABLED:-(unset — gate bypassed for dev)}"

# ── 6. quick service-role sanity check (non-fatal) ──────────────
# scripts/check-service-role.mjs is the dedicated diagnostic. If it's
# present, run it — saves the user a separate "what broke" round-trip
# when the service-role key is set but wrong.
if [ -f "scripts/check-service-role.mjs" ]; then
  header "Service-role sanity"
  if node scripts/check-service-role.mjs >/dev/null 2>&1; then
    note "service-role connection healthy"
  else
    warn "service-role check failed — admin/analytics pages may 500"
    warn "  run \`npm run check:service-role\` for the diagnostic detail"
  fi
fi

# ── 7. launch ────────────────────────────────────────────────────
header "Launching next dev on http://localhost:3017"
exec npx next dev -p 3017
