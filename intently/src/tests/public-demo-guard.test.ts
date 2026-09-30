/**
 * @jest-environment node
 */
// ─────────────────────────────────────────────
// The public-demo cost guard (INTENTLY_PUBLIC_DEMO=1). With the password gate
// gone, anyone can call the admin API directly — so "the Studio never spends
// money and never changes shared data" has to hold at the ROUTE, not the UI:
//   · cost/shared-mutation routes answer 403 and make no outbound call;
//   · a visitor's config can never raise the cost caps or pick a model id;
//   · the model bench serves recordings and never reaches an LLM;
//   · "reset" only drops the visitor's own changes.
// ─────────────────────────────────────────────

import { rmSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = mkdtempSync(join(tmpdir(), 'intently-guard-'))
const realCwd = process.cwd()
beforeAll(() => process.chdir(dir))
afterAll(() => { process.chdir(realCwd); rmSync(dir, { recursive: true, force: true }) })

let session: string | null = 'a'.repeat(32)
jest.mock('@/lib/public-demo', () => ({
  ...jest.requireActual('@/lib/public-demo'),
  currentSandboxId: async () => session,
}))

// The enrichment pipeline (embeddings + vector store) must not be touched.
const syncAll = jest.fn()
const syncOne = jest.fn()
const vectorDelete = jest.fn()
jest.mock('@/lib/enrichment', () => ({
  syncAll: (...a: unknown[]) => syncAll(...a),
  syncOne: (...a: unknown[]) => syncOne(...a),
  getVectorStore: () => ({ delete: vectorDelete, get: jest.fn() }),
  cosine: jest.fn(),
  searchByText: jest.fn(),
}))

const FIXTURE = {
  model: 'test-model',
  recordedAt: '2026-09-30',
  parse: { ok: true, ms: 900, patch: { addExclusions: ['black'] } },
  generate: { ok: true, ms: 1200, message: 'Recorded prose.', prompt: null, grounded: true },
}
jest.mock('@/lib/discovery/probe-fixtures', () => ({
  PROBE_SAMPLE_QUERIES: ['a recorded sample query'],
  lookupProbeFixture: (_p: string, q: string) => (q === 'a recorded sample query' ? FIXTURE : null),
}))

import { POST as visionPost, DELETE as visionDelete } from '@/app/api/admin/vision-enrich/route'
import { POST as syncPost } from '@/app/api/enrichment/sync/route'
import { POST as syncOnePost } from '@/app/api/enrichment/sync/[id]/route'
import { DELETE as vectorDeleteRoute } from '@/app/api/enrichment/vectors/[id]/route'
import { POST as resetPost } from '@/app/api/admin/reset/route'
import { PUT as productPut } from '@/app/api/enrichment/products/[id]/route'
import { POST as probePost } from '@/app/api/discover/probe/route'
import { GET as configGet, PUT as configPut, DELETE as configDelete } from '@/app/api/admin/config/route'
import { readRuntimeConfig, writeRuntimeConfig, runtimeConfigDefaults } from '@/lib/discovery/runtime-config'
import { readDoc, writeDoc, readBaseDoc } from '@/lib/store/doc-store'
import { _resetSandboxMemory } from '@/lib/store/sandbox'
import { _resetGuardrails } from '@/lib/discovery/guardrails'
import { getAllProducts } from '@/lib/data'

const json = (body: unknown, method = 'POST') =>
  new Request('http://localhost/x', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const params = (id: string) => ({ params: Promise.resolve({ id }) })

const original = { ...process.env }
const realFetch = global.fetch
let fetchSpy: jest.Mock

beforeEach(() => {
  process.env = { ...original, INTENTLY_PUBLIC_DEMO: '1' }
  for (const k of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'DISCOVERY_PARSER', 'DISCOVERY_GENERATION', 'INTENTLY_STORE']) {
    delete process.env[k]
  }
  // Keys present: proves the guard, not a missing key, is what prevents a call.
  process.env.DEEPSEEK_API_KEY = 'test-key'
  process.env.OPENAI_API_KEY = 'test-key'
  process.env.ANTHROPIC_API_KEY = 'test-key'
  fetchSpy = jest.fn(async () => { throw new Error('network call attempted in public-demo mode') })
  global.fetch = fetchSpy as unknown as typeof fetch
  syncAll.mockReset(); syncOne.mockReset(); vectorDelete.mockReset()
  _resetSandboxMemory(); _resetGuardrails()
  session = 'a'.repeat(32)
})
afterEach(() => {
  process.env = { ...original }
  global.fetch = realFetch
  try { rmSync(join(dir, '.enrichment'), { recursive: true, force: true }) } catch { /* absent */ }
})

describe('cost / shared-mutation routes are refused', () => {
  const cases: Array<[string, () => Promise<Response>]> = [
    ['vision enrichment run', () => visionPost(json({ scope: 'catalog' }))],
    ['vision enrichment clear', () => visionDelete(json({ scope: 'catalog' }, 'DELETE'))],
    ['catalogue sync', () => syncPost()],
    ['single-product re-embed', () => syncOnePost(json({}), params('p-1'))],
    ['vector delete', () => vectorDeleteRoute(json({}, 'DELETE'), params('p-1'))],
  ]

  it.each(cases)('%s → 403, no outbound call', async (_name, call) => {
    const res = await call()
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.publicDemo).toBe(true)
    expect(typeof body.message).toBe('string')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(syncAll).not.toHaveBeenCalled()
    expect(syncOne).not.toHaveBeenCalled()
    expect(vectorDelete).not.toHaveBeenCalled()
  })

  it('the same routes are not refused when the flag is off', async () => {
    delete process.env.INTENTLY_PUBLIC_DEMO
    syncAll.mockResolvedValue({ synced: 0, failed: 0 })
    const res = await syncPost()
    expect(res.status).not.toBe(403)
    expect(syncAll).toHaveBeenCalled()
  })
})

describe('curating a product', () => {
  it('saves to the visitor sandbox and skips the re-embed', async () => {
    const id = getAllProducts()[0].id
    const res = await productPut(json({ pattern: 'floral' }, 'PUT'), params(id))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reembed).toBe('simulated')
    expect(body.product.pattern).toBe('floral')
    expect(syncOne).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await readDoc('product-overrides')).toEqual({ [id]: { pattern: 'floral' } })
    expect(await readBaseDoc('product-overrides')).toBeNull()
  })
})

describe('runtime config cannot raise spend', () => {
  it('ignores a visitor\'s cost caps and model ids, on write and on read', async () => {
    const base = runtimeConfigDefaults()
    const saved = await writeRuntimeConfig({
      parse: { provider: 'openai', model: 'some-expensive-model' },
      generation: { provider: 'haiku', model: 'another-expensive-model' },
      limits: { llmDailyCap: 999_999, ratePerMin: 99_999, ratePerDay: 9_999_999, escalateMinWords: 3 },
      experiment: {
        enabled: true, splitPct: 100,
        b: { parse: { provider: 'openai', model: 'pricey' }, generation: { provider: 'openai', model: 'pricey' } },
      },
    })
    for (const cfg of [saved, await readRuntimeConfig()]) {
      expect(cfg.limits.llmDailyCap).toBe(base.limits.llmDailyCap)
      expect(cfg.limits.ratePerMin).toBe(base.limits.ratePerMin)
      expect(cfg.limits.ratePerDay).toBe(base.limits.ratePerDay)
      expect(cfg.parse).toEqual({ provider: 'openai', model: null })
      expect(cfg.generation).toEqual({ provider: 'haiku', model: null })
      expect(cfg.experiment?.b.parse.model).toBeNull()
      expect(cfg.experiment?.b.generation.model).toBeNull()
      // behaviour knobs stay the visitor's
      expect(cfg.limits.escalateMinWords).toBe(3)
      expect(cfg.experiment?.splitPct).toBe(100)
    }
  })

  it('cannot be bypassed by writing the document directly', async () => {
    await writeDoc('runtime-config', {
      parse: { provider: 'openai', model: 'pricey' },
      limits: { llmDailyCap: 999_999 },
    })
    const cfg = await readRuntimeConfig()
    expect(cfg.limits.llmDailyCap).toBe(runtimeConfigDefaults().limits.llmDailyCap)
    expect(cfg.parse.model).toBeNull()
  })

  it('takes the caps from the shared config, not the env default, when an operator set them', async () => {
    mkdirSync(join(dir, '.enrichment'), { recursive: true })
    writeFileSync(join(dir, '.enrichment', 'runtime-config.json'), JSON.stringify({ limits: { llmDailyCap: 123 } }))
    await writeRuntimeConfig({ ...runtimeConfigDefaults(), limits: { ...runtimeConfigDefaults().limits, llmDailyCap: 50_000 } })
    expect((await readRuntimeConfig()).limits.llmDailyCap).toBe(123)
  })
})

describe('model bench never reaches a model', () => {
  it('serves the recording for a sample query', async () => {
    const res = await probePost(json({ query: 'a recorded sample query', provider: 'openai' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.publicDemo).toBe(true)
    expect(body.recorded).toBe(true)
    expect(body.generate.message).toBe('Recorded prose.')
    expect(body.parse.patch).toEqual({ addExclusions: ['black'] })
    expect(Array.isArray(body.engine.results)).toBe(true) // engine ran live
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('falls back to deterministic-only, with a note, for any other query', async () => {
    const res = await probePost(json({ query: 'a blue shirt for the weekend', provider: 'deepseek', model: 'anything' }))
    const body = await res.json()
    expect(body.recorded).toBe(false)
    expect(body.parse).toBeNull()
    expect(body.generate).toBeNull()
    expect(body.note).toMatch(/switched off in the public demo/)
    expect(body.samples).toEqual(['a recorded sample query'])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('reset', () => {
  it('drops only the visitor\'s own changes and never the shared data', async () => {
    mkdirSync(join(dir, '.enrichment'), { recursive: true })
    writeFileSync(join(dir, '.enrichment', 'situation-active.json'), JSON.stringify({ ids: ['shared'] }))
    await writeDoc('situation-active', { ids: ['mine'] })

    const res = await resetPost(json({ confirm: 'RESET', targets: ['demoState', 'enriched', 'analytics'] }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.publicDemo).toBe(true)
    expect(await readDoc('situation-active')).toEqual({ ids: ['shared'] })
    expect(await readBaseDoc('situation-active')).toEqual({ ids: ['shared'] })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('config API', () => {
  it('returns resolved values (not pending promises) and a clamped config after a visitor PUT', async () => {
    const base = runtimeConfigDefaults()
    const put = await configPut(json({
      parse: { provider: 'deepseek', model: 'pricey' },
      generation: { provider: 'haiku', model: 'pricey' },
      limits: { llmDailyCap: 999_999, ratePerMin: 99_999, ratePerDay: 9_999_999, escalateMinWords: 3 },
      experiment: null,
    }, 'PUT'))
    const saved = await put.json()
    expect(saved.config.parse).toEqual({ provider: 'deepseek', model: null })
    expect(saved.config.limits.llmDailyCap).toBe(base.limits.llmDailyCap)
    expect(saved.overridden).toBe(true)

    const got = await (await configGet()).json()
    expect(got.config.generation).toEqual({ provider: 'haiku', model: null })
    expect(got.config.limits.ratePerMin).toBe(base.limits.ratePerMin)

    const reverted = await (await configDelete()).json()
    expect(reverted.overridden).toBe(false)
    expect(reverted.config.parse).toEqual(base.parse)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
