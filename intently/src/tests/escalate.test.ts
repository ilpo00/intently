// ─────────────────────────────────────────────
// The complexity gate: simple turns stay deterministic (free, instant);
// only turns the regex parser would under-read escalate to the Tier-1 LLM.
// ─────────────────────────────────────────────

import { shouldEscalate } from '@/lib/discovery/escalate'

describe('shouldEscalate — stays deterministic on simple turns', () => {
  it.each([
    'blue shirt',
    'a black dress',
    'summer dress',
    'something more formal',
    'track pants',
    'wedding guest dress',
    'keep it lightweight',
  ])('"%s" → no LLM', (q) => {
    expect(shouldEscalate(q)).toBe(false)
  })

  it('empty / whitespace never escalates', () => {
    expect(shouldEscalate('')).toBe(false)
    expect(shouldEscalate('   ')).toBe(false)
  })
})

describe('shouldEscalate — escalates when the regex would under-read', () => {
  it.each([
    // Rejection / negation — the LLM's comprehension win; exclusions are hard filters.
    'I hate florals',
    'no black please',
    'nothing floral',
    'a dress without prints',
    'already have heels',
    // Long multi-clause briefs.
    "dress for a friend's wedding in July, outdoors, smart casual please",
    'I am going hiking next month in Lapland and it will be cold at night',
    // Paraphrase — content words outside the canonical vocabulary.
    'my budget died in December',
    'attire suitable when temperatures plummet overnight',
  ])('"%s" → LLM', (q) => {
    expect(shouldEscalate(q)).toBe(true)
  })
})
