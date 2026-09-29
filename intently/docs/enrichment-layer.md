# Enrichment Layer

> Status: prototype (v0.1), local-first
> Scope: PIM → embeddings → vector store → semantic search; admin UI
> Date: 2026-05-30

## Problem

The discovery layer (river / chat / chips / intent score) emits user-shaped queries
("blue casual shirt for summer evenings", "sturdy track pants for the gym"). The PIM
stores structured product master data. There is no fast bridge between the two.

Naive string search collapses the moment a query uses words the product copy doesn't.
What we need: a representation of each product that is **semantically close** to plausible
user intents, queryable in milliseconds, indexed once and reused on every query.

That representation is an embedding vector. The store that holds them is the enrichment
layer.

## Layers

```
PIM (Medusa)                       <-- source of truth for master data
        │
        ▼
PimAdapter                         <-- interface; MedusaPimAdapter | KaggleCsvPimAdapter
        │  PimProduct
        ▼
Enricher                           <-- composes embedText from product fields
        │  string
        ▼
Embedder                           <-- xenova/all-MiniLM-L6-v2 (384-dim)
        │  number[]
        ▼
VectorStore                        <-- interface; LocalJsonStore | SupabaseVectorStore
        │
        └── search(queryVec, k) → ranked [{id, score, metadata}]
                │
                ▼
        /api/enrichment/search ──► discovery layer
```

Every arrow is a typed contract. Every box is swappable behind its interface.

## Key decisions

### 1. Embedding model: `all-MiniLM-L6-v2` via `@xenova/transformers`

- 384 dimensions, runs in Node with no API call, no key.
- ~30 MB model weights, cached after first load.
- Trade-off: smaller and less expressive than OpenAI text-embedding-3-small (1536 dim),
  but **zero infra and zero cost** for a prototype. Quality is good enough for fashion
  short-text matching; we'll re-evaluate once we have real usage signal.
- Swap path: `Embedder` is a one-method interface. To switch to OpenAI or a larger Xenova
  model, swap the impl; nothing downstream cares.

### 2. Vector store: file-backed JSON now, pgvector later — same interface

- Today: `LocalJsonVectorStore` writes to `.enrichment/vectors.json` (gitignored) and does
  cosine in-process. Honest about its limits — fine up to ~10k vectors; beyond that
  in-memory scan becomes a real cost.
- Tomorrow: `SupabaseVectorStore` reads/writes a `product_vectors` table with `vector(384)`
  and an HNSW index. Same `VectorStore` interface; the swap is one env var
  (`ENRICHMENT_STORE=supabase`).
- Migration SQL ships now (`intently/supabase/migrations/0010_enrichment_vectors.sql`) — ready
  to apply when Supabase is provisioned. No DB needed to demo.

### 3. PIM: Medusa v2, but adapter pattern so the prototype runs without it

- `MedusaPimAdapter` fetches products from a running Medusa instance via REST.
- `KaggleCsvPimAdapter` reads 10 hand-picked rows from `data/kaggle/styles.csv` and produces
  the same `PimProduct` shape.
- Default in dev: CSV adapter, so anyone can demo the enrichment layer without standing
  up Medusa. Setting `PIM_SOURCE=medusa` flips it.
- Medusa setup ships as a sibling `pim/` directory with a setup script and seed (10
  Kaggle products → Medusa catalog) — user runs install once.

### 4. Sync is explicit, not implicit

- Admin clicks "Sync from PIM". Pipeline pulls all products, embeds, upserts.
- No watch/webhook in v0.1 — the cost of complexity isn't worth it before we have a real
  catalog churning.
- Per-product re-embed button for fine-grained updates.

### 5. The text we embed matters more than the model

What we feed to the embedder for each product:

```
{productDisplayName}. {gender} {usage} {articleType}.
Category: {masterCategory} > {subCategory}. Colour: {baseColour}.
Season: {season}. {year}.
```

This is a deliberate choice — embedding the *display name alone* loses category and
attributes; embedding everything (including IDs, timestamps) adds noise. The composition
is in `src/lib/enrichment/enrich-text.ts` and is the single most tweakable knob for
matching quality. Iterate there.

## Non-goals (explicitly out of scope for v0.1)

- Image embeddings (CLIP). The Kaggle dataset has images; we don't use them yet. Text-only
  for v0.1 keeps the pipeline simple. Add a parallel `ImageEmbedder` later if text proves
  insufficient.
- Hybrid search (vector + BM25). Vector-only is enough for the prototype demo.
- Reranking. The first-pass cosine ranking is the demo.
- Multi-tenant or per-user vector spaces. Single global namespace.
- Webhooks/event-driven sync. Manual button.

## What "Focus on hard how the vector database works" means here

The admin panel exposes the parts that are usually hidden:

1. **Vector inspector** — open any product, see the first 16 dimensions of its 384-dim
   embedding (the whole vector would be visual noise). Plus a "cosine to neighbours" view
   showing similarity scores to the other 9 products.
2. **Live search debug** — type a query, see the query vector, the top-k results with
   raw cosine scores, and which fields of each result matched.
3. **Re-embed** — change `enrich-text.ts`, re-embed one product, immediately see how
   neighbour rankings shift.

This is the "honest internals" view — no black box.

## File map (where things live)

```
intently/src/types/enrichment.ts                   types (PimProduct, EnrichedProduct, Vector, etc.)
intently/src/lib/enrichment/
  index.ts                                     barrel
  enrich-text.ts                               product → embed string
  embedder.ts                                  Embedder interface + XenovaEmbedder impl
  vector-math.ts                               cosine, normalise (pure, easily tested)
  vector-store.ts                              VectorStore interface
  vector-store-local.ts                        LocalJsonVectorStore impl
  vector-store-supabase.ts                     SupabaseVectorStore impl (queries-ready)
  vector-store-factory.ts                      picks impl from env
  pim-adapter.ts                               PimAdapter interface
  pim-medusa.ts                                Medusa REST client
  pim-kaggle-csv.ts                            CSV-backed adapter (default for prototype)
  pim-factory.ts                               picks impl from env
  pipeline.ts                                  enrichmentPipeline orchestrator

intently/src/app/api/enrichment/
  sync/route.ts                                POST — run pipeline
  search/route.ts                              POST — k-NN search
  products/route.ts                            GET — list w/ enrichment status
  vectors/[id]/route.ts                        GET — inspect one vector

intently/src/app/admin/enrichment/
  page.tsx                                     UI

intently/supabase/migrations/
  0010_enrichment_vectors.sql                  pgvector schema + indexes + RLS + RPC

pim/                                           Medusa starter (sibling to intently/)
  README.md                                    setup + seed instructions
  package.json
  medusa-config.ts
  src/scripts/seed-kaggle.ts                   seeds 10 Kaggle products into Medusa
```

## Open questions (for future iteration, not blocking v0.1)

- When we switch to Supabase, should the enrichment vectors live alongside `pim_products`
  (mirroring the PIM there too) or stay decoupled (only embeddings + ids in Supabase, PIM
  remains in Medusa)? Current plan: decoupled. Re-evaluate if cross-table joins become painful.
- Re-embedding strategy: cost per product is real once we have ~10k. Batching + diff-based
  re-embed (only if `embed_text` actually changed) is the obvious move when needed.
- The cold-start of the Xenova model (~5s) is fine for a sync but a problem for query
  embedding latency. Warm-load at server boot, or precompute query embeddings via a
  cache. Defer until we measure.

## See also

- `src/lib/enrichment/*` — the code this document describes
- `intently/supabase/migrations/0010_enrichment_vectors.sql` — the SQL we'll apply
- `pim/README.md` — Medusa setup
