// ─────────────────────────────────────────────
// Tests: src/lib/enrichment/vector-math.ts
//
// Pure math, easy to lock down. Catching a sign
// flip here costs nothing; catching it in the
// search ranker would mean the wrong product
// surfaced for every query.
// ─────────────────────────────────────────────

import { cosine, dot, norm, normalise } from '@/lib/enrichment/vector-math'

describe('dot', () => {
  it('returns sum of element-wise products', () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32) // 4 + 10 + 18
  })
  it('returns 0 for orthogonal vectors', () => {
    expect(dot([1, 0], [0, 1])).toBe(0)
  })
  it('throws on length mismatch', () => {
    expect(() => dot([1, 2], [1, 2, 3])).toThrow(/length mismatch/)
  })
})

describe('norm', () => {
  it('returns the Euclidean length', () => {
    expect(norm([3, 4])).toBe(5)
  })
  it('returns 0 for the zero vector', () => {
    expect(norm([0, 0, 0])).toBe(0)
  })
})

describe('cosine', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10)
  })
  it('returns 0 for orthogonal vectors', () => {
    expect(cosine([1, 0], [0, 1])).toBe(0)
  })
  it('returns -1 for opposite vectors', () => {
    expect(cosine([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 10)
  })
  it('is scale-invariant', () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10)
  })
  it('returns 0 when either vector is zero', () => {
    expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0)
    expect(cosine([1, 2, 3], [0, 0, 0])).toBe(0)
  })
})

describe('normalise', () => {
  it('returns a unit vector', () => {
    const n = normalise([3, 4])
    expect(norm(n)).toBeCloseTo(1, 10)
    expect(n).toEqual([0.6, 0.8])
  })
  it('returns the zero vector unchanged', () => {
    expect(normalise([0, 0])).toEqual([0, 0])
  })
  it('does not mutate the input', () => {
    const input = [3, 4]
    normalise(input)
    expect(input).toEqual([3, 4])
  })
})
