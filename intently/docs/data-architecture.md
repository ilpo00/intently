# Data architecture — how we use the Kaggle data, and how it mimics a PIM + enrichment layer

> How product data flows through Intently, and which system owns what. Phase 1 (now)
> collapses several roles into one local step; Phase B splits them into the real shape.
> See `docs/roadmap.md` for the phase definitions.

## The conceptual pipeline (from `01-concept-and-pitch.md`)

```
Retailer PIM   →   Enrichment layer        →   Product Intelligence Store   →   Discovery
(basic attrs)      (image/attr extraction)     (enriched attrs + vectors)       (retrieval + LLM)
```

Intently does not replace the PIM. It sits *between* the PIM and the shopper: an enrichment layer
turns thin catalogue data into AI-ready product intelligence, stored alongside vectors, and the
discovery layer reasons over it. The enriched store is the proprietary asset (and Product 2).

## System roles

| Role | Phase 1 (now) | Phase B (real shape) |
|---|---|---|
| **Raw source assets** | The Kaggle dataset on the **local drive** at `~/intently-poc/data/kaggle/` (~31GB, git-ignored, never imported into the app). Analogous to a retailer's raw catalogue + image library. | A retailer's actual image/asset store (or our mock of it). |
| **PIM (system of record)** | Implicit — the Kaggle `styles.csv` rows *are* the "basic attributes" (id, gender, category, articleType, baseColour, season, usage, name). | A **Medusa** instance mimicking a retailer PIM: SKU, price, stock, name, category, base colour. Seeded from `styles.csv`. |
| **Enrichment layer** | `scripts/import-kaggle.mjs` — deterministically maps PIM metadata → enriched attributes (`occasionTags`, `formalityLevel`, `season`, `pattern`, `styleTags`). Run once, by hand. | A **continuous pipeline**: Claude vision extracts the attributes that aren't in the PIM (`fabric`, `silhouette`, finer `occasion`/`style`) from product images, plus embeddings. Runs as new SKUs arrive. |
| **Product Intelligence Store** | The generated **JSON** in `src/lib/catalog/*.json` (in-memory catalogue), read by `src/lib/data.ts`. | **Supabase** (Postgres + **pgvector**, HNSW index): enriched rows + embeddings, queried by vector similarity. |
| **Served images** | The curated **<100-image subset** copied into `intently/public/catalog/` (committed) — the only images the app touches. | Retailer CDN / object store. |
| **Discovery** | `src/lib/discovery/` (deterministic: parse situation → pre-filter → explain) behind `POST /api/discover`. | Same contract; pre-filter runs *after* pgvector retrieval, and a Claude re-ranker rewrites explanations. |

## What the import script actually does (the Phase-1 "enrichment")

`scripts/import-kaggle.mjs` is the manual stand-in for the enrichment pipeline:

1. Reads `styles.csv` (the "PIM") — never loads images into memory.
2. Selects a small, curated subset: ~42 women's dresses (incl. florals, for the "not floral" demo) and
   ~40 outdoor-basket items (jackets, daypacks, sunglasses, sporty layers, caps).
3. **Derives enriched attributes deterministically** from PIM fields:
   `usage → formalityLevel + styleTags`, `season → season`, `name → pattern` (e.g. "floral"),
   `usage + season + category → occasionTags` (a summer party/smart-casual dress becomes a
   "wedding guest / outdoor event" candidate).
4. Leaves `fabric` and `silhouette` empty — **these are exactly the attributes that need vision**, so
   they're the visible boundary between Phase-1 deterministic enrichment and Phase-B vision enrichment.
5. Copies only the selected images into `public/catalog/` and writes the catalogue JSON.

The key idea: **Phase 1 collapses PIM + enrichment + store into one local script + JSON.** Phase B
pulls them apart into Medusa (PIM) → enrichment pipeline → Supabase (store) — same data shapes, real
infrastructure, continuous instead of one-shot. The `src/lib/data.ts` loaders are the seam that lets
the store swap without touching call sites.

## Honest limitations of this dataset

- It's an **Indian fashion** catalogue — excellent for the wedding-dress scenario (real dresses,
  colours, patterns), but it has **no true outdoor gear**. The day-hiker basket is approximated from
  the nearest categories (sport jackets, backpacks, sunglasses, sporty tops). A production outdoor
  pilot would source a real outdoor catalogue (or our Medusa mock seeded from one).
- `fabric` / `silhouette` are absent until Phase-B vision enrichment.
- The raw dataset double-extracted (`data/kaggle/` and `data/kaggle/fashion-dataset/` are identical);
  the second copy can be deleted to reclaim ~15GB.
