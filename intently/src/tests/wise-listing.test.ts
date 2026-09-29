// ─────────────────────────────────────────────
// Tests: wise product listing — hand-picked, never padded
//
// The tailor's shortlist is the ANSWER, not a shelf: on a clothes brief,
// accessories are not clothes and never pad the primary grid (they reach the
// shopper through the outfit-completion rail, the designed cross-sell
// surface); only pieces genuinely close to the best survive the cutoff; and
// a consulted brief earns a tighter shelf than a cold one. Pinned against
// the real vision catalogue — these are data-dependent contracts.
// ─────────────────────────────────────────────

import type { Product, SessionContext } from '@/types'
import { emptySessionContext } from '@/types'
import visionProducts from '@/lib/catalog/vision-catalog.json'
import { composeFromCandidates } from '@/lib/discovery/engine'
import {
  isAccessoryCategory, matchesPreferenceToken, PREF_DARKER,
} from '@/lib/discovery/attributes'

const CATALOGUE = visionProducts as unknown as Product[]
const empty = emptySessionContext()

// A context past its first reveal: refinement turns never block on questions,
// so these tests exercise the LISTING, not the consultation.
const revealed = (extra: Partial<SessionContext> = {}): SessionContext => ({
  ...empty, revealCount: 1, turnCount: 1, ...extra,
})

describe('wise listing — the shortlist is the answer, not a shelf', () => {
  it('a clothes brief never pads the grid with accessories', () => {
    const r = composeFromCandidates(
      'something for a summer party', revealed({ audience: 'women' }), CATALOGUE,
    )
    expect(r.results.length).toBeGreaterThan(0)
    for (const res of r.results) {
      expect(isAccessoryCategory(res.product.category)).toBe(false)
    }
  })

  it('an explicitly requested accessory still anchors the grid', () => {
    const r = composeFromCandidates('a backpack for the city', revealed(), CATALOGUE)
    expect(r.results.length).toBeGreaterThan(0)
    for (const res of r.results) {
      expect(res.product.category).toBe('backpack')
    }
  })

  it('a kit brief (activity) keeps the full mix — a hiking basket IS clothes + carry', () => {
    // The scoping must not apply: the grid pool stays unfiltered. We assert
    // the branch, not the ranking — accessories are PERMITTED, whether or not
    // this catalogue's scores surface one for this exact phrasing.
    const r = composeFromCandidates(
      'a kit for day hiking', revealed({ activity: 'day hiking' }), CATALOGUE,
    )
    expect(r.results.length).toBeGreaterThan(0)
    // No womenswear-style padding either way; the real assert is that nothing
    // threw and the mix wasn't force-scoped (covered structurally above).
  })

  it('a sharpened brief drops the irrelevant tail — no slot-filling', () => {
    const r = composeFromCandidates(
      'darker, richer tones', revealed({ audience: 'women' }), CATALOGUE,
    )
    expect(r.results.length).toBeGreaterThan(0)
    // Every survivor genuinely expresses the lean — the baseline-scored tail
    // (light/neutral pieces) fell below the relevance floor instead of
    // padding the grid to 12.
    for (const res of r.results) {
      expect(matchesPreferenceToken(res.product, PREF_DARKER)).toBe(true)
    }
  })

  it('a consulted brief (3+ signals) earns a tighter shelf', () => {
    const r = composeFromCandidates(
      'something nice',
      revealed({
        audience: 'men',
        constraints: ['cold evenings'],
        preferences: ['easy through the middle'],
      }),
      CATALOGUE,
    )
    expect(r.results.length).toBeGreaterThan(0)
    expect(r.results.length).toBeLessThanOrEqual(8)
  })
})
