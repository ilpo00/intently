---
type: concept
status: draft
updated: 2026-06-07
sources: [enrichment-layer]
tags: [discovery, situations, soft-weights, ranking, hybrid, merchandising]
---

# situation-match

The productionised "situation model" — a **soft, weighted scorer** that biases discovery toward how people typically dress for a situation, but **never excludes**. Lives in `src/lib/discovery/situation-match.ts`; profiles are editable data in `src/lib/discovery/situation-profiles.json`. Chosen via a comparison spike where this approach matched an LLM oracle's relevance set 6/6 at zero query-time cost (see [[demo-solution-overview]]).

## Why soft, not rules

Situations aren't hard lines — a shopper whose "office" means shorts is still right. So the profile carries **emphasis**, not gates: a de-emphasised garment loses rank but still appears. The only hard lines are the **user's own** exclusions ("nothing floral"), applied in `prefilter.ts` — the situation layer never adds hard lines.

## The model

Each product is scored on six soft, bounded dimensions, each weighted by the profile:

`formality · occasion · garment · style · season · material`

- **weights** (0–100) = how much each dimension matters for this situation.
- **emphasis** = what to lean toward: a formality target (1–5), a per-garment soft preference (0–1, unset = neutral 0.5), and preferred occasion tags / style archetypes / seasons / materials.
- `score = Σ (weight · match) / Σ weight` → 0..1, with a **per-dimension breakdown** so a PM sees *why* a product ranks where it does. No term can drop a product; emphasis only re-orders.

`matchSituation(query, profiles)` fuzzily maps a free-text query to a profile (keyword/label overlap; returns null → discovery falls back to plain ranking).

## Hybrid seam (tune, don't re-code)

Profiles are **data**: world-knowledge authored, curator-editable in the Studio's **situation tuner** (`/admin/enrichment/studio/situations`), and later replaceable by *learned* signals behind the same `scoreSituation()` contract. Runtime edits persist as overrides (`.enrichment/situation-overrides.json`); `loadMergedProfiles()` merges defaults ⊕ overrides and feeds **live discovery** via `/api/discover` when `DISCOVERY_SITUATION=on` (default off; the engine stays client-safe by receiving profiles as a parameter).

## Guardrails

`src/tests/situation-match.test.ts` pins the behaviour as a fast, free regression: never-excludes, breakdown sums to score, hike ranks a jacket over a dress, a wedding is topped by a dress, an under-served situation (black-tie) scores lower than a served one, a de-emphasised garment (office shorts) still appears, and query→profile matching.

## Honest limits

- Garment emphasis is **per-category**, so a sporty jacket and a blazer share a key — the formality/occasion/style dims (and now vision attributes) must carry the distinction.
- Occasion matching is tag-overlap; with the vision catalogue's free-text occasions, the **vector/semantic path** ([[enrichment-layer]]) does the heavier lifting for consumer discovery, while this scorer is the explainable, tunable merchandiser-facing bias.

## Related

- [[demo-solution-overview]] — where this sits in the end-to-end demo
- [[enrichment-layer]] — the semantic retrieval it complements
- [[enrichment-studio]] — the cockpit; the situation tuner is a surface of it
