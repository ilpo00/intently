---
type: concept
status: draft
updated: 2026-06-05
sources: [enrichment-layer]
tags: [enrichment, admin, merchandiser, provenance, discovery, vision-roadmap, ui]
---

# enrichment-studio

A merchandiser-facing workspace at `/admin/enrichment/studio` that **opens the enrichment black box**. The classic inspector ([[enrichment-layer]] → "admin inspector") proves vectors exist and shows the vector math (dim previews, histograms, cosine neighbours) — useful for an engineer. The Studio answers a *product manager's* questions instead: is the catalogue discovery-ready, why does a product surface or not, where did its attributes come from, and what do I change? Lives in `intently/src/app/admin/enrichment/studio/`. Non-destructive: a new route alongside the classic inspector, reusing the same `/api/enrichment/*` reads.

## Why it exists

The enrichment layer is what lets a flat catalogue answer *situations* ("a dress for an outdoor July wedding"), not keywords — but it was opaque. A merchandiser had no view of catalogue readiness, no explanation of why a product is/isn't reachable, no sight of where attributes come from, and no lever. The Studio makes the layer legible and tunable by a non-engineer, which directly lifts discovery hit-rate and exposes *dark inventory* (products no realistic situation reaches).

## Grounded in how PMs work catalogues

PMs think in coverage/completeness, QA the weak outliers, and validate against real search. The surfaces map to those four questions:

1. **Is my catalogue ready?** — a **pipeline ribbon** (PIM → enrich → index → discovery, with live counts) and a **catalogue-health** bar (Strong / Fair / Thin, "N need attention").
2. **Which products are weak?** — a product list with a derived **enrichment-quality score** + a "Needs attention" filter.
3. **Why isn't X showing?** — a **Discovery preview**: type a situation, see what surfaces; the selected product is flagged ✓ at #N or ✕ not reachable (the gap-finding moment).
4. **What do I change?** — the per-product **anatomy** (raw → enriched attributes → the **embed-text knob** → vector), a **quality checklist** with concrete fixes, and a **what-if tuning** preview of the embed text.

## The quality model (explainable heuristic, not an embedding claim)

`assessQuality` (`studio/lib.ts`) scores the signals a merchandiser can actually act on — colour, season, occasion, occasion-coverage, style archetypes, formality, and *rich embed text* (the heaviest weight). Bands: strong ≥ 80, fair ≥ 55, else thin; no vector ⇒ always "thin / needs attention". It deliberately does **not** claim anything about embedding quality — that is what the Discovery preview tests empirically.

## Attribute provenance — and "is the photo analysed?"

The Studio's provenance view answers a question the layer never surfaced: **no, the image is not analysed.** Every attribute the discovery layer uses is computed from **text** — the PIM's metadata fields and the product *name* — by deterministic rules in `intently/src/lib/enrichment/derive-attributes.ts` (the build-time twin is `scripts/import-kaggle.mjs`; the runtime projection is `pim-to-product.ts`):

- `pattern` ← **regex on the product title** (`floral|stripe|print|check|dot`). "Floral Purple Dress" → `floral` from the words, not the picture.
- `styleTags` and `formalityLevel` ← **lookup tables on the PIM `usage` field** (Formal → elegant/classic, level 4; Party → romantic, 3; …).
- `occasionTags` ← a **rule set** over `usage` + derived `category` + `season`.
- `colour` / `season` ← passthrough/normalised PIM fields; `brand` ← first token of the name.
- `fabric` and `silhouette` ← **left blank**, flagged in code as *"vision-only — light default"*: they would require reading the image, and there is no vision pipeline.
- the embedding is **MiniLM over the composed text only** — the image is never embedded.

The provenance table colour-codes each attribute by origin (PIM field / product name / rule / text-embedding / *would need the image*), and a callout states the text-only reality plainly. This makes the case for the vision roadmap concrete rather than abstract.

## Architecture

- **Reuses existing reads**, no backend rewrite: `GET /api/enrichment/products`, `POST /api/enrichment/search` (the same `searchByText` the river uses — so the Discovery preview shows exactly what discovery gets), `GET /api/enrichment/vectors/[id]` (neighbour cohort), `POST /api/enrichment/sync/[id]` (re-embed).
- **Quality + provenance are pure, client-side** functions (`studio/lib.ts`) over `PimProduct` (incl. the catalogue adapter's `raw` enrichment). No new persistence.
- **Server shell** (`studio/page.tsx`) fetches once; `StudioClient.tsx` owns interaction. Auth via the permissive local-mode `requireAdmin` in the parent `/admin` layout.
- Catalogue images 404 (the JSON's `.jpg` paths) → a letter-tile fallback; the broken images are orthogonal to the enrichment story.

## Deferred (next iterations)

- **Vision enrichment (CLIP-style):** derive colour/pattern/fabric/silhouette from the photo to fill the image-only gaps the provenance view exposes. The headline roadmap item.
- **Persisting edited enrichment:** today the embed-text edit is a *what-if* (it previews the cohort the edited text would join); persisting needs a writable PIM or an override layer in the vector store, because a re-sync re-reads the source.
- **Batch dark-inventory scan** across the whole catalogue (v1 probes on demand), and bulk edit / merchandising-rule workflows.

## Files

- `intently/src/app/admin/enrichment/studio/{page,StudioClient}.tsx` + `lib.ts` — the workspace + pure quality/provenance helpers.
- Reuses `intently/src/lib/enrichment/*` and `intently/src/app/api/enrichment/*`.

## Related

- [[vision-enrichment]] — image analysis (built v1): reads each photo to fill the image-only context this view's provenance flagged as missing
- [[enrichment-layer]] — the pipeline this is the cockpit for (PIM → buildEmbedText → embedder → vector store → search)
- [[deterministic-ranker]] — the deterministic scoring discovery applies on top of vector candidates
- [[next-overlay-ux]] — the discovery surface whose hit-rate this tooling exists to improve
- [[cloud-demo-deployment]] — the Studio on Vercel: which controls disable themselves, and why the nav carries no pipeline row
