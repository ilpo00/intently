// ─────────────────────────────────────────────────────────────────
// Intently · Enrichment — Pipeline orchestrator
//
// Wires the four interfaces together:
//   PimAdapter → enrich-text → Embedder → VectorStore
//
// Two entry points:
//   syncAll()  — fetch everything from PIM, embed, upsert. The
//                button in the admin UI calls this.
//   syncOne(id)— same but for a single product. Powers the per-row
//                "re-embed" action.
//
// Both surface a SyncReport so the UI can show what changed.
//
// Search is also here, even though it's just three lines, because
// "where is the search logic?" deserves a single obvious answer.
// ─────────────────────────────────────────────────────────────────

import type {
  EnrichmentStatus,
  PimProduct,
  SearchOpts,
  SearchResult,
  SyncReport,
  VectorRecord,
} from '@/types/enrichment'

import { getEmbedder } from './embedder'
import { buildEmbedText } from './enrich-text'
import { getPimAdapter } from './pim-factory'
import { getVectorStore } from './vector-store-factory'

async function embedProduct(
  product: PimProduct,
): Promise<VectorRecord> {
  const embedder = getEmbedder()
  const embedText = buildEmbedText(product)
  const embedding = await embedder.embed(embedText)
  return {
    id: product.id,
    embedding,
    metadata: product,
    embedText,
    embeddedAt: new Date().toISOString(),
    model: embedder.modelId,
    dimension: embedder.dimension,
  }
}

// Products per embedMany call. Batching matters on hosted embedders
// (OpenAI): 292 serial embed() calls ≈ 45–90s — past Vercel's function
// timeout — while chunked embedMany is 3 round-trips ≈ 2–4s. Xenova
// batches natively, so this is neutral-to-faster locally too.
const SYNC_CHUNK = 64

export async function syncAll(): Promise<SyncReport> {
  const started = Date.now()
  const pim = getPimAdapter()
  const store = getVectorStore()
  const embedder = getEmbedder()
  const products = await pim.list()
  const records: VectorRecord[] = []
  const errors: SyncReport['errors'] = []

  for (let i = 0; i < products.length; i += SYNC_CHUNK) {
    const chunk = products.slice(i, i + SYNC_CHUNK)
    const embeddedAt = new Date().toISOString()
    try {
      const texts = chunk.map((p) => buildEmbedText(p))
      const embeddings = await embedder.embedMany(texts)
      chunk.forEach((p, j) => {
        records.push({
          id: p.id,
          embedding: embeddings[j],
          metadata: p,
          embedText: texts[j],
          embeddedAt,
          model: embedder.modelId,
          dimension: embedder.dimension,
        })
      })
    } catch {
      // Batch failed — retry per product so one bad input doesn't take
      // down the chunk, and the report stays per-product granular.
      for (const p of chunk) {
        try {
          records.push(await embedProduct(p))
        } catch (err) {
          errors.push({ id: p.id, message: (err as Error).message })
        }
      }
    }
  }

  await store.upsertMany(records)

  return {
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    totalCandidates: products.length,
    embedded: records.length,
    skipped: 0,
    failed: errors.length,
    errors,
  }
}

export async function syncOne(productId: string): Promise<SyncReport> {
  const started = Date.now()
  const pim = getPimAdapter()
  const store = getVectorStore()
  const product = await pim.get(productId)
  const errors: SyncReport['errors'] = []

  if (!product) {
    return {
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      totalCandidates: 0,
      embedded: 0,
      skipped: 0,
      failed: 1,
      errors: [{ id: productId, message: 'not found in PIM' }],
    }
  }

  try {
    const record = await embedProduct(product)
    await store.upsert(record)
    return {
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      totalCandidates: 1,
      embedded: 1,
      skipped: 0,
      failed: 0,
      errors,
    }
  } catch (err) {
    return {
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      totalCandidates: 1,
      embedded: 0,
      skipped: 0,
      failed: 1,
      errors: [{ id: productId, message: (err as Error).message }],
    }
  }
}

export async function searchByText(
  query: string,
  k = 5,
  opts?: SearchOpts,
): Promise<{
  query: string
  queryEmbedding: number[]
  results: SearchResult[]
  model: string
}> {
  const embedder = getEmbedder()
  const store = getVectorStore()
  const queryEmbedding = await embedder.embed(query)
  const results = await store.search(queryEmbedding, k, opts)
  return {
    query,
    queryEmbedding,
    results,
    model: embedder.modelId,
  }
}

/**
 * Vector-store reads for the admin surfaces, degraded rather than thrown.
 * The Studio is an inspector: if the store is unreachable (a paused hosted
 * database, a network blip) it should render "0 indexed" and log, not take the
 * whole page down to the error screen. Discovery has its own fallback.
 */
export async function vectorRecordsOrEmpty() {
  try {
    return await getVectorStore().list()
  } catch (err) {
    console.error('[enrichment] vector store unavailable (list):', err instanceof Error ? err.message : err)
    return []
  }
}

export async function vectorCountOrZero(): Promise<number> {
  try {
    return await getVectorStore().count()
  } catch (err) {
    console.error('[enrichment] vector store unavailable (count):', err instanceof Error ? err.message : err)
    return 0
  }
}

/**
 * Surface every product the PIM knows about, joined with what the
 * vector store has. Powers the admin table.
 */
export async function getEnrichmentStatuses(): Promise<EnrichmentStatus[]> {
  const pim = getPimAdapter()
  const [products, records] = await Promise.all([pim.list(), vectorRecordsOrEmpty()])
  const byId = new Map<string, (typeof records)[number]>()
  for (const r of records) byId.set(r.id, r)

  return products.map<EnrichmentStatus>((p) => {
    const rec = byId.get(p.id)
    return {
      productId: p.id,
      productTitle: p.title,
      hasVector: !!rec,
      embeddedAt: rec?.embeddedAt,
      model: rec?.model,
      embedText: rec?.embedText,
    }
  })
}
