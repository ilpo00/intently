// ─────────────────────────────────────────────────────────────────
// Intently · Enrichment — VectorStore re-export
//
// Re-exports the contract from `@/types/enrichment` and the factory
// so callers do one import:
//
//   import { getVectorStore, VectorStore } from '@/lib/enrichment/vector-store'
//
// The factory's behaviour (local vs supabase) is controlled by
// ENRICHMENT_STORE; see vector-store-factory.ts.
// ─────────────────────────────────────────────────────────────────

export type {
  VectorStore,
  VectorRecord,
  SearchResult,
  SearchOpts,
} from '@/types/enrichment'

export { getVectorStore } from './vector-store-factory'
