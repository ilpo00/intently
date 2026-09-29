// ─────────────────────────────────────────────────────────────────
// Intently · Enrichment — barrel
//
// One import surface for callers in API routes and the admin UI.
// Keeps the file layout discoverable without 8 different import
// lines at the top of each consumer.
// ─────────────────────────────────────────────────────────────────

export { buildEmbedText } from './enrich-text'
export { getEmbedder, DeterministicEmbedder, XenovaEmbedder } from './embedder'
export { getPimAdapter } from './pim-factory'
export { getVectorStore } from './vector-store-factory'
export { cosine, dot, norm, normalise } from './vector-math'
export {
  syncAll,
  syncOne,
  searchByText,
  getEnrichmentStatuses,
} from './pipeline'

export type {
  PimProduct,
  EnrichedProduct,
  VectorRecord,
  SearchResult,
  SearchOpts,
  SyncReport,
  EnrichmentStatus,
  Embedder,
  VectorStore,
  PimAdapter,
} from '@/types/enrichment'
