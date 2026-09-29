// ─────────────────────────────────────────────
// Consultation layer — the "personal tailor" ask-before-offer beat.
//
// Covers the house rules end-to-end through the real engine:
//   sparse brief → question (not results); answers apply structured patches;
//   max two blocking questions; escapes conclude; ignored questions never
//   repeat; rich briefs skip straight to results with a non-blocking
//   "sharpen it" question attached; typed phrases converge with tapped options.
// ─────────────────────────────────────────────

import { discover } from '@/lib/discovery/engine'
import { updateSessionContext } from '@/lib/discovery/session'
import {
  shouldConsult, nextQuestion, applyAnswer, signalCount, CONSULT_CONCLUDED,
} from '@/lib/discovery/consult'
import {
  PREF_DARKER, PREF_LIGHTER, isDarkPalette, matchesPreferenceToken,
} from '@/lib/discovery/attributes'
import { getProductsByCatalog } from '@/lib/data'
import { emptySessionContext } from '@/types'

describe('ask-before-offer: a sparse brief earns a question, not a guess', () => {
  const turn1 = discover('I need a dress', emptySessionContext(), 'fashion')

  it('asks instead of offering', () => {
    expect(turn1.question).toBeDefined()
    expect(turn1.results).toHaveLength(0)
  })

  it('marks the question asked (mark-on-ask)', () => {
    expect(turn1.updatedContext.askedQuestions).toContain(turn1.question!.id)
  })

  it('the message carries the prompt so the transcript stands alone', () => {
    expect(turn1.message).toContain(turn1.question!.prompt)
  })

  it('every question ends with a graceful escape (empty patch)', () => {
    const last = turn1.question!.options[turn1.question!.options.length - 1]
    expect(Object.keys(last.patch)).toHaveLength(0)
  })

  it('second sparse turn asks a DIFFERENT question; third reveals', () => {
    const q1 = turn1.question!
    const opt1 = q1.options[0]
    const turn2 = discover(opt1.label, turn1.updatedContext, 'fashion', undefined, {
      answer: { questionId: q1.id, optionId: opt1.id },
    })
    expect(turn2.question).toBeDefined()
    expect(turn2.results).toHaveLength(0)
    expect(turn2.question!.id).not.toBe(q1.id)

    const q2 = turn2.question!
    const opt2 = q2.options[0]
    const turn3 = discover(opt2.label, turn2.updatedContext, 'fashion', undefined, {
      answer: { questionId: q2.id, optionId: opt2.id },
    })
    // Two questions is the ceiling — now the tailor offers.
    expect(turn3.results.length).toBeGreaterThan(0)
  })
})

describe('answers are honoured, visibly', () => {
  const turn1 = discover('I need a dress', emptySessionContext(), 'fashion')

  it('"darker, richer tones" reorders the shortlist toward the dark palette', () => {
    // Answer palette=darker, then conclude the second question via its escape
    // so results reveal.
    const afterPalette = discover('darker, richer tones', turn1.updatedContext, 'fashion', undefined, {
      answer: { questionId: 'palette', optionId: 'darker' },
    })
    expect(afterPalette.updatedContext.preferences).toContain(PREF_DARKER)
    const q2 = afterPalette.question!
    const escape = q2.options[q2.options.length - 1]
    const reveal = discover(escape.label, afterPalette.updatedContext, 'fashion', undefined, {
      answer: { questionId: q2.id, optionId: escape.id },
    })
    expect(reveal.results.length).toBeGreaterThan(0)
    const topFive = reveal.results.slice(0, 5).map(r => r.product)
    expect(topFive.filter(isDarkPalette).length).toBeGreaterThanOrEqual(3)
  })

  it('the explanation acknowledges the chosen preference on matching pieces', () => {
    const ctx = applyAnswer(
      updateSessionContext(emptySessionContext(), 'a dress for a summer party'),
      { questionId: 'palette', optionId: 'darker' },
    )
    const r = discover('show me', ctx, 'fashion')
    const darkResults = r.results.filter(x => matchesPreferenceToken(x.product, PREF_DARKER))
    expect(darkResults.length).toBeGreaterThan(0)
    expect(darkResults[0].matchExplanation).toContain('deeper tones you asked for')
  })

  it('a concluding escape ("surprise me") reveals immediately', () => {
    const q1 = turn1.question!
    const escape = q1.options.find(o => o.id === 'open')!
    const reveal = discover(escape.label, turn1.updatedContext, 'fashion', undefined, {
      answer: { questionId: q1.id, optionId: escape.id },
    })
    expect(reveal.results.length).toBeGreaterThan(0)
    expect(reveal.updatedContext.askedQuestions).toContain(CONSULT_CONCLUDED)
    // The shopper delegated — no sharpening pestering either.
    expect(reveal.question).toBeUndefined()
  })

  it('an ignored question is never asked again', () => {
    // The shopper types over the palette question with another thin phrase.
    const turn2 = discover('hmm, something nice', turn1.updatedContext, 'fashion')
    expect(turn2.question).toBeDefined()
    expect(turn2.question!.id).not.toBe(turn1.question!.id)
  })

  it('a question answered via its escape is never re-offered, even as a sharpener', () => {
    // "either, really" answers the season question without giving a season —
    // the dimension stays unknown, but the shopper has spoken. Re-offering
    // would be pestering.
    const base = updateSessionContext(emptySessionContext(), 'a dress for a party')
    const answered = applyAnswer(
      { ...base, askedQuestions: ['season'] },
      { questionId: 'season', optionId: 'open' },
    )
    const reveal = discover('show me what you have', answered, 'fashion')
    expect(reveal.question?.id).not.toBe('season')
  })
})

describe('a rich brief skips the interrogation', () => {
  const rich = discover(
    "I need a dress for a friend's wedding in July. It's outdoors, smart casual.",
    emptySessionContext(),
    'fashion',
  )

  it('offers immediately', () => {
    expect(rich.results.length).toBeGreaterThan(0)
  })

  it('attaches a non-blocking "sharpen it" question alongside results', () => {
    expect(rich.question).toBeDefined()
    // Season is already known (July) — the tailor never asks what it knows.
    expect(rich.question!.id).not.toBe('season')
  })

  it('the sharpening question is shown exactly once (mark-on-ask)', () => {
    expect(rich.updatedContext.askedQuestions).toContain(rich.question!.id)
    // The next reveal offers a DIFFERENT sharpener (or none) — never a repeat.
    const next = discover('nothing black', rich.updatedContext, 'fashion')
    expect(next.question?.id).not.toBe(rich.question!.id)
  })
})

describe('questions only earn their airtime (information gain)', () => {
  const products = getProductsByCatalog('fashion')

  it('never asks about a dimension already given', () => {
    const ctx = { ...emptySessionContext(), season: 'summer' }
    const q = nextQuestion(ctx, products)
    expect(q?.id).not.toBe('season')
  })

  it('skips the expression question once patterns are excluded', () => {
    const ctx = updateSessionContext(emptySessionContext(), 'nothing floral and no prints please')
    const q = nextQuestion({ ...ctx, preferences: [PREF_DARKER, PREF_LIGHTER] }, products)
    expect(q?.id).not.toBe('expression')
  })

  it('goes quiet over a near-empty candidate set rather than splitting hairs', () => {
    expect(nextQuestion(emptySessionContext(), products.slice(0, 4))).toBeNull()
  })

  it('formality is deliberately not in the bank (it cannot re-rank this catalogue)', () => {
    let ctx = emptySessionContext()
    const seen: string[] = []
    for (let i = 0; i < 6; i++) {
      const q = nextQuestion(ctx, products)
      if (!q) break
      seen.push(q.id)
      ctx = { ...ctx, askedQuestions: [...ctx.askedQuestions, q.id] }
    }
    expect(seen).not.toContain('formality')
    expect(seen.length).toBeGreaterThanOrEqual(3) // palette, expression, season, budget…
  })
})

describe('typed phrases converge with tapped options', () => {
  it.each([
    ['I prefer darker, richer tones', PREF_DARKER],
    ['something lighter and softer please', PREF_LIGHTER],
  ])('"%s" folds to the same canonical token as the tap', (phrase, token) => {
    const ctx = updateSessionContext(emptySessionContext(), phrase)
    expect(ctx.preferences).toContain(token)
  })
})

describe('the outdoor consultation', () => {
  it('a thin outdoor brief gets the focus question', () => {
    const turn = discover('I want to get into hiking', emptySessionContext(), 'outdoor')
    expect(turn.question).toBeDefined()
    expect(turn.results).toHaveLength(0)
  })

  it('"keep it considered" leans the shortlist below the median price', () => {
    const base = updateSessionContext(emptySessionContext(), 'kit for day hiking trips this summer')
    const ctx = applyAnswer(base, { questionId: 'budget', optionId: 'considered' })
    expect(ctx.constraints).toContain('budget conscious')
    const r = discover('show me', ctx, 'outdoor')
    const prices = getProductsByCatalog('outdoor').map(p => p.price).sort((a, b) => a - b)
    const median = prices[Math.floor(prices.length / 2)]
    const topFive = r.results.slice(0, 5)
    expect(topFive.filter(x => x.product.price <= median).length).toBeGreaterThanOrEqual(3)
  })
})

describe('guard rails', () => {
  it('applyAnswer with unknown ids leaves the context untouched', () => {
    const ctx = emptySessionContext()
    expect(applyAnswer(ctx, { questionId: 'nope', optionId: 'nada' })).toBe(ctx)
  })

  it('signalCount counts every dimension the shopper has given', () => {
    const ctx = updateSessionContext(
      emptySessionContext(),
      "a dress for a friend's wedding in July, outdoors, smart casual",
    )
    expect(signalCount(ctx)).toBeGreaterThanOrEqual(4)
    expect(shouldConsult(ctx)).toBe(false)
  })
})
