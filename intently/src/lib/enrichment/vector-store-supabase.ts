// ─────────────────────────────────────────────────────────────────
// Intently · Enrichment — Supabase pgvector store
//
// Queries-ready impl that talks to a Supabase Postgres with the
// pgvector extension installed. Schema lives at:
//   intently/supabase/migrations/0010_enrichment_vectors.sql
//
// At time of writing, the user has not provisioned Supabase yet —
// this file is intentionally untouched by the factory until
// ENRICHMENT_STORE=supabase is set. It is included now so the
// migration path is *code-complete*, not just documented.
//
// Why an RPC for search instead of a raw `from()` query?
//   The `<=>` cosine-distance operator is not first-class in
//   `@supabase/supabase-js`. Wrapping the SQL in a SECURITY DEFINER
//   function keeps the syntax inside Postgres where it belongs and
//   gives us a stable RPC name (`enrichment_search`).
// ─────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'

import type {
  SearchOpts,
  SearchResult,
  VectorRecord,
  VectorStore,
} from '@/types/enrichment'

interface SupabaseRow {
  id: string
  embedding: number[] | string // pgvector → JS may arrive as string in some clients
  embed_text: string
  embedded_at: string
  model: string
  dimension: number
  metadata: Record<string, unknown>
}

interface SearchRow {
  id: string
  similarity: number
  metadata: Record<string, unknown>
  embedding?: number[] | string
}

function parseEmbedding(v: number[] | string): number[] {
  if (Array.isArray(v)) return v
  // pgvector arrives as e.g. "[0.1,0.2,...]"
  return JSON.parse(v) as number[]
}

function rowToRecord(row: SupabaseRow): VectorRecord {
  return {
    id: row.id,
    embedding: parseEmbedding(row.embedding),
    // metadata is stored as jsonb; we trust the schema constraint that
    // sync only writes serialised PimProduct objects.
    metadata: row.metadata as unknown as VectorRecord['metadata'],
    embedText: row.embed_text,
    embeddedAt: row.embedded_at,
    model: row.model,
    dimension: row.dimension,
  }
}

export class SupabaseVectorStore implements VectorStore {
  constructor(private client: SupabaseClient) {}

  async upsert(record: VectorRecord): Promise<void> {
    const { error } = await this.client.from('product_vectors').upsert(
      {
        id: record.id,
        embedding: record.embedding,
        embed_text: record.embedText,
        embedded_at: record.embeddedAt,
        model: record.model,
        dimension: record.dimension,
        metadata: record.metadata,
      },
      { onConflict: 'id' },
    )
    if (error) throw new Error(`supabase upsert: ${error.message}`)
  }

  async upsertMany(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return
    const rows = records.map((r) => ({
      id: r.id,
      embedding: r.embedding,
      embed_text: r.embedText,
      embedded_at: r.embeddedAt,
      model: r.model,
      dimension: r.dimension,
      metadata: r.metadata,
    }))
    const { error } = await this.client
      .from('product_vectors')
      .upsert(rows, { onConflict: 'id' })
    if (error) throw new Error(`supabase upsertMany: ${error.message}`)
  }

  async search(
    query: number[],
    k: number,
    opts?: SearchOpts,
  ): Promise<SearchResult[]> {
    // RPC: takes query_embedding vector(384), match_count int, optional min_score real.
    // Defined in 0010_enrichment_vectors.sql.
    const { data, error } = await this.client.rpc('enrichment_search', {
      query_embedding: query,
      match_count: k,
      min_score: opts?.minScore ?? null,
    })
    if (error) throw new Error(`supabase search: ${error.message}`)

    const rows = (data ?? []) as SearchRow[]
    let results: SearchResult[] = rows.map((row) => ({
      id: row.id,
      score: row.similarity,
      metadata: row.metadata as unknown as SearchResult['metadata'],
      ...(opts?.includeEmbedding && row.embedding
        ? { embedding: parseEmbedding(row.embedding) }
        : {}),
    }))

    // Filter is client-side because Postgres can't evaluate a JS
    // closure. The minScore is server-side via the RPC param.
    if (opts?.filter) {
      // Materialise records for filter — extra round trip on the rare
      // path. Worth the simplicity.
      const ids = results.map((r) => r.id)
      if (ids.length > 0) {
        const { data: recs } = await this.client
          .from('product_vectors')
          .select('*')
          .in('id', ids)
        const byId = new Map<string, SupabaseRow>(
          (recs ?? []).map((r) => [r.id, r as SupabaseRow]),
        )
        results = results.filter((res) => {
          const row = byId.get(res.id)
          if (!row) return false
          return opts.filter!(rowToRecord(row))
        })
      }
    }

    return results.slice(0, k)
  }

  async get(id: string): Promise<VectorRecord | null> {
    const { data, error } = await this.client
      .from('product_vectors')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(`supabase get: ${error.message}`)
    if (!data) return null
    return rowToRecord(data as SupabaseRow)
  }

  async list(): Promise<VectorRecord[]> {
    const { data, error } = await this.client
      .from('product_vectors')
      .select('*')
      .order('embedded_at', { ascending: false })
    if (error) throw new Error(`supabase list: ${error.message}`)
    return (data ?? []).map((r) => rowToRecord(r as SupabaseRow))
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client
      .from('product_vectors')
      .delete()
      .eq('id', id)
    if (error) throw new Error(`supabase delete: ${error.message}`)
  }

  async count(): Promise<number> {
    const { count, error } = await this.client
      .from('product_vectors')
      .select('*', { count: 'exact', head: true })
    if (error) throw new Error(`supabase count: ${error.message}`)
    return count ?? 0
  }

  async clear(): Promise<void> {
    const { error } = await this.client
      .from('product_vectors')
      .delete()
      .neq('id', '__never_matches__') // delete-all without a WHERE is rejected
    if (error) throw new Error(`supabase clear: ${error.message}`)
  }
}
