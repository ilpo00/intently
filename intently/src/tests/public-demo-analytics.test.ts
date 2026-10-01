/**
 * @jest-environment node
 */
// ─────────────────────────────────────────────
// On the open demo the analytics and situation-mining pages are public: one
// visitor must never read what another visitor typed. Every turn is still
// counted; only the text of real visitors' queries is withheld. The synthetic
// seed traffic ("demo-…" sessions) stays readable.
// ─────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = mkdtempSync(join(tmpdir(), 'intently-pd-analytics-'))
process.env.INTENTLY_EVENTS_DIR = dir

import { emitEvent, type TurnEvent } from '@/lib/analytics/events'
import { aggregate } from '@/lib/analytics/aggregate'
import { mineSituationSuggestions } from '@/lib/analytics/mine-situations'

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const turn = (sessionId: string, query: string): TurnEvent => ({
  type: 'turn', ts: new Date().toISOString(), sessionId, turn: 1,
  queryChars: query.length, query, escalated: false, answered: false,
  resultCount: 0, questionAsked: false, parse: null, generate: null, latencyMs: 20,
})

const PRIVATE = 'a dress for my sister anna’s wedding in turku'
const SEEDED = 'a festival outfit for a muddy weekend'

beforeAll(() => {
  for (let i = 0; i < 3; i++) emitEvent(turn('visitor-1', PRIVATE))
  for (let i = 0; i < 3; i++) emitEvent(turn('demo-abc12345', SEEDED))
})

const original = process.env.INTENTLY_PUBLIC_DEMO
afterEach(() => { process.env.INTENTLY_PUBLIC_DEMO = original })
const SINCE = '1970-01-01T00:00:00Z'

describe('public demo', () => {
  beforeEach(() => { process.env.INTENTLY_PUBLIC_DEMO = '1' })

  it('analytics counts visitor turns but never returns their text', async () => {
    const agg = await aggregate(SINCE)
    const texts = JSON.stringify([agg.topQueries, agg.zeroResultQueries])
    expect(texts).not.toContain('anna')
    expect(texts).toContain('festival')
    expect(agg.hiddenVisitorQueries).toBe(3)
    expect(agg.funnel.find(f => f.key === 'sessions')?.sessions).toBe(2) // still counted
  })

  it('situation mining suggests only from the synthetic traffic', async () => {
    const json = JSON.stringify(await mineSituationSuggestions([]))
    expect(json).not.toMatch(/anna|turku|sister/i)
  })
})

describe('private deployment', () => {
  it('shows every query to the operator', async () => {
    delete process.env.INTENTLY_PUBLIC_DEMO
    const agg = await aggregate(SINCE)
    expect(JSON.stringify(agg.topQueries)).toContain('anna')
    expect(agg.hiddenVisitorQueries).toBe(0)
  })
})
