// ─────────────────────────────────────────────
// Tests: src/lib/discovery/situation-match.ts
//
// Standing regression for the soft situation scorer (the productionised "B").
// Pins the "this not that" relationships the comparison spike validated against
// the LLM oracle, plus the non-negotiable SOFT property: emphasis re-orders, it
// never excludes. Fast + free (no model calls) — runs in CI on every change.
// ─────────────────────────────────────────────

import { getAllProducts } from '@/lib/data'
import { DEFAULT_PROFILES, rankBySituation, scoreSituation, matchSituation } from '@/lib/discovery/situation-match'

const products = getAllProducts()
const prof = (id: string) => DEFAULT_PROFILES.find(p => p.id === id)!
const firstCat = (ranked: ReturnType<typeof rankBySituation>, cat: string) =>
  ranked.findIndex(r => r.product.category === cat)

describe('situation-match — soft situation scorer', () => {
  test('never excludes: every product gets a finite, non-negative score', () => {
    for (const p of DEFAULT_PROFILES) {
      const ranked = rankBySituation(products, p)
      expect(ranked.length).toBe(products.length)
      for (const r of ranked) {
        expect(Number.isFinite(r.score)).toBe(true)
        expect(r.score).toBeGreaterThanOrEqual(0)
      }
    }
  })

  test('breakdown contributions sum to the score', () => {
    const p = prof('relaxed-city-weekend')
    for (const r of rankBySituation(products, p).slice(0, 10)) {
      const s = scoreSituation(r.product, p)
      const sum = s.breakdown.reduce((a, b) => a + b.contribution, 0)
      expect(Math.abs(sum - s.score)).toBeLessThan(1e-9)
    }
  })

  test('hike ranks a jacket above a dress', () => {
    const ranked = rankBySituation(products, prof('hike-cold-evening'))
    const jacket = firstCat(ranked, 'jacket')
    const dress = firstCat(ranked, 'dress')
    expect(jacket).toBeGreaterThanOrEqual(0)
    expect(dress).toBeGreaterThanOrEqual(0)
    expect(jacket).toBeLessThan(dress)
  })

  test('a wedding is topped by a dress', () => {
    const ranked = rankBySituation(products, prof('outdoor-summer-wedding'))
    expect(ranked[0].product.category).toBe('dress')
  })

  test('under-served situation scores lower: black-tie top < wedding top', () => {
    const blackTie = rankBySituation(products, prof('black-tie-gala'))[0].score
    const wedding = rankBySituation(products, prof('outdoor-summer-wedding'))[0].score
    expect(blackTie).toBeLessThan(wedding)
  })

  test('soft, not a filter: a de-emphasised garment still appears (office shorts)', () => {
    const ranked = rankBySituation(products, prof('office-day'))
    const shorts = products.filter(p => p.category === 'shorts')
    if (shorts.length) {
      for (const s of shorts) {
        expect(ranked.some(r => r.product.id === s.id)).toBe(true) // present, never dropped
      }
      expect(firstCat(ranked, 'shorts')).toBeGreaterThan(0) // but de-emphasised (not the top)
    }
  })

  test('matchSituation maps free-text queries to the right profile', () => {
    expect(matchSituation('a few things for a hike in the hills', DEFAULT_PROFILES)?.id).toBe('hike-cold-evening')
    expect(matchSituation('something for the office', DEFAULT_PROFILES)?.id).toBe('office-day')
    expect(matchSituation('a dress for a wedding', DEFAULT_PROFILES)?.id).toBe('outdoor-summer-wedding')
    expect(matchSituation('xyzzy nothing relevant', DEFAULT_PROFILES)).toBeNull()
  })
})
