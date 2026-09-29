/**
 * @jest-environment node
 */
// ─────────────────────────────────────────────
// Online A/B: sticky deterministic arm assignment, config coercion, the
// route tagging turn events with the arm, and per-arm aggregation.
// Hermetic: own events dir + own runtime-config path.
// ─────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const eventsDir = mkdtempSync(join(tmpdir(), 'intently-ab-events-'))
const cfgDir = mkdtempSync(join(tmpdir(), 'intently-ab-cfg-'))
process.env.INTENTLY_EVENTS_DIR = eventsDir
process.env.INTENTLY_RUNTIME_CONFIG_PATH = join(cfgDir, 'runtime-config.json')

import { armFor, writeRuntimeConfig, readRuntimeConfig, type ExperimentConfig } from '@/lib/discovery/runtime-config'
import { POST } from '@/app/api/discover/route'
import { readEvents, type TurnEvent } from '@/lib/analytics/events'
import { aggregate } from '@/lib/analytics/aggregate'
import { _resetGuardrails } from '@/lib/discovery/guardrails'

afterAll(() => {
  rmSync(eventsDir, { recursive: true, force: true })
  rmSync(cfgDir, { recursive: true, force: true })
})

const EXP: ExperimentConfig = {
  enabled: true, splitPct: 50,
  b: { parse: { provider: 'off', model: null }, generation: { provider: 'off', model: null } },
}

describe('armFor', () => {
  it('is deterministic and sticky per session id', () => {
    for (const sid of ['alpha', 'beta', 'gamma']) {
      expect(armFor(sid, EXP)).toBe(armFor(sid, EXP))
    }
  })
  it('always A when disabled or without a session id', () => {
    expect(armFor('alpha', null)).toBe('A')
    expect(armFor('alpha', { ...EXP, enabled: false })).toBe('A')
    expect(armFor(undefined, EXP)).toBe('A')
  })
  it('splitPct 0 → all A; 100 → all B', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `s${i}`)
    expect(ids.every(id => armFor(id, { ...EXP, splitPct: 0 }) === 'A')).toBe(true)
    expect(ids.every(id => armFor(id, { ...EXP, splitPct: 100 }) === 'B')).toBe(true)
  })
  it('splits a population across both arms', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `sess-${i}`)
    const b = ids.filter(id => armFor(id, EXP) === 'B').length
    expect(b).toBeGreaterThan(50)
    expect(b).toBeLessThan(150)
  })
})

describe('config coercion', () => {
  it('persists and clamps the experiment block', async () => {
    await writeRuntimeConfig({
      parse: { provider: 'off', model: null },
      generation: { provider: 'off', model: null },
      limits: { llmDailyCap: 2000, ratePerMin: 500, ratePerDay: 10000, escalateMinWords: 8 },
      // @ts-expect-error — out-of-range split must clamp
      experiment: { enabled: true, splitPct: 250, b: { parse: { provider: 'openai', model: null }, generation: { provider: 'nope', model: null } } },
    })
    const c = await readRuntimeConfig()
    expect(c.experiment?.enabled).toBe(true)
    expect(c.experiment?.splitPct).toBe(100)                 // clamped
    expect(c.experiment?.b.parse.provider).toBe('openai')
    expect(c.experiment?.b.generation.provider).toBe('off') // invalid → off
  })
})

describe('route tags turns with the arm', () => {
  it('records sticky arms on events and aggregate() compares them', async () => {
    _resetGuardrails()
    await writeRuntimeConfig({
      parse: { provider: 'off', model: null },
      generation: { provider: 'off', model: null },
      limits: { llmDailyCap: 2000, ratePerMin: 500, ratePerDay: 10000, escalateMinWords: 8 },
      experiment: EXP,
    })
    // Find one session id per arm so the test never depends on hash luck.
    const ids = Array.from({ length: 50 }, (_, i) => `e2e-${i}`)
    const sidA = ids.find(id => armFor(id, EXP) === 'A')!
    const sidB = ids.find(id => armFor(id, EXP) === 'B')!

    for (const sid of [sidA, sidB]) {
      const res = await POST(new Request('http://localhost/api/discover', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `ip-${sid}` },
        body: JSON.stringify({ query: 'blue shirt', sessionId: sid, turn: 1 }),
      }))
      expect(res.status).toBe(200)
    }

    const turns = readEvents().filter((e): e is TurnEvent => e.type === 'turn')
    expect(turns.find(t => t.sessionId === sidA)?.arm).toBe('A')
    expect(turns.find(t => t.sessionId === sidB)?.arm).toBe('B')

    const agg = await aggregate('1970-01-01T00:00:00Z')
    expect(agg.arms).not.toBeNull()
    expect(agg.arms!.find(a => a.arm === 'A')!.turns).toBeGreaterThanOrEqual(1)
    expect(agg.arms!.find(a => a.arm === 'B')!.turns).toBeGreaterThanOrEqual(1)
  })
})
