/**
 * @jest-environment node
 */
// ─────────────────────────────────────────────
// A colour named outright ("a black dress") is the most literal request a
// shopper can make. It must be understood WITHOUT an LLM, must never be
// confused with a rejection or a dress code, and must decide the shortlist.
// Ranking is checked against the real vision catalogue (the demo's).
// ─────────────────────────────────────────────

import { updateSessionContext, freshContextFrom } from '@/lib/discovery/session'
import { composeFromCandidates, type DiscoverResponse } from '@/lib/discovery/engine'
import type { ConsultAnswer } from '@/lib/discovery/consult'
import { emptySessionContext, type Product, type SessionContext } from '@/types'
import visionCatalog from '@/lib/catalog/vision-catalog.json'

const CATALOG = visionCatalog as unknown as Product[]
// "Black" means the piece's main colour — not a black accent in a pattern.
const isBlack = (p: Product) => !!p.color[0]?.includes('black')
const hasAnyBlack = (p: Product) => p.color.some(c => c.includes('black'))

/** Play a brief to its first shortlist, escaping each blocking question. */
function playToResults(text: string, start: SessionContext = emptySessionContext()) {
  let ctx = start
  let input = text
  let answer: ConsultAnswer | undefined
  let r!: DiscoverResponse
  const asked: string[] = []
  for (let i = 0; i < 4; i++) {
    r = composeFromCandidates(input, ctx, CATALOG, undefined, { answer })
    ctx = r.updatedContext
    if (r.question) asked.push(r.question.id)
    if (r.results.length > 0 || !r.question) break
    const opt = r.question.options[r.question.options.length - 1]
    input = opt.label
    answer = { questionId: r.question.id, optionId: opt.id }
  }
  return { r, asked }
}

describe('parsing a named colour (regex, no LLM)', () => {
  it.each([
    ['a black dress for a party', ['black']],
    ['something in navy for the office', ['navy']],
    ['a gray or burgundy jacket', ['grey', 'burgundy']],
  ])('"%s" → wants %j', (text, colours) => {
    expect(freshContextFrom(text).preferences).toEqual(expect.arrayContaining(colours))
  })

  it.each([
    ['a dress for a party, nothing black', 'black'],
    ['I hate pink, show me a top', 'pink'],
    ["can't stand white, looking for a party dress", 'white'],
    ['anything but red for a dinner', 'red'],
    ['I already have a black dress, need a jacket', 'black'],
    ['a gala outfit, black tie', 'black'],
    ['black-tie dinner, something elegant', 'black'],
  ])('"%s" does not want %s', (text, colour) => {
    expect(freshContextFrom(text).preferences).not.toContain(colour)
  })

  it('a later rejection removes the earlier wish — the hard filter wins', () => {
    const first = freshContextFrom('a black dress for a party')
    expect(first.preferences).toContain('black')
    const second = updateSessionContext(first, 'actually, nothing black')
    expect(second.exclusions).toContain('black')
    expect(second.preferences).not.toContain('black')
  })
})

describe('a named colour decides the shortlist (vision catalogue)', () => {
  it('"a black dress for a party" returns black dresses, and says why', () => {
    expect(CATALOG.filter(p => p.category === 'dress' && isBlack(p)).length).toBeGreaterThanOrEqual(8)

    const { r, asked } = playToResults('A black dress for a party, it might get cold later')
    expect(r.results.length).toBeGreaterThan(0)
    for (const x of r.results) {
      expect(x.product.category).toBe('dress')
      expect(isBlack(x.product)).toBe(true)
    }
    for (const x of r.results) {
      expect(x.matchExplanation).toContain('in the black you asked for')
      // the colour is said once, not repeated as a trailing "— in black"
      expect(x.matchExplanation).not.toMatch(/— in black/)
      expect(x.matchExplanation).not.toMatch(/\s\.$/) // no stray space before the full stop
    }
    // never ask "darker or lighter?" of someone who said black
    expect(asked).not.toContain('palette')
  })

  it('a rejected colour still never appears', () => {
    const { r } = playToResults('a dress for a party, nothing black')
    expect(r.results.length).toBeGreaterThan(0)
    expect(r.results.some(x => hasAnyBlack(x.product))).toBe(false)
  })
})

describe('a colour accent is not the colour', () => {
  it('a camo dress that merely contains black is never called "the black you asked for"', () => {
    const camo = CATALOG.find(p => p.name === 'Olive Green T-Shirt Dress')!
    expect(camo.color[0]).toContain('olive')
    expect(hasAnyBlack(camo)).toBe(true) // the premise: black is an accent here
    const ctx = { ...emptySessionContext(), preferences: ['black'], requestedGarment: 'dress', revealCount: 1 }
    const r = composeFromCandidates('show me more', ctx, [camo])
    expect(r.results[0]?.matchExplanation ?? '').not.toContain('black you asked for')
  })
})
