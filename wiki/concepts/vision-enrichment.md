---
type: concept
status: draft
updated: 2026-06-05
sources: [enrichment-layer]
tags: [vision, enrichment, multimodal, claude-haiku, tiered-ai, cost, provenance, roadmap-now-built]
---

# vision-enrichment

The first version of **image analysis** for the enrichment layer: scan each product's photo with a multimodal model and extract the situational context the PIM never had — colour, pattern, materials, silhouette, formality, seasons, *specific* occasions, style archetypes, a merchandising description, and **discovery queries** (the shopper situations the product should surface for). It answers the gap the [[enrichment-studio]] provenance view exposed ("the image is not analysed"). An offline, cached batch — run from the Studio, output to `.enrichment/vision-*.json` or Supabase — surfaced at `/admin/enrichment/studio/vision`, which separates **PIM-sourced** context from **vision-enriched** context per product.

## Tiered architecture (per [[tiered-ai-architecture]])

- **Tier 0 — deterministic (owns the most code):** the JSON **schema + validator** between the model and the store. It clamps `formality` to 1–5, intersects `styleArchetypes` with the river's 9-archetype vocab, intersects `seasons`, coerces/dedupes arrays, and records every correction as a **flag** (e.g. "dropped styles: casual"). The model proposes; code enforces the contract the discovery layer reads. Also owns caching + the (future) merge of vision vs PIM attributes.
- **Tier 1 — bulk worker:** normally DeepSeek — but **DeepSeek's hosted API has no vision input**, so the only wired multimodal option is Claude. The bulk worker is therefore **Claude Haiku 4.5**, one call per image. Its output is never trusted raw (Tier-0 validator sits in front).
- **Tier 2 — Claude verifier:** Sonnet/Opus as verify-or-regenerate for low-confidence/conflicting extractions. Not exercised in v1; the iteration pass tested whether a better prompt on Haiku closes the gap first (it largely did).

## Where it runs + token cost (measured, 10 products)

Offline batch, **never in the discovery hot path**; results cached to JSON. Real Haiku 4.5 usage (webp product shots tokenise cheaply):

| | input/img | output/img | avg total/product | est. cost/product* |
|---|---|---|---|---|
| **v1** | ~530–690 | ~170–225 | **~760 tok** | ~$0.0015 |
| **v2** | ~660–810 | ~205–245 | **~930 tok** | ~$0.0018 |

\*assumed Haiku 4.5 list pricing ($1/MTok in, $5/MTok out); tokens are the hard number. At ~$0.002/product, enriching a 10k-SKU catalogue is **~$20** — cheap enough to re-run on catalogue churn.

## v1 → v2 iteration (what worked / what didn't)

**Worked:**
- **`discoveryQueries` (the big add):** v2 emits 2–3 natural shopper situations per product — e.g. the camo softshell → *"a warm layer for a cold evening hike"*. This is the output that feeds discovery directly and speaks the river's language.
- **Vocab adherence:** putting the controlled 9-archetype list *in the prompt* and forbidding "casual" eliminated all validator drops in v2.
- **Specificity:** occasions went generic → situational ("everyday/casual" → "cold-weather layering, trail hiking, office"); colours got precise ("tan" → "caramel brown", "blue" → "cornflower blue").
- **Vision genuinely beats text:** caught `camo` and the navy+white **stripe** the PIM mislabelled "White", read the occult-skull **graphic**, and inferred materials (nylon, faux-fur, wool-knit) the PIM never carried.

**Didn't improve / open issues:**
- **Formality stayed flat at 1** for most casual items despite a full-range rubric — the model anchors low on a casual-basics catalogue. Likely needs few-shot anchors, or it's simply that the set lacks formal pieces. Don't trust formality yet.
- **Style archetypes cluster** on relaxed/minimalist/sporty across similar casual garments — limited discrimination.
- **Cost rose ~22%** (v1→v2) for the richer output — worth it for `discoveryQueries`, but a real tradeoff.

## Where it runs (rebuilt 2026-07-18)

Originally a local CLI batch (`scripts/vision-enrich.mjs`), which meant it could not run on the cloud demo at all — serverless has no child-process model and a read-only filesystem. The core moved into `src/lib/enrichment/vision/enrich.ts` and now runs **in-process, in resumable chunks**, driven from the Studio button; the CLI script was **retired** so the two paths cannot diverge. Output goes to local `.enrichment` JSON or Supabase `vision_records`, whichever the store selects.

Practical shape: ~2.6s per product (Anthropic org rate limit, not an app inefficiency), so the 292-product catalogue takes ~15 minutes and ~$0.55. A run survives a closed tab — the cursor is server-side — and resume never re-bills enriched products. See [[cloud-demo-deployment]] for the platform decisions and `intently/docs/running-enrichment.md` for the operator guide.

## Honest scope of v1

The 10 "products" are **real photos** from the webp bank with **synthetic thin PIM stubs** standing in for sparse master data (the committed catalogue's `.jpg` paths don't resolve, and it's a different dataset). This proves the analyser and the PIM-vs-vision separation, but does **not** yet wire vision attributes into the live 82-product discovery catalogue.

## Next iterations

1. **Feed discovery:** map vision `occasions`/`discoveryQueries`/`styleArchetypes` into the river's enrichment so vectors embed the image-derived text — then measure discovery hit-rate before/after.
2. **Merge + conflict policy** (Tier 0): vision fills image-only fields (fabric, silhouette, pattern), flags disagreements with PIM rather than overwriting.
3. **Formality:** few-shot anchors or a Tier-2 verifier pass for the fields Haiku is weak on.
4. **Scale + cache invalidation:** batch the full catalogue, re-run only on image change (hash).

## Files

- `intently/src/lib/enrichment/vision/enrich.ts` — the batch core (prompt v2, Tier-0 validator, token accounting).
- `intently/src/lib/enrichment/vision/store.ts` — output seam (local JSON / Supabase `vision_records`).
- `intently/src/app/api/admin/vision-enrich/route.ts` — the chunked, resumable runner.
- `intently/src/lib/enrichment/vision/products.json` — the 10 inputs.
- `intently/src/app/admin/enrichment/studio/vision/{page,VisionClient}.tsx` — the PIM-vs-vision preview.

## Related

- [[enrichment-studio]] — where this is surfaced; its provenance view is what motivated it
- [[enrichment-layer]] — the pipeline vision attributes will eventually feed
- [[tiered-ai-architecture]] — the deterministic/DeepSeek/Claude framing applied here
- [[deterministic-ranker]] — consumes the enriched attributes on the discovery side
- [[cloud-demo-deployment]] — the platform decisions that let this batch run on serverless
