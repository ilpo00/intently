// ─────────────────────────────────────────────────────────────────
// Intently · Enrichment Layer Types
//
// The single contract every enrichment-layer impl satisfies.
// See intently/docs/enrichment-layer.md for the architecture.
//
// Naming convention: "PimProduct" deliberately differs from the
// existing river-side `Product` shape — this is the *upstream*
// representation from the PIM, before any river-specific enrichment
// (whyItMatters, pairsWith, intent linkage) is applied.
// ─────────────────────────────────────────────────────────────────

/**
 * What a PIM (Medusa or CSV) returns. Optional fields reflect real
 * heterogeneity — not every source fills every field.
 */
export interface PimProduct {
  /** Stable identifier — Medusa product id or Kaggle row id. */
  id: string
  /** Primary display name. */
  title: string
  description?: string
  /** Top-level category (e.g. "Apparel", "Accessories"). */
  category?: string
  /** Narrower category (e.g. "Topwear", "Bottomwear"). */
  subcategory?: string
  /** Article type (e.g. "Shirts", "Jeans", "Track Pants"). */
  articleType?: string
  /** Audience: "Men" | "Women" | "Unisex" | "Boys" | "Girls". */
  gender?: string
  /** Base colour as a noun, not a hex. */
  color?: string
  /** "Fall" | "Winter" | "Summer" | "Spring". */
  season?: string
  year?: number
  /** "Casual" | "Formal" | "Sports" | "Ethnic" | "Smart Casual" etc. */
  usage?: string
  imageUrl?: string
  /** Medusa variant id — used to add the product to the shared cart. */
  variantId?: string
  /** Region-priced amount from Medusa (decimal euros, e.g. 49.99). */
  priceAmount?: number
  /** Provenance of this record. Lets the admin UI badge results. */
  source: 'medusa' | 'kaggle' | string
  /** Preserved original payload — useful for debug, ignored otherwise. */
  raw?: Record<string, unknown>
}

/**
 * The full output of the enrichment pipeline for one product.
 * Holds enough state to re-embed without going back to PIM.
 */
export interface EnrichedProduct {
  product: PimProduct
  /** Exact text that was fed to the embedding model. */
  embedText: string
  /** Length === `dimension`. */
  embedding: number[]
  embeddedAt: string
  model: string
  dimension: number
}

/**
 * Persisted record in the vector store. Bare minimum to:
 *   - rank against a query vector
 *   - render product context next to a search result
 *   - decide whether to re-embed (compare model + embedText hash)
 */
export interface VectorRecord {
  id: string
  embedding: number[]
  metadata: PimProduct
  embedText: string
  embeddedAt: string
  model: string
  dimension: number
}

export interface SearchResult {
  id: string
  /**
   * Cosine similarity in [-1, 1]. For unit-normalised vectors this
   * collapses to [0, 1] which is what the model produces.
   */
  score: number
  metadata: PimProduct
  /** Echoed back when the caller wants the inspector view. */
  embedding?: number[]
}

export interface SearchOpts {
  /** Limit search to records matching a predicate on metadata. */
  filter?: (record: VectorRecord) => boolean
  /** Drop results below this score. */
  minScore?: number
  /** When true, the returned SearchResult includes the full embedding. */
  includeEmbedding?: boolean
}

/**
 * The contract every vector store impl satisfies.
 *
 * LocalJsonVectorStore (default) → file-backed JSON.
 * SupabaseVectorStore             → pgvector behind RLS.
 *
 * All ops are async because the future impl is — keeping the present
 * impl async means callers never need to change shape.
 */
export interface VectorStore {
  upsert(record: VectorRecord): Promise<void>
  upsertMany(records: VectorRecord[]): Promise<void>
  search(query: number[], k: number, opts?: SearchOpts): Promise<SearchResult[]>
  get(id: string): Promise<VectorRecord | null>
  list(): Promise<VectorRecord[]>
  delete(id: string): Promise<void>
  count(): Promise<number>
  clear(): Promise<void>
}

/**
 * Per-product status surfaced in the admin table.
 */
export interface EnrichmentStatus {
  productId: string
  productTitle: string
  hasVector: boolean
  embeddedAt?: string
  model?: string
  embedText?: string
}

/**
 * Aggregate result of a sync run, surfaced in the admin UI.
 */
export interface SyncReport {
  startedAt: string
  finishedAt: string
  durationMs: number
  totalCandidates: number
  embedded: number
  skipped: number
  failed: number
  errors: { id: string; message: string }[]
}

/**
 * Embedder contract. The model identifier travels with every record
 * so callers can tell stale embeddings from current ones.
 */
export interface Embedder {
  readonly modelId: string
  readonly dimension: number
  embed(text: string): Promise<number[]>
  embedMany(texts: string[]): Promise<number[][]>
}

/**
 * Whatever fetches PimProducts. Two impls today; more later.
 */
export interface PimAdapter {
  readonly sourceName: string
  /** Pull every product the source knows about. */
  list(): Promise<PimProduct[]>
  /** Pull one by id; null if not found. */
  get(id: string): Promise<PimProduct | null>
}
