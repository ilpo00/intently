/**
 * @jest-environment node
 */
// ─────────────────────────────────────────────
// POST /api/discover — the sole discovery path (scripted mode removed).
// CI runs keyless: no DISCOVERY_PARSER / DISCOVERY_GENERATION, so these
// assert the deterministic default the live path always falls back to.
// ─────────────────────────────────────────────

import { POST } from '@/app/api/discover/route'
import { _resetGuardrails } from '@/lib/discovery/guardrails'

function post(body: unknown, ip = 'test-ip'): Request {
  return new Request('http://localhost/api/discover', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

beforeEach(() => _resetGuardrails())

describe('POST /api/discover (deterministic default)', () => {
  it('rejects invalid JSON with 400', async () => {
    const res = await POST(new Request('http://localhost/api/discover', {
      method: 'POST', body: 'not json',
    }))
    expect(res.status).toBe(400)
  })

  it('rejects a missing query with 400', async () => {
    const res = await POST(post({ query: '   ' }))
    expect(res.status).toBe(400)
  })

  it('answers a fashion situation with the full outcome shape', async () => {
    const res = await POST(post({ query: "dress for a friend's wedding in July, outdoors, smart casual" }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(typeof data.message).toBe('string')
    expect(data.message.length).toBeGreaterThan(0)
    expect(Array.isArray(data.results)).toBe(true)
    expect(data.results.length).toBeGreaterThan(0)
    expect(data.updatedSession).toBeDefined()
    expect(data.updatedSession.turnCount).toBeGreaterThan(0)
  })

  it('a bare garment ask returns the blocking consultation question', async () => {
    const res = await POST(post({ query: 'I need a dress' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.question).not.toBeNull()
    expect(data.results).toHaveLength(0) // ask-before-offer: no reveal yet
  })

  it('consults then reveals on the outdoor catalog', async () => {
    // Turn 1: the tailor asks (blocking consultation, no reveal yet).
    const res1 = await POST(post({ query: 'sturdy track pants for hiking', catalog: 'outdoor' }))
    expect(res1.status).toBe(200)
    const t1 = await res1.json()
    expect(t1.question).not.toBeNull()

    // Answer each blocking ask via its tapped option until the reveal
    // (the consultation may span more than one question).
    let turn = t1
    for (let i = 0; i < 4 && turn.results.length === 0 && turn.question; i++) {
      const opt = turn.question.options[0]
      const res = await POST(post({
        query: opt.label,
        catalog: 'outdoor',
        session: turn.updatedSession,
        answer: { questionId: turn.question.id, optionId: opt.id },
      }))
      expect(res.status).toBe(200)
      turn = await res.json()
    }
    expect(turn.results.length).toBeGreaterThan(0)
  })

  it('rate-limits a hammering IP with 429', async () => {
    let last: Response | undefined
    for (let i = 0; i < 25; i++) {
      last = await POST(post({ query: 'blue shirt' }, 'hammer-ip'))
    }
    expect(last?.status).toBe(429)
    expect(last?.headers.get('retry-after')).toBeTruthy()
  })
})
