/**
 * @jest-environment node
 */
// ─────────────────────────────────────────────
// POST /api/discover/probe — the Studio model bench. Keyless CI probes the
// deterministic column (provider: null); the shape is what ModelsClient reads.
// ─────────────────────────────────────────────

import { POST } from '@/app/api/discover/probe/route'
import { _resetGuardrails } from '@/lib/discovery/guardrails'

const post = (body: unknown) =>
  new Request('http://localhost/api/discover/probe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => _resetGuardrails())

describe('POST /api/discover/probe', () => {
  it('rejects a missing query with 400', async () => {
    const res = await POST(post({}))
    expect(res.status).toBe(400)
  })

  it('deterministic-only probe returns gate verdict + engine outcome, no LLM stages', async () => {
    const res = await POST(post({ query: 'I hate florals — something elegant for a dinner', provider: null }))
    expect(res.status).toBe(200)
    const d = await res.json()
    expect(d.escalate).toBe(true)           // rejection language → would escalate
    expect(d.parse).toBeNull()              // no provider → no LLM stage ran
    expect(d.generate).toBeNull()
    expect(typeof d.engine.message).toBe('string')
    expect(typeof d.engine.ms).toBe('number')
    expect(Array.isArray(d.engine.results)).toBe(true)
  })

  it('a simple turn reports the gate keeping it deterministic', async () => {
    const res = await POST(post({ query: 'blue shirt' }))
    const d = await res.json()
    expect(d.escalate).toBe(false)
  })

  it('an LLM provider without a key degrades to ok:false, engine still answers', async () => {
    delete process.env.OPENAI_API_KEY
    const res = await POST(post({ query: 'something elegant, nothing floral', provider: 'openai' }))
    expect(res.status).toBe(200)
    const d = await res.json()
    expect(d.parse.ok).toBe(false)          // no key → null patch → regex fallback
    expect(d.generate.ok).toBe(false)
    expect(typeof d.engine.message).toBe('string')
  })
})
