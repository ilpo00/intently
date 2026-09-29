---
type: decision
status: stable
updated: 2026-05-25
sources: [claude-md]
tags: [pim, medusa, products, recipes, asset-management]
---

# PIM strategy — products in Medusa, recipes in Intently

> **Decided 2026-05-25: Option C — adopt Medusa for products; build a Intently recipe editor in parallel.** No Intently product editor will be built (Options A and B explicitly rejected). The read-only PIM viewer at `/admin/pim/*` carries product-editing visibility during the Medusa migration window; product edits happen via `src/lib/data.ts` commits until Medusa lands. Recipe editor is the next admin-panel build (recipes are Intently-zone forever — non-throwaway). See [[admin-zones]] for the zone partition this implements.

The triggering question: with the admin panel landing and the operator wanting to "see and edit each product attribute and picture," do we build a product editing UI in Intently, or commit to Medusa adoption as the proper fix?

The answer this page argues for: **split asset management by zone.** Products to Medusa (when adopted). Recipes in Intently forever. Build the read-only PIM viewer in Intently today regardless, because it's safe in all futures.

## Why this question matters now

Today's product workflow is "edit `src/lib/data.ts` and commit." That's friction-laden but workable for a single operator. The user has stated this no longer scales — they want a real PIM. That's exactly the trigger condition [[supabase-over-medusa]] documented for revisiting Medusa.

But Medusa adoption is not a weekend project. It's a multi-week migration with a sync layer to build. So we have a real timing problem: the editor pain is now, the proper fix is weeks out, and a tactical Intently editor is tempting but expensive to throw away.

## The three honest options

### Option A — Build a Intently product editor that writes to Supabase

**Mechanics.** Flip `getAllProducts()` to query the `public.products` mirror table at runtime. Build a `/admin/pim/products/[id]/edit` page that updates the row's `payload` jsonb. Add image upload (Supabase Storage). Cache the result so the AI orchestrator's catalog summary doesn't pay a DB hit per request.

**Cost.** ~5–10 days. Data-layer source-of-truth flip touches the orchestrator, the ranker, the recipe-tool resolver (`resolveRecipeTools`), the seed script, every test that imports from `src/lib/data.ts`, and the build pipeline (CI no longer has the catalog at build time).

**Wins.** Operator can edit products immediately. No Medusa dependency.

**Losses.** Every line of this work is throwaway the day Medusa lands. The source-of-truth flip is also non-trivially reversible — once the DB is canonical, going back means writing a "dump DB to TS" tool.

### Option B — Build a Intently product editor that round-trips to `src/lib/data.ts`

**Mechanics.** Editor writes the Supabase mirror AND uses a server action to rewrite `src/lib/data.ts` on disk. Operator commits the change. CI / build pipeline unchanged because the JSON-in-code stays canonical.

**Cost.** ~3–5 days. Plus operational complexity: race conditions on simultaneous edits, formatting drift, server-action file writes only work locally (Vercel's filesystem is read-only at runtime), so this is dev-only by design.

**Wins.** Source-of-truth doesn't flip. Edits land in version control immediately. Reversal cost is zero.

**Losses.** Localhost-only — not deployable. Brittle (formatting, ordering, comments in `data.ts` will get clobbered or preserved inconsistently). And: still throwaway when Medusa lands.

### Option C — Adopt Medusa for products; keep recipes in Intently

**Mechanics.**
1. Stand up Medusa locally (or hosted). Define the products schema mapping (Medusa's product → Intently's `Product`).
2. Import the 32-product catalogue into Medusa.
3. Build a sync layer: Medusa product webhook / poll → write into `public.products` mirror in Supabase. Intently keeps reading from the mirror; orchestrator + ranker behaviour unchanged.
4. Editing flow becomes: admin uses Medusa Admin → webhook fires → Intently catalogue refreshes within seconds.
5. `src/lib/data.ts` retires — replaced by an in-memory cache populated from the mirror at boot, refreshed on webhook signal.

**Cost.** ~2–4 weeks. Real work, but it's the work [[supabase-over-medusa]] always anticipated.

**Wins.** Medusa Admin gives you everything: attributes, images (with optimisation), variants (when needed later), inventory (when needed later), pricing tiers (when needed later), and a stable surface that doesn't need maintenance. The Intently-side sync layer is small (~one route + one cache invalidation hook).

**Losses.** ~2–4 weeks before the operator can edit products without code changes. During that window, the read-only viewer (built now) + edit-`data.ts`-by-hand is the workflow.

## What about recipes?

Recipes have no Medusa equivalent. Medusa knows products, not editorial content. If we adopted Medusa for everything, we'd still need to author recipes somewhere — and that "somewhere" would have to be Intently (or a separate CMS, which means yet another tool).

So recipes are **Intently-zone forever.** A recipe editor in `/admin/pim/recipes/[id]/edit` is non-throwaway work. The roadmap's "wait for 30+ recipes" gate was a scale gate, not a technical one — if you want it now, no architectural conflict.

The recipe editor design follows the same Phase 2 campaigns pattern: server actions, service-role writes to the `recipes` mirror table, JSON round-trip back to `src/lib/recipes/data/*.json` for source-of-truth preservation. Recipe edits don't have the same scale / variant / inventory complexity products have, so the round-trip approach (Option B's mechanism, applied to recipes) actually works long-term here.

## Recommendation

**Adopt Option C for products + a Intently recipe editor for recipes.**

Reasoning:
- **The right architecture aligns with the [[admin-zones]] partition.** Products are Medusa-zone; recipes are Intently-zone. Make the implementation match the zone.
- **Throwaway work is the trap.** Five days of Intently product editor that gets ripped out in three months is a worse outcome than three weeks of Medusa migration that pays off forever.
- **The viewer un-blocks visibility today.** The read-only PIM (just shipped at `/admin/pim/products` + `/admin/pim/recipes`) closes the "I can't see what's in the catalogue" gap. That's 60% of the perceived pain.
- **The remaining 40% (editing) is worth pacing.** Edit-by-data.ts-commit for 2–4 weeks while Medusa adoption lands is annoying but not blocking — there are only 32 products, and product edits aren't daily work.

If the timeline is unacceptable — if you genuinely need product editing in the next 7 days — then Option B (round-trip to TS) is the least-bad tactical answer. It keeps source-of-truth stable, so retirement when Medusa lands is just "delete the editor route." Option A's source-of-truth flip is the path I'd avoid.

## What's already in place (Phase 4 read-only PIM)

Shipped as of this commit:

- `/admin/pim/products` — searchable grid of every product with image, name, id, price, tagline, categories
- `/admin/pim/products/[id]` — full attribute display + image preview + raw JSON
- `/admin/pim/recipes` — same shape for recipes
- `/admin/pim/recipes/[id]` — title, hero/thumbnail, ingredients, steps, raw JSON

Both pages read directly from the runtime catalogue (`getAllProducts`, `getAllRecipes`) so what the admin sees is what the AI sees. No DB queries, no separate cache, no risk.

## Decision rationale (2026-05-25)

Operator chose **Option C + recipe editor in Intently next**. The argument that closed it:

- Building a Intently product editor for 3–10 days to throw away in 1–3 months when Medusa lands is wasted attention even when the editor "works." The read-only viewer just shipped already solves visibility — ~60% of the perceived pain.
- The remaining 40% (editing) is manageable: 32 products today, edits aren't daily, and the pain is bounded.
- The Medusa adoption is the architecture's planned destination — building toward it is non-throwaway by definition. The 2–4 week timeline is real but it's the work [[supabase-over-medusa]] always anticipated.
- Recipes are Intently-zone forever (no Medusa equivalent), so a recipe editor is unambiguously the next valuable PIM build.

## Implementation now

- Product edits stay in `src/lib/data.ts` until Medusa lands. Use `/admin/pim/products` to inspect; edit + commit when changes are needed.
- Recipe editor lands as the next admin-panel build. Same Phase 2 pattern (service-role writes, audit log, cache invalidation) plus JSON round-trip back to `src/lib/recipes/data/*.json` so source-of-truth stays in code (matching the recipes-are-Intently-zone-forever architecture).
- Medusa migration is a separate, larger project. Spec + estimate + execute as its own milestone, not as part of the admin-panel plan.

## Related

- [[admin-zones]] — the partition this builds on
- [[supabase-over-medusa]] — the trigger conditions for Medusa adoption (some of which are now met)
- [[admin-panel-guide]] — operator how-to for the read-only PIM that ships today
