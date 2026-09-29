/**
 * @jest-environment node
 */
// ─────────────────────────────────────────────
// Order webhook + funnel: the secret gate fails loudly, orders land as
// events, and the funnel's Purchased step goes live with honest attribution.
// ─────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = mkdtempSync(join(tmpdir(), 'intently-order-'))
process.env.INTENTLY_EVENTS_DIR = dir

import { POST } from '@/app/api/analytics/order/route'
import { emitEvent, readEvents, type TurnEvent } from '@/lib/analytics/events'
import { aggregate } from '@/lib/analytics/aggregate'

afterAll(() => rmSync(dir, { recursive: true, force: true }))
afterEach(() => { delete process.env.INTENTLY_WEBHOOK_SECRET })

const post = (body: unknown, secret?: string) =>
  new Request('http://localhost/api/analytics/order', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-intently-webhook-secret': secret } : {}) },
    body: JSON.stringify(body),
  })

describe('POST /api/analytics/order', () => {
  it('answers 501 when the secret env is unset (fails loudly, never accepts)', async () => {
    const res = await POST(post({ orderId: 'o1' }, 'anything'))
    expect(res.status).toBe(501)
  })

  it('rejects a wrong/missing secret with 401', async () => {
    process.env.INTENTLY_WEBHOOK_SECRET = 's3cret'
    expect((await POST(post({ orderId: 'o1' }, 'wrong'))).status).toBe(401)
    expect((await POST(post({ orderId: 'o1' }))).status).toBe(401)
  })

  it('accepts a valid order and emits the event', async () => {
    process.env.INTENTLY_WEBHOOK_SECRET = 's3cret'
    const res = await POST(post({
      orderId: 'ord-42', sessionId: 'sess-A', totalUsd: 129.99,
      items: [{ productId: 'p1', title: 'Floral Dress', quantity: 1, unitUsd: 129.99 }],
    }, 's3cret'))
    expect(res.status).toBe(200)
    const orders = readEvents().filter(e => e.type === 'order')
    expect(orders).toHaveLength(1)
    expect(orders[0]).toMatchObject({ orderId: 'ord-42', sessionId: 'sess-A', totalUsd: 129.99 })
  })
})

describe('funnel purchase step', () => {
  it('goes live with attribution counts when orders exist', async () => {
    const turn: TurnEvent = {
      type: 'turn', ts: new Date().toISOString(), sessionId: 'sess-A', turn: 1,
      queryChars: 5, query: 'dress', escalated: false, answered: false,
      resultCount: 5, questionAsked: false, parse: null, generate: null, latencyMs: 10,
    }
    emitEvent(turn)
    emitEvent({ type: 'order', ts: new Date().toISOString(), orderId: 'ord-noattr', sessionId: null, totalUsd: 50, items: [], source: 'medusa' })

    const a = await aggregate('1970-01-01T00:00:00Z')
    const purchase = a.funnel.find(f => f.key === 'purchase')!
    expect(purchase.sessions).toBe(1)                    // sess-A attributed (ord-42 from previous test)
    expect(purchase.note).toContain('without session attribution') // ord-noattr counted honestly
    expect(a.orders).toBe(2)
    expect(a.attributedOrders).toBe(1)
    expect(a.revenueUsd).toBeCloseTo(179.99, 2)
    expect(a.aovUsd).toBeCloseTo(179.99 / 2, 2)
  })
})
