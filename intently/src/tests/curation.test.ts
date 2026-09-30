/**
 * @jest-environment node
 */
// ─────────────────────────────────────────────
// Curation state (product overrides + the needs-attention queue) persists
// through the doc-store, and a curated attribute reaches live discovery on
// the DEFAULT deterministic path — not only when vector retrieval is on.
// Hermetic: a temp cwd so the doc-store's <cwd>/.enrichment path is isolated.
// ─────────────────────────────────────────────

import { rmSync, mkdtempSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = mkdtempSync(join(tmpdir(), 'intently-cur-'))
const realCwd = process.cwd()
beforeAll(() => process.chdir(dir))
afterAll(() => { process.chdir(realCwd); rmSync(dir, { recursive: true, force: true }) })

import {
  readProductOverrides, writeProductOverrides, hasOverride, mergeProducts,
} from '@/lib/enrichment/product-overrides'
import { readAttentionState, setAttention } from '@/lib/enrichment/attention-state'
import { POST } from '@/app/api/discover/route'
import { _resetGuardrails } from '@/lib/discovery/guardrails'
import { getAllProducts } from '@/lib/data'

afterEach(() => { try { rmSync(join(dir, '.enrichment'), { recursive: true, force: true }) } catch { /* absent */ } })
beforeEach(() => _resetGuardrails())

function post(body: unknown): Request {
  return new Request('http://localhost/api/discover', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': 'curation-test' },
    body: JSON.stringify(body),
  })
}

describe('product overrides (doc-store backed)', () => {
  it('defaults to an empty map and round-trips a write', async () => {
    expect(await readProductOverrides()).toEqual({})
    await writeProductOverrides({ 'p-1': { pattern: 'floral' } })
    expect(await readProductOverrides()).toEqual({ 'p-1': { pattern: 'floral' } })
    expect(await hasOverride('p-1')).toBe(true)
    expect(await hasOverride('p-2')).toBe(false)
    // same on-disk location the pre-doc-store code used, so local data carries over
    expect(existsSync(join(dir, '.enrichment', 'product-overrides.json'))).toBe(true)
  })

  it('mergeProducts is the identity for an empty map and recomposes embed text otherwise', () => {
    const products = getAllProducts().slice(0, 3)
    expect(mergeProducts(products, {})).toBe(products)
    const merged = mergeProducts(products, { [products[0].id]: { pattern: 'floral' } })
    expect(merged[0].pattern).toBe('floral')
    expect(merged[0].embeddingText).toContain('floral')
    expect(merged[1]).toBe(products[1])
  })
})

describe('attention state (doc-store backed)', () => {
  it('stores only the exceptions; reopening clears the entry', async () => {
    expect(await readAttentionState()).toEqual({})
    await setAttention('p-1', 'dismissed', '  not an issue ')
    const state = await readAttentionState()
    expect(state['p-1'].status).toBe('dismissed')
    expect(state['p-1'].note).toBe('not an issue')
    await setAttention('p-1', 'open')
    expect(await readAttentionState()).toEqual({})
  })
})

describe('curation reaches deterministic discovery', () => {
  const QUERY = "dress for a friend's wedding in July, outdoors, smart casual, no florals"

  it('a product curated to floral drops out of a no-florals shortlist', async () => {
    const before = await (await POST(post({ query: QUERY }))).json()
    expect(before.updatedSession.exclusions).toContain('floral')
    expect(before.results.length).toBeGreaterThan(0)
    const target: string = before.results[0].product.id

    await writeProductOverrides({ [target]: { pattern: 'floral' } })
    _resetGuardrails()
    const after = await (await POST(post({ query: QUERY }))).json()
    const ids: string[] = after.results.map((r: { product: { id: string } }) => r.product.id)
    expect(ids).not.toContain(target)
  })
})
