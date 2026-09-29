// ─────────────────────────────────────────────────────────────────
// Intently · Enrichment — VectorStore factory
//
// Resolves the right impl from env. Memoised per-process so callers
// can `getVectorStore()` everywhere without thinking about identity.
//
//   ENRICHMENT_STORE=local      (default — file-backed JSON)
//   ENRICHMENT_STORE=supabase   (pgvector via @supabase/supabase-js)
//
// Why memoised: LocalJsonVectorStore caches all records in memory
// after the first read. A new instance per request would re-read the
// disk on every call.
//
// We static-import both impls. @supabase/supabase-js is already a
// dependency used by the account layer; the marginal cost of bundling
// the vector store impl alongside is negligible, and it keeps this
// factory synchronous (callers don't need to await it).
// ─────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js'

import type { VectorStore } from '@/types/enrichment'

import { LocalJsonVectorStore } from './vector-store-local'
import { SupabaseVectorStore } from './vector-store-supabase'

let cached: VectorStore | null = null

export function getVectorStore(): VectorStore {
  if (cached) return cached
  const mode = (process.env.ENRICHMENT_STORE ?? 'local').toLowerCase()
  if (mode === 'supabase') {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) {
      throw new Error(
        'ENRICHMENT_STORE=supabase requires NEXT_PUBLIC_SUPABASE_URL and a key',
      )
    }
    const client = createClient(url, key, {
      auth: { persistSession: false },
    })
    cached = new SupabaseVectorStore(client)
    return cached
  }
  cached = new LocalJsonVectorStore()
  return cached
}

/** Test helper — never call from app code. */
export function __resetVectorStoreForTests(): void {
  cached = null
}
