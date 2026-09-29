---
type: concept
status: stable
updated: 2026-05-31
sources: [claude-md]
tags: [enrichment, embeddings, vectors, xenova, medusa, pim, pgvector, discovery, semantic-search]
---

# Enrichment layer

The enrichment layer is the bridge between **structured product data** (a PIM) and the **discovery layer** (the river that emits situational queries like "a dress for an outdoor July wedding"). It enriches each product into a semantic **embedding vector**, stores those vectors, and answers nearest-neighbour queries in milliseconds — so the LLM/ranker never has to scan the whole catalogue. It realises **Layers 1–2** of the Intently concept (PIM → enrichment → product-intelligence store), with the discovery river as Layer 3. Lives in `intently/src/lib/enrichment/`, exposed at `/admin/enrichment` and `/api/enrichment/*`. Full design rationale: the source doc `intently/docs/enrichment-layer.md`.

> Why it exists: naive string search breaks the moment a query uses words the product copy doesn't. A vector representation that is *semantically close* to plausible intents, indexed once and reused per query, is the fix.

## The pipeline (every arrow is a typed contract, every box swappable)

```
PIM (Medusa | CSV | catalogue)
      │  PimProduct
      ▼
buildEmbedText            ← composes the string to embed (the tweakable knob)
      │  string
      ▼
Embedder                  ← Xenova MiniLM (384-dim) | Deterministic
      │  number[]
      ▼
VectorStore               ← LocalJSON | Supabase pgvector
      │  search(queryVec, k) → [{ id, score, metadata }]
      ▼
/api/enrichment/search ──► discovery layer (and the admin inspector)
```

Each box is selected by an env var and memoised behind a factory, so swapping an impl touches nothing downstream. The contracts live in `src/types/enrichment.ts` (`PimProduct`, `Embedder`, `VectorStore`, `PimAdapter`, `SearchResult`).

## The boxes

### PIM adapter — where master data comes from

`PimAdapter` (`list()` / `get(id)`) abstracts the source of `PimProduct` records. Three impls, picked by `PIM_SOURCE` (factory: `pim-factory.ts`):

- **`catalog` (default)** — `IntentlyCatalogPimAdapter` projects the discovery river's own 82-product catalogue (`src/lib/data.ts` → `src/lib/catalog/*.json`) into `PimProduct`s. This is the **alignment** that makes the inspector and the river show the *same* products with the *same* ids (see "Discovery seam" below). It stashes the river's rich `embeddingText` in `PimProduct.raw.embedText`.
- **`kaggle`** — `KaggleCsvPimAdapter`, 10 curated rows read from `data/kaggle/styles.csv`. Zero-infra demo of the enrichment layer in isolation.
- **`medusa`** — `MedusaPimAdapter`, fetches via Medusa v2 Store REST. Requires `MEDUSA_*` env and a running `pim/` instance.

#### The Medusa PIM mockup (`pim/`)

`pim/` is a sibling Medusa v2 starter that **mocks a real retailer PIM** — the system-of-record for SKUs, price, stock, basic attributes that Intently does *not* replace. It ships a `setup.sh` and `seed-kaggle.ts` (seeds Kaggle fashion rows into the Medusa catalogue). The adapter pattern means the prototype runs *without* it (CSV/catalogue adapters are the default); flipping `PIM_SOURCE=medusa` points the same pipeline at the live Medusa REST API. Medusa was rejected as the *commerce* backbone ([[supabase-over-medusa]]) but is kept here purely as a realistic PIM stand-in; the broader products-vs-recipes split is [[pim-strategy]].

### Embedder — text → vector

`Embedder` (`embed` / `embedMany`, carries `modelId` + `dimension`). Picked by `ENRICHMENT_EMBEDDER` (`embedder.ts`):

- **`xenova` (default)** — `XenovaEmbedder` runs **`Xenova/all-MiniLM-L6-v2`** (384-dim) in-process via `@xenova/transformers`. **No API key, no remote call**; ~30 MB of weights download + cache on first use, then a singleton holds the graph in memory. Deliberately smaller/cheaper than OpenAI `text-embedding-3-small` (1536-dim) — quality is good enough for short fashion text, and the swap path is one method if that changes.
  - **Gotcha (fixed 2026-05-31):** the lib's `env` config must be *mutated* (`xenova.env.useBrowserCache = false`), never *reassigned* (`xenova.env = {…}`). Reassigning an ES-module export binding throws `Cannot assign to read only property 'env'` under Next 16 / Turbopack and killed the whole layer on first call.
- **`deterministic`** — `DeterministicEmbedder`, FNV-1a hash → indices, L2-normalised. No model load. **Repeatable but semantically meaningless** — for CI / unit tests and constrained machines only; cosine over these is arbitrary.

`buildEmbedText` (`enrich-text.ts`) composes the string that gets embedded — *the single most tweakable knob* for match quality. It prefers `PimProduct.raw.embedText` when present (the catalogue adapter supplies the river's richer text), else composes `name → audience/usage → category hierarchy → colour/season tail`.

### Vector store — hold + rank

`VectorStore` (`upsert` / `search(query, k, opts)` / `count` / `clear` …). Picked by `ENRICHMENT_STORE` (`vector-store-factory.ts`):

- **`local` (default)** — `LocalJsonVectorStore` writes `intently/.enrichment/vectors.json` (git-ignored) and does cosine in-process. Honest limit: fine to ~10k vectors; beyond that an in-memory scan is a real cost.
- **`supabase`** — `SupabaseVectorStore` reads/writes a `product_vectors` table (`vector(384)`, HNSW cosine index) via the `enrichment_search(query, k, min_score)` RPC. Migration `intently/supabase/migrations/0010_enrichment_vectors.sql` ships it.
  - **Gotcha:** pgvector lives in the `extensions` schema; SQL-function bodies resolve operators against a `search_path` that excludes it, so a bare `<=>` fails (`42883`). Fix: schema-qualify as `operator(extensions.<=>)`.

Same interface, so `local → supabase` is one env var once Supabase is provisioned. `cosine`/`normalise` math is in `vector-math.ts`.

## Sync is explicit, not implicit

`syncAll()` (`pipeline.ts`) pulls every product from the PIM, embeds it, and upserts the vectors. There is **no webhook/watch** in v0.1 — the admin clicks "Sync from PIM" (`/api/enrichment/sync`), or `syncOne()` re-embeds a single product. Honest call: event-driven sync isn't worth the complexity before there's a real catalogue churning.

## Discovery seam (how the river consumes it)

The discovery river ([[river-architecture]]) reaches the enrichment layer through **one opt-in switch**, `DISCOVERY_RETRIEVAL` (`src/lib/discovery/retrieve.ts`):

- **`deterministic` (default)** — the in-memory engine scores the whole catalogue. Instant, no infra, what CI and the demo use; better than vectors at 82 products.
- **`vector`** — `vectorRetrieve()` ensures the store is seeded (via the **same `syncAll()`** the inspector uses — one seeding path, so inspector and river share identical vectors + ids), calls `searchByText(query, k)`, maps each `SearchResult.id` back through `getProductById`, then runs the **same** deterministic prefilter + explanation on top. This is the "vector narrows the catalogue, the rest reasons over candidates" architecture. On any vector error it falls back to deterministic — the demo never dead-ends.

Because the default PIM is the catalogue itself, a search result id (`k37912`) maps straight back to the enriched `Product` the river renders. Verified live: searching "outdoor wedding dress for summer" returns catalogue dresses by their own ids.

## The admin inspector (`/admin/enrichment`)

Exposes the parts usually hidden: the product table with vector status, a **"Sync from PIM"** button, a per-product **vector inspector** (first 16 of 384 dims + cosine-to-neighbours), and a **live search debug** (query vector + top-k with raw cosine scores). In the reconciled Phase-1 build it's the one admin surface kept live; its auth guard is a permissive local-mode stub (`src/lib/auth/admin-guard.ts`) since the rest of the auth/admin stack is parked.

## Env vars

| Var | Default | Options |
|---|---|---|
| `PIM_SOURCE` | `catalog` | `catalog` (river's 82) · `kaggle` (CSV 10) · `medusa` |
| `ENRICHMENT_EMBEDDER` | `xenova` | `xenova` (MiniLM 384) · `deterministic` (tests) |
| `ENRICHMENT_STORE` | `local` | `local` (JSON) · `supabase` (pgvector) |
| `ENRICHMENT_LOCAL_DIR` | `.enrichment/` | any path |
| `DISCOVERY_RETRIEVAL` | `deterministic` | `deterministic` · `vector` |

## Non-goals (v0.1)

Image embeddings (CLIP), hybrid vector+BM25 search, LLM reranking, per-user vector spaces, webhook sync. All explicitly deferred — vector-only single-namespace is enough for the prototype.

## Related

- [[enrichment-studio]] — the merchandiser-facing cockpit over this layer (quality, provenance, discovery preview, embed-text tuning).
- [[river-architecture]] — the Layer-3 consumer.
- [[supabase-over-medusa]] / [[pim-strategy]] — why Medusa is a PIM mock here, not the commerce backbone.
- [[deterministic-ranker]] — the deterministic scoring the vector candidates are filtered/explained by.
- [[tiered-ai-architecture]] — the (parked) LLM path; the enrichment retrieval is the no-LLM alternative to fitting the whole catalogue in a prompt.
