// ─────────────────────────────────────────────
// Conversation ground rules — resource limits (no network, injectable clock).
// Topic containment is structural (vocabulary clamp + no raw text to the
// re-voicer) and covered by parse-context tests; these cover the abuse limits.
// ─────────────────────────────────────────────

import {
  sanitizeQuery, checkRateLimit, takeLlmBudget, _resetGuardrails, llmBudgetUsedToday,
} from '@/lib/discovery/guardrails'

beforeEach(() => _resetGuardrails())

describe('sanitizeQuery', () => {
  it('trims, collapses whitespace, caps length', () => {
    expect(sanitizeQuery('  a   dress\n\nfor   work  ')).toBe('a dress for work')
    expect(sanitizeQuery('x'.repeat(1000))).toHaveLength(280)
    expect(sanitizeQuery('   ')).toBe('')
  })
})

describe('checkRateLimit — sliding minute + daily cap per IP', () => {
  const T0 = Date.parse('2026-06-12T10:00:00Z')

  it('allows up to the per-minute limit, then blocks with retry-after', () => {
    for (let i = 0; i < 20; i++) {
      expect(checkRateLimit('1.2.3.4', T0 + i * 100).ok).toBe(true)
    }
    const blocked = checkRateLimit('1.2.3.4', T0 + 2100)
    expect(blocked.ok).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('the minute window slides — old hits expire', () => {
    for (let i = 0; i < 20; i++) checkRateLimit('1.2.3.4', T0 + i)
    expect(checkRateLimit('1.2.3.4', T0 + 30_000).ok).toBe(false)
    expect(checkRateLimit('1.2.3.4', T0 + 61_000).ok).toBe(true)
  })

  it('IPs are independent', () => {
    for (let i = 0; i < 20; i++) checkRateLimit('1.1.1.1', T0 + i)
    expect(checkRateLimit('1.1.1.1', T0 + 100).ok).toBe(false)
    expect(checkRateLimit('2.2.2.2', T0 + 100).ok).toBe(true)
  })

  it('daily cap blocks even spaced-out requests, resets next UTC day', () => {
    // 400 requests spread over the day (well under the minute limit each time)
    for (let i = 0; i < 400; i++) {
      expect(checkRateLimit('9.9.9.9', T0 + i * 120_000).ok).toBe(true)
    }
    expect(checkRateLimit('9.9.9.9', T0 + 401 * 120_000).ok).toBe(false)
    const nextDay = Date.parse('2026-06-13T10:00:00Z')
    expect(checkRateLimit('9.9.9.9', nextDay).ok).toBe(true)
  })
})

describe('takeLlmBudget — global daily cap, silent degrade', () => {
  const T0 = Date.parse('2026-06-12T10:00:00Z')

  it('grants up to the cap, then refuses (caller falls back deterministically)', () => {
    for (let i = 0; i < 2000; i++) expect(takeLlmBudget(T0 + i)).toBe(true)
    expect(takeLlmBudget(T0 + 99_999)).toBe(false)
    expect(llmBudgetUsedToday()).toBe(2000)
  })

  it('resets at the UTC day boundary', () => {
    for (let i = 0; i < 2000; i++) takeLlmBudget(T0)
    expect(takeLlmBudget(T0)).toBe(false)
    expect(takeLlmBudget(Date.parse('2026-06-13T00:00:01Z'))).toBe(true)
  })
})
