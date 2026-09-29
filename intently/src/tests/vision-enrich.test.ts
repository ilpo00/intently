/**
 * @jest-environment node
 *
 * Vision enrichment: the Tier-0 validator (the contract between an
 * unpredictable model and the discovery layer) and the store's incremental
 * append/clear semantics that make a chunked, resumable run safe.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { validate, parseJson } from '@/lib/enrichment/vision/enrich'
import type { VisionRecord } from '@/types/vision'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vision-store-'))
  process.env.INTENTLY_VISION_DIR = dir
  delete process.env.INTENTLY_STORE // force the local backend
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.INTENTLY_VISION_DIR
  jest.resetModules()
})

// The store reads env at call time, but importing fresh keeps each test honest.
async function store() {
  return await import('@/lib/enrichment/vision/store')
}

const rec = (id: string, tokens = 100): VisionRecord => ({
  id,
  image: `/catalog/${id}.webp`,
  vision: {
    garmentType: 'shirt', primaryColour: 'navy', colours: ['navy'], pattern: 'solid',
    materials: ['cotton'], silhouette: 'relaxed', formality: 2, seasons: ['summer'],
    occasions: ['office'], styleArchetypes: ['classic'], description: 'A navy shirt.', confidence: 0.9,
  },
  flags: [],
  usage: { input: tokens, output: tokens },
  model: 'claude-haiku-4-5-20251001',
  ms: 1200,
})

describe('Tier-0 validator', () => {
  it('clamps formality into 1..5 and flags the correction', () => {
    const { out, flags } = validate({ formality: 9 })
    expect(out.formality).toBe(5)
    expect(flags.join(' ')).toContain('formality')
  })

  it('drops style archetypes outside the controlled vocabulary', () => {
    const { out, flags } = validate({ styleArchetypes: ['classic', 'casual', 'nonsense'] })
    expect(out.styleArchetypes).toEqual(['classic'])
    expect(flags.join(' ')).toContain('dropped styles')
  })

  it('coerces an unknown pattern to "other" rather than trusting the model', () => {
    const { out, flags } = validate({ pattern: 'paisley' })
    expect(out.pattern).toBe('other')
    expect(flags.join(' ')).toContain('paisley')
  })

  it('keeps at most three discovery queries', () => {
    const { out } = validate({ discoveryQueries: ['a', 'b', 'c', 'd', 'e'] })
    expect(out.discoveryQueries).toHaveLength(3)
  })

  it('survives a model that wraps its JSON in a fenced block', () => {
    const parsed = parseJson('Sure!\n```json\n{"garmentType":"coat"}\n```')
    expect(validate(parsed).out.garmentType).toBe('coat')
  })
})

describe('vision store (local backend)', () => {
  it('round-trips records and derives the report from them', async () => {
    const { appendVisionRecords, readVisionReport } = await store()
    await appendVisionRecords('sample', [rec('a', 100), rec('b', 200)])

    const report = await readVisionReport('sample')
    expect(report).not.toBeNull()
    expect(report!.count).toBe(2)
    expect(report!.ok).toBe(2)
    // 100+200 in, 100+200 out
    expect(report!.tokens.total).toBe(600)
  })

  it('upserts by id, so a retried chunk cannot double-count', async () => {
    const { appendVisionRecords, readVisionRecords } = await store()
    await appendVisionRecords('sample', [rec('a'), rec('b')])
    await appendVisionRecords('sample', [rec('b'), rec('c')]) // b overlaps

    const ids = (await readVisionRecords('sample')).map(r => r.id).sort()
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('keeps scopes independent', async () => {
    const { appendVisionRecords, readVisionRecords } = await store()
    await appendVisionRecords('sample', [rec('a')])
    await appendVisionRecords('catalog', [rec('x'), rec('y')])

    expect(await readVisionRecords('sample')).toHaveLength(1)
    expect(await readVisionRecords('catalog')).toHaveLength(2)
  })

  it('clears one scope only, and clearing twice is not an error', async () => {
    const { appendVisionRecords, clearVisionRecords, readVisionRecords } = await store()
    await appendVisionRecords('sample', [rec('a')])
    await appendVisionRecords('catalog', [rec('x')])

    await clearVisionRecords('sample')
    await clearVisionRecords('sample') // idempotent

    expect(await readVisionRecords('sample')).toEqual([])
    expect(await readVisionRecords('catalog')).toHaveLength(1)
  })

  it('reports nothing enriched as a null report, not an empty shell', async () => {
    const { readVisionReport } = await store()
    expect(await readVisionReport('sample')).toBeNull()
  })

  it('counts a failed product in the total but not in ok', async () => {
    const { appendVisionRecords, readVisionReport } = await store()
    await appendVisionRecords('sample', [
      rec('a'),
      { id: 'b', image: '/catalog/b.webp', error: 'image unreadable' },
    ])

    const report = await readVisionReport('sample')
    expect(report!.count).toBe(2)
    expect(report!.ok).toBe(1)
  })
})
