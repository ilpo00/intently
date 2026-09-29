# ADR-0007 — OpenAI embeddings at 384 dimensions for the cloud path

- **Status:** Accepted (2026-07-06), in production
- **Detail:** [wiki/concepts/enrichment-layer](../../wiki/concepts/enrichment-layer.md) · `intently/src/lib/enrichment/embedder.ts`

## Context

Locally, embeddings run in-process with Xenova `all-MiniLM-L6-v2` (384-dim, no
key, no cost). On Vercel that path cannot run at all — the ONNX runtime's
native binary isn't available to serverless functions. The Supabase pgvector
schema was already `vector(384)`.

## Decision

Add an `OpenAIEmbedder` using `text-embedding-3-small` with `dimensions: 384`
behind the existing one-method `Embedder` interface, selected by
`ENRICHMENT_EMBEDDER`. Matching the existing dimension meant **zero schema
migration** and no change to any caller.

## Consequences

- Seeding the full 292-product store cost ≈ $0.0004.
- Two consistent pairs exist — Xenova + local file store, OpenAI + Supabase.
  Stored and query vectors **must** come from the same embedder; switching
  means clear + full re-sync. Cross-wiring fails silently (garbage similarity),
  so it is documented in `prodprep.md` and the CLAUDE.md enrichment section.
- The swap validated the enrichment layer's interface design: the cloud move
  was a new class plus configuration, not a rewrite.
