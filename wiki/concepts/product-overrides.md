---
type: concept
status: draft
updated: 2026-06-09
sources: [enrichment-studio, enrichment-layer, situation-match, demo-solution-overview]
tags: [overrides, curate, attention-queue, pm, runtime-layer, discovery]
---

# product-overrides

The **PM action loop**: how a product/catalogue manager *acts on* the catalogue — edits an attribute and watches discovery change, and works a persistent needs-attention queue — without an engineer and without mutating the committed catalogue. The merchandiser-side value (see [[project-primary-users-pm-catalog]]): understand → trust → **act** → measure.

## The pattern: a non-destructive runtime overlay

Both halves are **runtime override layers**, deliberately mirroring `situation-overrides.ts`: a small JSON map under `.enrichment/` (gitignored, server-only `node:fs`) that is *merged over* the committed catalogue at read time. The committed `vision-catalog.json` is never rewritten; deleting the file resets to the catalogue. Empty overrides = identity, so the baseline demo is unchanged until a PM edits something.

- `src/lib/enrichment/product-overrides.ts` — `.enrichment/product-overrides.json`, `id → Partial<Product>` over the curatable attributes (colour, pattern, occasions, styleTags, formality, seasons, fabric). `mergeProduct(base, ovr)` applies it **and recomposes `embeddingText`** so the vector reflects the edit.
- `src/lib/enrichment/attention-state.ts` — `.enrichment/attention-state.json`, `id → { status: open|dismissed|resolved, note?, updatedAt }`. `'open'` is the implicit default, so only the exceptions are stored (the file self-cleans).

## #1 — Edit → re-enrich → see the effect

Curate editor in the Studio per-product detail (`StudioClient.tsx`). A PM edits **attributes, not rules**; **Save & re-embed** (`PUT /api/enrichment/products/[id]`) writes the override and calls `pipeline.syncOne(id)` to re-vectorise that one product synchronously (~10 ms, local Xenova). The editor shows a **before→after rank** on the discovery probe; **Revert** is `DELETE`.

The edit reaches **live discovery**, not just the inspector, because the override is merged at every server read seam:

```
product-overrides.json
  ├─ pim-intently-catalog.ts  list()/get()  → syncAll/syncOne embed the edited text
  ├─ retrieve.ts  resolve()                 → /api/discover shows edited attributes + re-ranks
  └─ catalog/load.ts  mergedVisionProducts()→ dashboard readiness + the attention queue
```

## #3 — Needs-attention work queue

`/admin/enrichment/studio/attention` — every product holding back discovery readiness as a worklist (filter by reason + triage status, open-count badge). **Fix** deep-links into the curate editor (`?product=<id>#curate`, server-resolved preselect + scroll); **Resolve** / **Dismiss** persist triage.

The reasons (`buildAttention` in `catalog/insights.ts`) are recomputed over the **override-merged** catalogue each load, so a fix that clears a reason drops the product from the open list **automatically** — and the same edit lifts the dashboard's Discovery Readiness. The dashboard's transient "needs attention" filter and this persistent queue share **one** definition (`insights.ts`) and **one** situation-fit source (`load.ts`) so they can't drift.

## Gotcha — the vision catalogue is clean on discrete reasons

On the n=292 vision catalogue the discrete reasons (thin occasions, no style/material, unclassified pattern, low confidence, validator-flagged) match **~zero** products — vision attributed everything well. So the queue is driven almost entirely by the **relative** "weakest situation fit" lane (bottom ~12% by best situation match). The queue is real and useful, but on this data it reads as a "hardest-to-discover" list, not a varied defect list. To make it richer for a demo: tighten the discrete thresholds or seed a few genuinely thin products.

## Out of scope (deferred)

Behavioural/impact metrics (conversion, dead-end-search rate) — need a real customer's traffic. Snooze + catalogue-health-over-time trend. Persisting overrides back into the committed catalogue (kept a runtime layer on purpose).

## Related

- [[enrichment-studio]] · [[demo-solution-overview]] · [[situation-match]] · [[enrichment-layer]] · [[project-primary-users-pm-catalog]]
