# MISE → Intently Migration

> Status: **complete**. The last deferred item — deleting the parked
> application-code tree at `src/_parked/` — was done on 2026-06-15 (see
> [§7](#7-done-delete-the-parked-code-tree)).
> Last updated: 2026-06-15.

This document records the pivot of the project from **MISE** (a Japanese-kitchen
commerce river) to **Intently** (contextual fashion / outdoor discovery), so any
future session has the full picture without re-deriving it.

The pivot is both a **rebrand** (every `mise` identifier → `intently`) and a
**scope change** (cooking-specific data models removed, fashion/outdoor +
vector-enrichment models added).

---

## 1. Folder + repo

| Before | After |
|---|---|
| `mise/` (Next.js app subdir) | `intently/` |
| `ilmariv/mise` (origin) | `ilmari.m.vuorenmaa-group/intently` on GitLab |

- Renamed with `git mv` so history follows.
- CI (`.github/workflows/ci.yml` + `.gitlab-ci.yml`) `working-directory` and
  cache paths updated to `intently/`.
- The new GitLab project was created fresh (not a true fork), so its `main` had
  unrelated history (empty initial commit + GitLab SAST/Secret-Detection
  scaffolding). Merged with `--allow-unrelated-histories`; the `.gitlab-ci.yml`
  add/add conflict was resolved by **combining** our typecheck/lint/test/build
  matrix with GitLab's security templates.

---

## 2. Code identifiers renamed

| Kind | Before | After |
|---|---|---|
| Store file | `src/store/mise-store.ts` | `src/store/intently-store.ts` |
| Store hook | `useMiseStore` | `useIntentlyStore` |
| Store type | `MiseStore` | `IntentlyStore` |
| Tailwind palette | `mise.{cream,paper,cloud,stone,pebble,slate,ink,moss}` | `intently.*` (same shades) |
| Tailwind classes | `bg-mise-paper`, `text-mise-ink`, … (929 uses) | `bg-intently-paper`, … |
| localStorage keys | `mise.{kitchen,orders,taste,chat,rec-events,profile,migrated}.v1` | `intently.*.v1` |
| Session/hint keys | `mise_hint_seen`, `mise_intent_sessions`, `mise_recipe_events`, `mise_saved_setup` | `intently_*` |
| `AcquiredFrom` enum value | `'mise'` | `'intently'` (incl. SQL `default` in `0001`) |
| Codename in prose | `MISE` / `Mise` (comments, titles, `<title>`, wordmarks, email placeholder) | `Intently` |
| Wiki entity page | `wiki/entities/mise-store.md` | `wiki/entities/intently-store.md` |

**localStorage caveat:** renaming the keys means any existing browser data under
`mise.*` is orphaned (not migrated). Acceptable for a prototype with no real
users; noted here so nobody is surprised by a "lost cart" in an old browser tab.

---

## 3. Deliberately NOT renamed (exemptions)

These contain the string `mise` but are **intentionally left alone** — do not
"fix" them in a future cleanup:

- **`.mise.toml`** (repo root) — config for the [`mise`](https://mise.jdx.dev)
  version-manager tool. Unrelated to the product. Pins Node version.
- **`~/.claude/skills/mise-*`** — user-global Claude skills (`mise-motion-polish`,
  `mise-preview-plan`, `mise-tiered-ai`). Out of repo scope; renaming is the
  user's call, not the codebase's.
- **`wiki/log.md`** — chronological history. Rewriting old entries to say
  "intently" would falsify the record. Left as-is.
- **Console-log prefixes** like `[intently-store]` were updated; any remaining
  `mise` in third-party `node_modules` is obviously untouched.

---

## 4. Database scope change (Supabase)

New Supabase project: **`<supabase-project-ref>`** (the MISE-era project
`lgnkjmcetgkmmcuglfyc` is retired — its keys are kept in `~/.zshenv` under a
`_MISE` suffix for archaeology only).

Migrations `0001`–`0011` applied via `supabase db push`. Scope changes:

- **`0010_enrichment_vectors.sql`** — NEW. pgvector extension, `product_vectors`
  table (`vector(384)`), HNSW cosine index, GIN metadata index, RLS, and the
  `enrichment_search(query, k, min_score)` RPC. (See
  [enrichment-layer.md](enrichment-layer.md).)
  - **Gotcha fixed:** pgvector lives in the `extensions` schema (Supabase best
    practice). SQL-language function bodies resolve operators at CREATE time
    against a `search_path` that excludes `extensions`, so a bare `<=>` failed
    with `42883 operator does not exist`. Fix: schema-qualify as
    `operator(extensions.<=>)`.
- **`0011_drop_recipes_library.sql`** — NEW. Drops the MISE-era `recipes` and
  `library_items` tables (CASCADE), their index/policies, and rewrites the
  `order_items.fulfillment` CHECK to drop the dead `'digital-recipe'` value.
- **`0001`, `0002`, `0005`** — edited to remove the `recipes` + `library_items`
  CREATE/RLS statements so **fresh** setups never create them. (These edits do
  NOT re-run on already-migrated projects — `0011` is what cleans those up.)

Verified live via REST: `recipes`/`library_items` → 404, `product_vectors` +
`enrichment_search` → 200.

---

## 5. Environment + secrets

- Per-project keys in `~/.zshenv` use a project suffix to avoid collisions:
  `NEXT_PUBLIC_SUPABASE_URL_INTENTLY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY_INTENTLY`,
  `SUPABASE_SERVICE_ROLE_KEY_INTENTLY` (old project under `_MISE`).
- `intently/.env.local` (gitignored) remaps the unsuffixed names the app reads
  via dotenv `$VAR` expansion, e.g.
  `NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL_INTENTLY`.
  - **Gotcha:** shell-exported env wins over `.env.local`. The old unsuffixed
    `NEXT_PUBLIC_SUPABASE_*` had to be suffixed (`_MISE`) in `~/.zshenv` so the
    `.env.local` remap actually takes effect.
- AI keys (`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`) live unsuffixed in
  `~/.zshenv`; both verified authenticating (HTTP 200 from `/v1/models`).
- Supabase MCP server wired in `.mcp.json` (project-scoped). Requires
  `claude /mcp` → authenticate in a fresh session to use its tools.

---

## 6. New surface added during the pivot

Not strictly "migration", but landed on the same branch and worth noting:

- **Enrichment layer** — semantic search bridging a PIM (Medusa) and the
  discovery layer. `src/lib/enrichment/*`, `/api/enrichment/*`,
  `/admin/enrichment`, Xenova `all-MiniLM-L6-v2` embedder, local-JSON +
  Supabase-pgvector vector stores. Full detail in
  [enrichment-layer.md](enrichment-layer.md).
- **Medusa PIM** — `pim/` sibling dir (Medusa v2 starter + `seed-kaggle.ts`,
  10 curated Kaggle fashion products).

---

## 7. DONE: delete the parked code tree

**Completed 2026-06-15.** `src/_parked/` was deleted in full (193 files, all
top-level areas including the "revive later" candidates below). The verification
gate ran green — a no-op to typecheck/lint/test/build, exactly as predicted. The
tree remains in git history at the prior commit if anything is ever worth
reviving. The rest of this section is kept as the record of *what* was parked
and *why* it was inert.

Since this doc was first written the deferred code was **moved wholesale** out
of the live tree into `src/_parked/`, rather than being surgically de-recipe'd
in place. As of 2026-05-31 the live `src/` tree is already clean — it carries
only the enrichment + discovery + catalogue surface, the slimmed river
sections, and the Zustand store (verified recipe/library-free; the only
`recipe`/`library` strings left in live `src/` are historical comments, the
`@testing-library` import, and stray UI copy). So the remaining work is now
**deleting (or selectively reviving) `src/_parked/`**, not extracting bits out
of shared live files.

### What's parked, and why it's inert

`src/_parked/` holds **182 files** — the whole MISE-era application surface the
Intently pivot set aside: the chat/AI orchestrator (`lib/ai/*`,
`app/api/chat/*`), the account + auth layers (`lib/account/*`, `lib/auth/*`,
`app/auth/*`, `app/account/*`), the admin panel
(`app/admin/{analytics,campaigns,pim,users}/*`, `lib/admin/*`),
recommendations / chips / sessions / campaigns code, the dual-stream +
taste-grid + recipe river sections, and **54 parked test files** under
`src/_parked/tests/`. Recipe/library (`lib/recipes.ts` + 12 recipe JSONs,
`RecipeList`/`RecipeCard`, the store's old library slice) was the original
trigger for this section; the parking ended up much broader.

The tree is **dead weight, not a live bug** — and it is now unreachable:

- It lives **outside `src/app/`**, so Next's App Router never routes, bundles,
  or builds any of it.
- Jest's `testMatch` is `src/tests/**` only, so the 54 specs under
  `src/_parked/tests/**` never run.
- Nothing in the live `src/` tree imports from `_parked/`.

So **CI is green and the app builds and runs** with the tree present — it is
isolated cruft awaiting a decision, no longer tangled into live code.

### Why still deferred
182 files is a lot to triage, and not all of it is necessarily trash. The
recipe/library data is scope-inappropriate (its DB tables were already dropped
in §4) and safe to delete, but other areas — the tiered-AI orchestrator, the
account/auth layer, the admin analytics — may be worth reviving rather than
deleting once Intently's own chat/account story firms up. Sorting "delete
forever" from "revive later" is the work, and it wants a deliberate session.

### What was done (2026-06-15)
The whole tree was deleted rather than selectively revived — `git rm -r
src/_parked` (193 files), plus dropping the now-dead `src/_parked` exclude from
`tsconfig.json` and rewording the `admin-guard.ts` stub comment that pointed at
the deleted parked guard. Nothing was revived; if any of the "revive later"
areas above is ever wanted, restore it from git history (prior commit) and apply
the pre-park surgical concerns then (re-wire the store slice, drop the
`cite_recipe`/`recipeId` branches the live tree no longer has, etc.).

### Verification gate (ran green)
`npm run typecheck && npm run lint && npm test && npm run build` (the `NEXT_PUBLIC_AI_MODE=scripted` build flag was removed 2026-07-15 with scripted mode itself)
— all green, a no-op as predicted (typecheck ✓, lint ✓ 0 errors, test ✓
158 passed / 3 skipped, build ✓). No Preview pass was needed: no live rendered
surface changed.

---

## 8. Quick status board

| Area | State |
|---|---|
| Folder rename | ✅ done |
| Code identifiers (store/hook/tailwind/localStorage/enum) | ✅ done |
| Codename prose | ✅ done |
| Git remote + main pushed | ✅ done |
| Supabase project + migrations 0001–0011 | ✅ applied + verified |
| Env/secrets wiring (`_INTENTLY` suffix + `.env.local` remap) | ✅ done |
| AI keys (Anthropic + DeepSeek) | ✅ verified |
| Enrichment layer + Medusa PIM | ✅ shipped |
| **MISE-era application code** (recipe/library + chat/AI/account/admin) | ✅ **deleted** 2026-06-15 — `src/_parked/` removed in full (193 files); recoverable from git history (§7) |
| Enrichment end-to-end smoke test (live pgvector) | ⏳ not yet run (needs dev server) |
