/**
 * @jest-environment node
 *
 * ─────────────────────────────────────────────────────────────────
 * LIVE integration: the full PIM→discovery chain against a running
 * Dockerized Medusa (pim/).
 *
 *   MedusaPimAdapter (REST) → syncAll (embed + store) → searchByText
 *   → vectorRetrieve → pimProductToProduct (the seam) → river Product
 *
 * Runs in the `node` environment (jsdom doesn't give us a usable fetch).
 * Skips entirely unless MEDUSA_PUBLISHABLE_KEY + MEDUSA_BACKEND_URL are set,
 * so CI (no Medusa) stays green. Run it against the live PIM with:
 *
 *   MEDUSA_BACKEND_URL=http://localhost:9000 \
 *   MEDUSA_PUBLISHABLE_KEY=pk_... \
 *   npx jest src/tests/medusa-integration.test.ts
 *
 * Uses the deterministic embedder (no model download); assertions cover the
 * PLUMBING (provenance, id alignment, projection to a renderable Product),
 * not semantic ranking.
 * ─────────────────────────────────────────────────────────────────
 */

import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const RUN = Boolean(process.env.MEDUSA_PUBLISHABLE_KEY && process.env.MEDUSA_BACKEND_URL)
const d = RUN ? describe : describe.skip

d('Medusa PIM integration (live)', () => {
  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'intently-medusa-'))
    process.env.ENRICHMENT_LOCAL_DIR = dir
    process.env.ENRICHMENT_EMBEDDER = 'deterministic' // no model download
    process.env.ENRICHMENT_STORE = 'local'
    process.env.PIM_SOURCE = 'medusa'
    process.env.DISCOVERY_RETRIEVAL = 'vector'

    const { __resetVectorStoreForTests } = await import('@/lib/enrichment/vector-store-factory')
    const { __resetEmbedderForTests } = await import('@/lib/enrichment/embedder')
    const { __resetPimAdapterForTests } = await import('@/lib/enrichment/pim-factory')
    __resetVectorStoreForTests()
    __resetEmbedderForTests()
    __resetPimAdapterForTests()
  })

  it('pulls and embeds the live Medusa catalogue', async () => {
    const { syncAll } = await import('@/lib/enrichment')
    const report = await syncAll()
    expect(report.totalCandidates).toBeGreaterThanOrEqual(250)
    expect(report.embedded).toBe(report.totalCandidates)
    expect(report.failed).toBe(0)
  }, 60_000)

  it('keys results by the river-aligned intentlyId, badged source=medusa', async () => {
    const { syncAll, searchByText } = await import('@/lib/enrichment')
    await syncAll()
    const { results } = await searchByText('summer dress', 5)
    expect(results.length).toBe(5)
    for (const r of results) {
      expect(r.id).toMatch(/^k\d+$/)          // not Medusa's prod_… id
      expect(r.metadata.source).toBe('medusa')
    }
  }, 60_000)

  it('projects Medusa products into renderable river Products (the seam)', async () => {
    const { syncAll } = await import('@/lib/enrichment')
    await syncAll()
    const { vectorRetrieve } = await import('@/lib/discovery/retrieve')
    const products = await vectorRetrieve('a dress for an outdoor summer wedding', 'fashion', 12)
    expect(products).not.toBeNull()
    expect(products!.length).toBeGreaterThan(0)
    for (const p of products!) {
      expect(p.id).toMatch(/^k\d+$/)
      expect(p.catalog).toBe('fashion')       // catalog filter honoured via projection
      expect(typeof p.price).toBe('number')   // fully-formed, renderable
      expect(Array.isArray(p.occasionTags)).toBe(true)
    }
  }, 60_000)
})
