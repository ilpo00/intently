# ADR-0005 — Vision enrichment as an offline, validated batch — never in the request path

- **Status:** Accepted (2026-06); rebuilt for serverless 2026-07-18
- **Detail:** [wiki/concepts/vision-enrichment](../../wiki/concepts/vision-enrichment.md) · `intently/src/lib/enrichment/vision/`

## Context

A PIM knows "black dress, €35". Answering "a cold seaside evening" needs
occasions, silhouette, materials and layering — information that is mostly in
the product *photo*, not the data. Reading images per request would put a
multimodal call in the shopper's latency path.

## Decision

Enrich each product **once, offline**: Claude Haiku reads the photo and
proposes attributes plus natural-language *discovery queries* (the situations
the product should surface for). A deterministic schema validator sits between
model and store — clamping formality, intersecting archetypes/seasons with the
controlled vocabulary, and recording every correction as a flag. Haiku was
chosen because the preferred bulk provider (DeepSeek) has no vision input.

On serverless (no child processes, read-only disk) the batch was **rebuilt to
fit** rather than dropped: in-process, chunked and resumable from the Studio,
writing one row per product to Supabase. The old CLI path was retired so the
two could not diverge.

## Consequences

- ~930 tokens ≈ **$0.0018 per product**; a 10k-SKU catalogue ≈ $20, cheap
  enough to re-run on catalogue churn.
- Discovery quality now depends on enrichment quality, so the Studio shows
  provenance (photo-read vs text-derived) and lets a merchandiser curate and
  re-embed.
- Known model limits recorded, not hidden: formality anchors low on a
  casual-heavy catalogue; style archetypes cluster.
