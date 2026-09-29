// ─────────────────────────────────────────────
// Tests: src/lib/enrichment/pipeline.ts
//
// End-to-end-ish: real curated PIM adapter, real
// vector math, real local store (in tmpdir).
// Embedder is the deterministic one so CI doesn't
// need to download Xenova model weights.
//
// The point: prove the pipeline actually wires the
// pieces together and the search results make sense
// (the product whose embed text matches the query
// best ranks first).
// ─────────────────────────────────────────────

import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

beforeEach(async () => {
  // Each test gets a fresh on-disk store, a fresh embedder/store/adapter
  // singleton, and the deterministic embedder.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'intently-pipeline-'))
  process.env.ENRICHMENT_LOCAL_DIR = dir
  process.env.ENRICHMENT_EMBEDDER = 'deterministic'
  process.env.ENRICHMENT_STORE = 'local'
  process.env.PIM_SOURCE = 'kaggle'

  // Reset cached singletons.
  const { __resetVectorStoreForTests } = await import(
    '@/lib/enrichment/vector-store-factory'
  )
  const { __resetEmbedderForTests } = await import(
    '@/lib/enrichment/embedder'
  )
  const { __resetPimAdapterForTests } = await import(
    '@/lib/enrichment/pim-factory'
  )
  __resetVectorStoreForTests()
  __resetEmbedderForTests()
  __resetPimAdapterForTests()
})

describe('syncAll', () => {
  it('embeds every curated product', async () => {
    const { syncAll, getEnrichmentStatuses } = await import(
      '@/lib/enrichment'
    )
    const report = await syncAll()
    expect(report.totalCandidates).toBe(10)
    expect(report.embedded).toBe(10)
    expect(report.failed).toBe(0)

    const statuses = await getEnrichmentStatuses()
    expect(statuses.every((s) => s.hasVector)).toBe(true)
  })
})

describe('syncOne', () => {
  it('re-embeds a single product', async () => {
    const { syncOne, getVectorStore } = await import('@/lib/enrichment')
    const report = await syncOne('kaggle-15970')
    expect(report.embedded).toBe(1)
    expect(report.failed).toBe(0)
    const rec = await getVectorStore().get('kaggle-15970')
    expect(rec).not.toBeNull()
    expect(rec?.metadata.title).toContain('Turtle Check')
  })

  it('reports a clean failure for an unknown id', async () => {
    const { syncOne } = await import('@/lib/enrichment')
    const report = await syncOne('not-a-real-id')
    expect(report.failed).toBe(1)
    expect(report.errors[0].message).toMatch(/not found/)
  })
})

describe('searchByText (deterministic embedder)', () => {
  it('ranks the product whose embed text overlaps the query most', async () => {
    const { syncAll, searchByText } = await import('@/lib/enrichment')
    await syncAll()
    // Query reusing words from the t-shirt product's embed text.
    const out = await searchByText('Basics Men Orange Striped Polo Tshirt', 3)
    expect(out.results.length).toBe(3)
    expect(out.results[0].id).toBe('kaggle-2147')
  })

  it('returns query vector and model id', async () => {
    const { syncAll, searchByText } = await import('@/lib/enrichment')
    await syncAll()
    const out = await searchByText('navy shirt', 2)
    expect(out.queryEmbedding.length).toBe(384)
    expect(out.model).toBe('deterministic-hash-v1')
  })

  it('respects k', async () => {
    const { syncAll, searchByText } = await import('@/lib/enrichment')
    await syncAll()
    const out = await searchByText('blue', 4)
    expect(out.results.length).toBe(4)
  })
})

describe('getEnrichmentStatuses (no sync yet)', () => {
  it('returns all PIM products with hasVector=false', async () => {
    const { getEnrichmentStatuses } = await import('@/lib/enrichment')
    const statuses = await getEnrichmentStatuses()
    expect(statuses.length).toBe(10)
    expect(statuses.every((s) => !s.hasVector)).toBe(true)
  })
})
