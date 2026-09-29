// ─────────────────────────────────────────────
// Tier-1 comprehension — the deterministic validator + merge (no network).
//
// The contract: ANY model output, however malformed or adversarial, must
// degrade to a safe patch that — worst case — leaves the regex-only context
// untouched. The one safety-critical rule: a hallucinated exclusion (a HARD
// filter that silently deletes inventory) must never survive validation.
// ─────────────────────────────────────────────

import { validateParsedPatch, mergeParsedPatch, isEmptyPatch } from '@/lib/discovery/parse-context'
import { discover } from '@/lib/discovery/engine'
import { updateSessionContext } from '@/lib/discovery/session'
import {
  OCCASIONS, ACTIVITIES, FORMALITIES, SEASONS, EXCLUSIONS, CONSTRAINTS,
} from '@/lib/discovery/vocabulary'
import { PREF_DARKER } from '@/lib/discovery/attributes'
import { emptySessionContext, type SessionContext } from '@/types'

describe('validateParsedPatch — clamps to canonical vocabulary, never throws', () => {
  it('accepts in-vocabulary values', () => {
    const p = validateParsedPatch({
      occasion: 'wedding guest', formality: 'smart casual', season: 'summer',
      activity: 'day hiking', requestedGarment: 'dress',
      addExclusions: ['floral'], addConstraints: ['cold evenings'], addPreferences: [PREF_DARKER],
    })
    expect(p.occasion).toBe('wedding guest')
    expect(p.formality).toBe('smart casual')
    expect(p.season).toBe('summer')
    expect(p.requestedGarment).toBe('dress')
    expect(p.addExclusions).toEqual(['floral'])
    expect(p.addConstraints).toEqual(['cold evenings'])
    expect(p.addPreferences).toEqual([PREF_DARKER])
  })

  it('drops out-of-vocabulary scalars', () => {
    const p = validateParsedPatch({
      occasion: 'funeral', formality: 'business casual', season: 'monsoon', activity: 'skydiving',
      requestedGarment: 'tuxedo',
    })
    expect(p).toEqual({})
  })

  it('SAFETY: never admits an exclusion outside the known set', () => {
    const p = validateParsedPatch({ addExclusions: ['polyester', 'green', 'expensive', 'black'] })
    // only 'black' is a known exclusion; the rest (hard-filter hazards) are dropped
    expect(p.addExclusions).toEqual(['black'])
  })

  it('ignores malformed / hostile input without throwing', () => {
    for (const bad of [null, undefined, 42, 'a string', [], { addExclusions: 'black' }, { occasion: 123 }]) {
      expect(() => validateParsedPatch(bad)).not.toThrow()
    }
  })

  it('coerces a bare-string list (model sometimes drops the array)', () => {
    // deepseek-v4-flash occasionally returns "preppy" instead of ["preppy"].
    expect(validateParsedPatch({ addExclusions: 'black' }).addExclusions).toEqual(['black'])
    expect(validateParsedPatch({ addPreferences: 'velvet' }).addPreferences).toEqual(['velvet'])
    expect(validateParsedPatch({ addConstraints: 'cold evenings, budget conscious' }).addConstraints)
      .toEqual(['cold evenings', 'budget conscious'])
    // coercion does NOT weaken the safety rule
    expect(validateParsedPatch({ addExclusions: 'polyester' }).addExclusions).toBeUndefined()
  })

  it('strips unknown / smuggled fields', () => {
    const p = validateParsedPatch({
      occasion: 'party', revealCount: 999, askedQuestions: ['x'], __proto__: { polluted: true },
      results: [{ id: 'evil' }],
    }) as Record<string, unknown>
    expect(p.occasion).toBe('party')
    expect(p.revealCount).toBeUndefined()
    expect(p.askedQuestions).toBeUndefined()
    expect(p.results).toBeUndefined()
  })

  it('bounds list growth and lowercases', () => {
    const p = validateParsedPatch({
      addConstraints: CONSTRAINTS.concat(CONSTRAINTS).map(c => c.toUpperCase()),
    })
    expect(p.addConstraints!.length).toBeLessThanOrEqual(4)
    expect(p.addConstraints!.every(c => c === c.toLowerCase())).toBe(true)
  })

  it('admits a bounded free-form preference word, rejects junk', () => {
    expect(validateParsedPatch({ addPreferences: ['velvet'] }).addPreferences).toEqual(['velvet'])
    expect(validateParsedPatch({ addPreferences: ['a really long phrase that is not a single word'] }).addPreferences)
      .toBeUndefined()
    expect(validateParsedPatch({ addPreferences: ['123', '!!!'] }).addPreferences).toBeUndefined()
  })
})

describe('mergeParsedPatch — regex-first: fills gaps, never overrides or removes', () => {
  const base: SessionContext = {
    ...emptySessionContext(), occasion: 'party', exclusions: ['black'],
  }

  it('fills only null scalars', () => {
    const merged = mergeParsedPatch(base, { occasion: 'work', season: 'summer' })
    expect(merged.occasion).toBe('party')   // regex value wins — not overridden
    expect(merged.season).toBe('summer')    // gap filled
  })

  it('appends list items without removing existing', () => {
    const merged = mergeParsedPatch(base, { addExclusions: ['white'] })
    expect(merged.exclusions).toEqual(expect.arrayContaining(['black', 'white']))
    expect(merged.exclusions).toHaveLength(2)
  })

  it('an empty patch leaves the context byte-identical', () => {
    expect(mergeParsedPatch(base, {})).toEqual(base)
  })

  it('LLM patch reaches parity with what the regex would have set on a clean phrase', () => {
    // "a dress for a summer wedding" — regex catches all of this; merging the
    // equivalent patch onto a fresh context must not conflict.
    const regex = updateSessionContext(emptySessionContext(), 'a dress for a summer wedding')
    const merged = mergeParsedPatch(regex, { occasion: 'wedding guest', season: 'summer' })
    expect(merged.occasion).toBe('wedding guest')
    expect(merged.season).toBe('summer')
  })
})

describe('the engine applies a contextPatch right after the regex parse', () => {
  it('a patch supplies a signal the bare phrase lacked', () => {
    // "show me something" parses to almost nothing; the LLM patch supplies the
    // brief, and the engine reasons over the merged context.
    const withPatch = discover('show me something nice', emptySessionContext(), 'fashion', undefined, {
      contextPatch: { occasion: 'wedding guest', season: 'summer', formality: 'smart casual' },
    })
    expect(withPatch.updatedContext.occasion).toBe('wedding guest')
    expect(withPatch.updatedContext.season).toBe('summer')
    // a rich-enough brief skips the interrogation and reveals
    expect(withPatch.results.length).toBeGreaterThan(0)
  })

  it('no patch = today’s deterministic behaviour, unchanged', () => {
    const a = discover('a dress for a summer wedding', emptySessionContext(), 'fashion')
    const b = discover('a dress for a summer wedding', emptySessionContext(), 'fashion', undefined, {})
    expect(b.message).toBe(a.message)
    expect(b.results.map(r => r.product.id)).toEqual(a.results.map(r => r.product.id))
  })
})

describe('isEmptyPatch', () => {
  it('true for nothing actionable, false for any signal', () => {
    expect(isEmptyPatch({})).toBe(true)
    expect(isEmptyPatch({ addPreferences: [] })).toBe(true)
    expect(isEmptyPatch({ occasion: 'party' })).toBe(false)
    expect(isEmptyPatch({ addExclusions: ['black'] })).toBe(false)
  })
})

describe('vocabulary is non-empty and self-consistent', () => {
  it('every canonical list has values', () => {
    for (const xs of [OCCASIONS, ACTIVITIES, FORMALITIES, SEASONS, EXCLUSIONS, CONSTRAINTS]) {
      expect(xs.length).toBeGreaterThan(0)
    }
  })

  // Drift guard: the LLM validator enforces vocabulary.ts, but the regex parser
  // (session.ts) emits values independently. If someone adds a regex output and
  // forgets vocabulary.ts, the LLM path silently can't reproduce it. Run phrases
  // that trigger every detector and assert each emitted value round-trips
  // through validateParsedPatch unchanged (i.e. is in the vocabulary).
  it('every value the regex parser emits is in the canonical vocabulary', () => {
    const phrases = [
      'a dress for a wedding', 'something for a party', 'an outfit for work', 'a dinner outfit',
      'black tie gala', 'smart casual', 'a formal cocktail dress', 'casual everyday wear',
      'a summer dress', 'an autumn coat', 'winter wear', 'spring outfit',
      'day hiking gear', 'running kit', 'camping trip',
      'nothing floral', 'no black', 'avoid white', 'without heels', 'no prints', 'not stripes', 'nothing bright', 'no red',
      'an outdoor wedding', 'it gets cold in the evenings', 'hiking in lapland',
      'I already bought boots', 'a 3-hour hike', 'keep it budget',
      'a linen dress', 'lightweight and breathable', 'a classic elegant look',
      'darker richer tones', 'lighter softer tones', 'clean solids', 'a little pattern is welcome',
    ]
    for (const phrase of phrases) {
      const ctx = updateSessionContext(emptySessionContext(), phrase)
      const patch = {
        occasion: ctx.occasion ?? undefined,
        activity: ctx.activity ?? undefined,
        formality: ctx.formality ?? undefined,
        season: ctx.season ?? undefined,
        requestedGarment: ctx.requestedGarment ?? undefined,
        addExclusions: ctx.exclusions,
        addConstraints: ctx.constraints,
        addPreferences: ctx.preferences,
      }
      const validated = validateParsedPatch(patch)
      // scalars survive validation unchanged
      expect(validated.occasion).toBe(patch.occasion)
      expect(validated.activity).toBe(patch.activity)
      expect(validated.formality).toBe(patch.formality)
      expect(validated.season).toBe(patch.season)
      expect(validated.requestedGarment).toBe(patch.requestedGarment)
      // every emitted exclusion/constraint survives (none dropped as unknown)
      for (const e of ctx.exclusions) expect(validated.addExclusions ?? []).toContain(e)
      for (const c of ctx.constraints) expect(validated.addConstraints ?? []).toContain(c)
    }
  })
})

// ── Inversion guard (parse-llm.ts) ──────────────────────────────
// Live-verification regression (2026-07-05): DeepSeek mapped "a black dress"
// → addExclusions:["black"] — a positive mention inverted into a HARD filter.
// The guard drops exclusion tokens mentioned verbatim in a message that
// carries no rejection language; explicit rejections always pass through.
import { dropInvertedExclusions } from '@/lib/discovery/parse-llm'

describe('dropInvertedExclusions', () => {
  it('drops a positive mention shoved into exclusions ("a black dress")', () => {
    expect(dropInvertedExclusions('a black dress for a party', ['black'])).toEqual([])
  })

  it('keeps explicit rejections ("no black please")', () => {
    expect(dropInvertedExclusions('no black please', ['black'])).toEqual(['black'])
  })

  it('keeps paraphrased rejections ("I hate florals")', () => {
    expect(dropInvertedExclusions('I hate florals', ['floral'])).toEqual(['floral'])
  })

  it('keeps "nothing with a print"', () => {
    expect(dropInvertedExclusions('nothing with a print', ['print'])).toEqual(['print'])
  })

  it('keeps "already have heels"', () => {
    expect(dropInvertedExclusions('already have heels', ['heels'])).toEqual(['heels'])
  })

  it('passes through inferred exclusions not mentioned verbatim', () => {
    // model inferred a token that is not literally in the message — trust it
    expect(dropInvertedExclusions('something quieter than last time', ['bright'])).toEqual(['bright'])
  })

  it('drops only the inverted token in a mixed list', () => {
    // no rejection cue: "black" is mentioned (wanted), "floral" is inferred
    expect(dropInvertedExclusions('a black dress', ['black', 'floral'])).toEqual(['floral'])
  })
})
