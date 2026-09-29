// ─────────────────────────────────────────────
// Tests: the blind-tailor consultation (audience + build)
//
// A shop-floor tailor reads gender and build at a glance; Intently must ask.
// These tests pin the whole loop against the REAL vision catalogue (the
// deployed demo set), because the consult layer's info-gain gate is a
// data-dependent contract: a question only fires if the live distribution
// genuinely splits.
// ─────────────────────────────────────────────

import type { Product, SessionContext } from '@/types'
import { emptySessionContext } from '@/types'
import visionProducts from '@/lib/catalog/vision-catalog.json'
import { composeFromCandidates } from '@/lib/discovery/engine'
import { freshContextFrom, updateSessionContext } from '@/lib/discovery/session'
import { signalCount } from '@/lib/discovery/consult'
import { prefilter } from '@/lib/discovery/prefilter'
import { validateParsedPatch } from '@/lib/discovery/parse-context'
import {
  matchesPreferenceToken, opposesPreferenceToken,
  PREF_TRIM, PREF_SHOULDERS, PREF_MIDDLE, PREF_GENEROUS,
} from '@/lib/discovery/attributes'

const CATALOGUE = visionProducts as unknown as Product[]
const empty = emptySessionContext()

// Walk one consultation turn the way the UI does: the tapped option's label
// becomes the query, the structured answer rides along.
function tapAnswer(prev: SessionContext, label: string, questionId: string, optionId: string) {
  return composeFromCandidates(label, prev, CATALOGUE, undefined, {
    answer: { questionId, optionId },
  })
}

describe('blind tailor — ask before guessing', () => {
  it('a vague first input gets the audience question, not a list', () => {
    const r = composeFromCandidates('something nice', empty, CATALOGUE)
    expect(r.results).toHaveLength(0)
    expect(r.question?.id).toBe('audience')
    // All four choices present, ending in the graceful decline.
    expect(r.question?.options.map(o => o.id)).toEqual(['her', 'him', 'either', 'na'])
  })

  it('walks vague → audience → build → confident reveal, honouring both taps', () => {
    const t1 = composeFromCandidates('something nice', empty, CATALOGUE)
    const t2 = tapAnswer(t1.updatedContext, 'for him', 'audience', 'him')
    expect(t2.results).toHaveLength(0)
    expect(t2.question?.id).toBe('build')
    expect(t2.updatedContext.audience).toBe('men')

    const t3 = tapAnswer(t2.updatedContext, 'easy through the middle', 'build', 'middle')
    expect(t3.results.length).toBeGreaterThan(0)
    // Two consultation answers = a confident brief = a tighter, hand-picked
    // shelf (≤8), scoped to clothes — no cap/backpack padding a clothes brief.
    expect(t3.results.length).toBeLessThanOrEqual(8)
    expect(t3.updatedContext.preferences).toContain(PREF_MIDDLE)
    for (const res of t3.results) {
      expect(['dress', 'skirt', 'heels']).not.toContain(res.product.category)
      expect(['cap', 'backpack', 'sunglasses']).not.toContain(res.product.category)
    }
  })

  it('a gendered garment brief skips the audience question as moot', () => {
    const r = composeFromCandidates('a black dress for a party', empty, CATALOGUE)
    expect(r.question?.id).not.toBe('audience')
  })

  it('declining the audience question is respected and never re-asked', () => {
    const t1 = composeFromCandidates('something nice', empty, CATALOGUE)
    const t2 = tapAnswer(t1.updatedContext, 'I’d rather not say', 'audience', 'na')
    expect(t2.updatedContext.audience).toBeNull()
    // The consultation moves on (build next) rather than repeating itself.
    expect(t2.question?.id).toBe('build')
    expect(t2.updatedContext.askedQuestions).toContain('audience')
  })

  it('typed and tapped audience converge on the same signal', () => {
    expect(freshContextFrom('a jacket for my husband').audience).toBe('men')
    expect(freshContextFrom('something for my wife').audience).toBe('women')
    expect(freshContextFrom('keep it unisex please').audience).toBe('unisex')
    expect(signalCount(freshContextFrom('for him'))).toBe(1)
  })

  it('every build option label parses to its own token when typed', () => {
    expect(updateSessionContext(empty, 'a trim, close fit').preferences).toContain(PREF_TRIM)
    expect(updateSessionContext(empty, 'room in the shoulders').preferences).toContain(PREF_SHOULDERS)
    expect(updateSessionContext(empty, 'easy through the middle').preferences).toContain(PREF_MIDDLE)
    expect(updateSessionContext(empty, 'a generous, easy fit').preferences).toContain(PREF_GENEROUS)
  })

  it("audience 'men' hard-excludes womenswear categories in the prefilter", () => {
    const ctx: SessionContext = { ...empty, audience: 'men' }
    const categories = new Set(prefilter(CATALOGUE, ctx).map(s => s.product.category))
    expect(categories.has('dress')).toBe(false)
    expect(categories.has('skirt')).toBe(false)
    expect(categories.size).toBeGreaterThan(3) // plenty honestly remains
  })

  it('an explicitly requested garment overrides the audience line', () => {
    const ctx: SessionContext = { ...empty, audience: 'men', requestedGarment: 'dress' }
    const categories = new Set(prefilter(CATALOGUE, ctx).map(s => s.product.category))
    expect(categories.has('dress')).toBe(true)  // he asked; the tailor serves
    expect(categories.has('skirt')).toBe(false) // but only what he asked for
  })

  it('build tokens are silhouette-backed, never category-hallucinated', () => {
    const aline = CATALOGUE.find(p => p.silhouette === 'a-line')!
    const fitted = CATALOGUE.find(p => /\bfitted\b/.test(p.silhouette))!
    const cap = CATALOGUE.find(p => p.category === 'cap')!
    expect(matchesPreferenceToken(aline, PREF_MIDDLE)).toBe(true)
    expect(opposesPreferenceToken(fitted, PREF_MIDDLE)).toBe(true)
    // Accessories have no cut to sit right — build never touches them.
    expect(matchesPreferenceToken(cap, PREF_MIDDLE)).toBe(false)
  })

  it('the LLM validator admits only canonical audiences', () => {
    expect(validateParsedPatch({ audience: 'men' }).audience).toBe('men')
    expect(validateParsedPatch({ audience: 'boys' }).audience).toBeUndefined()
    expect(validateParsedPatch({ audience: 42 }).audience).toBeUndefined()
  })
})
