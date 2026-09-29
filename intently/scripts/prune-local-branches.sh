#!/usr/bin/env bash
#
# Intently · prune-local-branches
#
# Cleans up local branches whose work is done — either their remote was
# deleted (merged + branch deleted on the host), or they're fully merged
# into the default branch locally. Run from anywhere inside the repo.
#
# Two pickup mechanisms, used in combination:
#
#   1. Upstream gone — `git branch -vv` shows "[gone]" for branches whose
#      remote-tracking ref was deleted. Common after merging via GitHub/
#      GitLab and ticking "delete branch on merge."
#
#   2. Fully merged into the default branch — `git branch --merged <main>`
#      lists branches whose tip is reachable from main. Covers locally-
#      merged branches that weren't tracked remotely (rare).
#
# Safety:
#   - Refuses to touch the currently-checked-out branch
#   - Never touches main / master / develop, even if listed as merged
#   - Uses `git branch -d` (safe — refuses if work would be lost),
#     not `-D`. To force, re-run with --force.
#   - Default mode is INTERACTIVE — lists candidates, asks before
#     deleting. Use --yes to skip the prompt.
#
# Compatible with bash 3.2 (macOS stock) — uses parallel arrays
# instead of `declare -A`.
#
# Usage:
#   ./scripts/prune-local-branches.sh             # interactive
#   ./scripts/prune-local-branches.sh -n          # dry-run, list only
#   ./scripts/prune-local-branches.sh -y          # skip confirm
#   ./scripts/prune-local-branches.sh --force     # use `git branch -D`
#
# Or via npm:
#   npm run prune:branches              # interactive — lists candidates, asks before deleting
#   npm run prune:branches -- -n        # dry run, list only
#   npm run prune:branches -- -y        # skip confirmation
#   npm run prune:branches -- --force   # use `git branch -D` (override unmerged check)

set -euo pipefail

# ── arg parsing ───────────────────────────────────────────────────
DRY_RUN=0
ASSUME_YES=0
FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--dry-run) DRY_RUN=1 ;;
    -y|--yes)     ASSUME_YES=1 ;;
    -f|--force)   FORCE=1 ;;
    -h|--help)
      sed -n '2,43p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown arg: $1 (use --help)" >&2
      exit 2
      ;;
  esac
  shift
done

# ── must be inside a git repo ─────────────────────────────────────
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "✗ Not inside a git repository." >&2
  exit 1
fi

# ── identify the default branch ───────────────────────────────────
default_branch() {
  local ref
  ref=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || true)
  if [[ -n "$ref" ]]; then
    echo "${ref#refs/remotes/origin/}"
    return
  fi
  if git show-ref --verify --quiet refs/heads/main; then
    echo "main"
    return
  fi
  if git show-ref --verify --quiet refs/heads/master; then
    echo "master"
    return
  fi
  echo "✗ Can't determine default branch (no origin/HEAD, no main, no master)." >&2
  exit 1
}

DEFAULT_BRANCH=$(default_branch)
CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")

# Protected names — never deleted, even if merged.
PROTECTED=("$DEFAULT_BRANCH" "main" "master" "develop")
[[ -n "$CURRENT_BRANCH" ]] && PROTECTED+=("$CURRENT_BRANCH")

is_protected() {
  local b="$1"
  local p
  for p in "${PROTECTED[@]}"; do
    [[ "$b" == "$p" ]] && return 0
  done
  return 1
}

# Parallel arrays (bash-3.2 compatible substitute for associative arrays):
#   BRANCHES[i] holds a branch name
#   REASONS[i]  holds the deletion reason at the same index
BRANCHES=()
REASONS=()

# in_branch_list <branch> — returns 0 if already a candidate.
in_branch_list() {
  local target="$1"
  local b
  # Use `${arr[@]:-}` to avoid "unbound variable" under `set -u` when empty.
  for b in "${BRANCHES[@]:-}"; do
    [[ "$b" == "$target" ]] && return 0
  done
  return 1
}

# upgrade_or_add <branch> <reason>
# Adds (branch, reason) if branch isn't a candidate yet. If it is and the
# new reason is "gone (...)" (stronger), upgrades the stored reason.
upgrade_or_add() {
  local branch="$1"
  local reason="$2"
  local i
  if in_branch_list "$branch"; then
    if [[ "$reason" == gone* ]]; then
      for i in "${!BRANCHES[@]}"; do
        if [[ "${BRANCHES[$i]}" == "$branch" ]]; then
          REASONS[$i]="$reason"
          return
        fi
      done
    fi
    return
  fi
  BRANCHES+=("$branch")
  REASONS+=("$reason")
}

# ── refresh remote state before reading [gone] ────────────────────
echo "→ git fetch --prune"
git fetch --prune --quiet

# ── collect candidates ────────────────────────────────────────────

# 1. Branches whose upstream is gone.
while IFS= read -r line; do
  branch=$(echo "$line" | awk '{print $1}')
  [[ -z "$branch" ]] && continue
  is_protected "$branch" && continue
  upgrade_or_add "$branch" "gone (upstream deleted)"
done < <(git branch -vv | sed 's/^\*//' | awk '/: gone\]/ {print $1}')

# 2. Branches fully merged into the default branch.
while IFS= read -r branch; do
  branch=$(echo "$branch" | sed 's/^\*//' | xargs)
  [[ -z "$branch" ]] && continue
  is_protected "$branch" && continue
  upgrade_or_add "$branch" "merged into $DEFAULT_BRANCH"
done < <(git branch --merged "$DEFAULT_BRANCH")

# ── nothing to do? ────────────────────────────────────────────────
if [[ ${#BRANCHES[@]} -eq 0 ]]; then
  echo "✓ Nothing to prune. Local branches are clean."
  exit 0
fi

# ── report ────────────────────────────────────────────────────────
echo ""
echo "Branches that look safe to delete:"
echo ""
for i in "${!BRANCHES[@]}"; do
  printf "  %-40s  %s\n" "${BRANCHES[$i]}" "${REASONS[$i]}"
done | sort
echo ""
echo "Current branch: ${CURRENT_BRANCH:-<detached>} (protected)"
echo "Default branch: $DEFAULT_BRANCH (protected)"
echo ""

if [[ $DRY_RUN -eq 1 ]]; then
  echo "Dry run — nothing deleted. Re-run without -n to delete."
  exit 0
fi

# ── confirm ───────────────────────────────────────────────────────
if [[ $ASSUME_YES -eq 0 ]]; then
  read -r -p "Delete these ${#BRANCHES[@]} branch(es)? [y/N] " ans
  case "$ans" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 0 ;;
  esac
fi

# ── delete ────────────────────────────────────────────────────────
DELETE_FLAG="-d"
[[ $FORCE -eq 1 ]] && DELETE_FLAG="-D"

failed=()
deleted=()
for i in "${!BRANCHES[@]}"; do
  branch="${BRANCHES[$i]}"
  if git branch "$DELETE_FLAG" "$branch" >/dev/null 2>&1; then
    deleted+=("$branch")
  else
    failed+=("$branch")
  fi
done

echo ""
[[ ${#deleted[@]} -gt 0 ]] && echo "✓ Deleted: ${deleted[*]}"
if [[ ${#failed[@]} -gt 0 ]]; then
  echo "✗ Failed (likely has unmerged work — use --force to override): ${failed[*]}"
  exit 1
fi
