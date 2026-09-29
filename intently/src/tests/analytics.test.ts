/**
 * @jest-environment node
 */
// ─────────────────────────────────────────────
// Analytics: the event sink round-trips, and aggregate() computes the
// funnel / conversation / budget numbers the page documents. Hermetic:
// its own temp events dir via INTENTLY_EVENTS_DIR (path read lazily).
// ─────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = mkdtempSync(join(tmpdir(), 'intently-analytics-'))
process.env.INTENTLY_EVENTS_DIR = dir

import { emitEvent, readEvents, costUsd, newMeter, type TurnEvent, type CartEvent } from '@/lib/analytics/events'
import { aggregate } from '@/lib/analytics/aggregate'

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const turn = (over: Partial<TurnEvent>): TurnEvent => ({
  type: 'turn', ts: new Date().toISOString(), sessionId: 's1', turn: 1,
  queryChars: 10, query: 'blue shirt', escalated: false, answered: false,
  resultCount: 6, questionAsked: false, parse: null, generate: null, latencyMs: 20,
  ...over,
})
const cartEv = (over: Partial<CartEvent>): CartEvent => ({
  type: 'cart', ts: new Date().toISOString(), sessionId: 's1',
  productId: 'p1', title: 'Floral Dress', surface: 'reveal', ...over,
})

describe('event sink', () => {
  it('emits and reads back, skipping malformed lines', () => {
    emitEvent(turn({}))
    emitEvent(cartEv({}))
    const es = readEvents()
    expect(es).toHaveLength(2)
    expect(es[0].type).toBe('turn')
    expect(es[1].type).toBe('cart')
  })
})

describe('cost table', () => {
  it('computes openai cost from verified list prices', () => {
    const m = newMeter(); m.tokensIn = 1_000_000; m.tokensOut = 1_000_000
    expect(costUsd('openai', m)).toBeCloseTo(0.20 + 1.25, 5)
  })
  it('unknown provider costs zero', () => {
    const m = newMeter(); m.tokensIn = 5000
    expect(costUsd('nope', m)).toBe(0)
  })
})

describe('aggregate', () => {
  it('computes funnel, escalation, and budget over a known stream', async () => {
    // Fresh dir for a clean slate.
    process.env.INTENTLY_EVENTS_DIR = mkdtempSync(join(tmpdir(), 'intently-analytics2-'))

    // Session A: escalated LLM turn with cost, results, then a cart add.
    emitEvent(turn({
      sessionId: 'A', escalated: true, resultCount: 8,
      parse: { provider: 'openai', model: null, tokensIn: 1000, tokensOut: 100, costUsd: 0.000325, ok: true },
      generate: { provider: 'openai', model: null, tokensIn: 500, tokensOut: 200, costUsd: 0.00035, ok: true, accepted: true, groundingRejected: false },
      latencyMs: 1500,
    }))
    emitEvent(cartEv({ sessionId: 'A', surface: 'companion' }))
    // Session B: simple deterministic turn, zero results, no question → a miss.
    emitEvent(turn({ sessionId: 'B', query: 'waterproof jacket', resultCount: 0, latencyMs: 20 }))
    // Session B answers a question on turn 2 (tapped option).
    emitEvent(turn({ sessionId: 'B', turn: 2, answered: true, questionAsked: false, resultCount: 5 }))

    const a = await aggregate('1970-01-01T00:00:00Z')
    expect(a.sessions).toBe(2)
    expect(a.funnel[0].sessions).toBe(2)     // sessions
    expect(a.funnel[1].sessions).toBe(2)     // saw results (A t1, B t2)
    expect(a.funnel[2].sessions).toBe(1)     // added to cart (A)
    expect(a.funnel[3].sessions).toBe(-1)    // purchase: not instrumented
    expect(a.cartAdds).toBe(1)
    expect(a.cartAddsBySurface).toEqual([{ surface: 'companion', count: 1 }])
    expect(a.escalationRate).toBeCloseTo(1 / 2)   // eligible = 2 typed turns, 1 escalated
    expect(a.zeroResultQueries).toEqual([{ query: 'waterproof jacket', count: 1 }])
    expect(a.totalCostUsd).toBeCloseTo(0.000675, 6)
    expect(a.costByProvider[0].provider).toBe('openai')
    expect(a.costByProvider[0].estimated).toBe(false)
    expect(a.costPerEscalatedTurn).toBeCloseTo(0.000675, 6)
    expect(a.costPerSession).toBeCloseTo(0.000675 / 2, 6)
    expect(a.latencyP50).toBeGreaterThan(0)
    expect(a.daily).toHaveLength(1)
    expect(a.projectedMonthUsd).toBeCloseTo(0.000675 * 28, 5)
  })
})
