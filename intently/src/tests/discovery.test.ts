import { discover, composeFromCandidates } from '@/lib/discovery/engine'
import { updateSessionContext } from '@/lib/discovery/session'
import { inferCatalog } from '@/lib/discovery/infer-catalog'
import { emptySessionContext, type Product } from '@/types'
import visionCatalogForGrammar from '@/lib/catalog/vision-catalog.json'

describe('inferCatalog — catalog routing', () => {
  const empty = emptySessionContext()
  it('routes an outdoor WEDDING to fashion (not misled by "outdoor")', () => {
    expect(inferCatalog("a dress for a friend's outdoor wedding in July", empty)).toBe('fashion')
  })
  it('routes a hiking situation to outdoor', () => {
    expect(inferCatalog('I just bought hiking boots for 3-hour day hikes', empty)).toBe('outdoor')
  })
  it('keeps the catalog stable on a refinement once an activity is set', () => {
    const ctx = { ...empty, activity: 'day hiking' }
    expect(inferCatalog("it'll be cold in the evenings", ctx)).toBe('outdoor')
  })
})

describe('discovery engine — Scenario A: wedding-guest dress', () => {
  const turn1 = discover(
    "I need a dress for a friend's wedding in July. It's outdoors, smart casual.",
    emptySessionContext(),
    'fashion',
  )

  it('parses the situation', () => {
    expect(turn1.updatedContext.occasion).toBe('wedding guest')
    expect(turn1.updatedContext.formality).toBe('smart casual')
    expect(turn1.updatedContext.season).toBe('summer')
    expect(turn1.updatedContext.constraints).toContain('outdoor venue')
  })

  it('returns dresses with explanations', () => {
    expect(turn1.results.length).toBeGreaterThan(0)
    expect(turn1.results.every(r => r.product.category === 'dress')).toBe(true)
    expect(turn1.results[0].matchExplanation.length).toBeGreaterThan(0)
    expect(turn1.results[0].product.isBestMatch).toBe(true)
  })

  it('Turn 2: "not floral" removes every floral result', () => {
    const turn2 = discover(
      'Actually I already have a floral dress so something different.',
      turn1.updatedContext,
      'fashion',
    )
    expect(turn2.updatedContext.exclusions).toContain('floral')
    expect(turn2.results.every(r => r.product.pattern !== 'floral')).toBe(true)
    expect(turn2.results.length).toBeGreaterThan(0)
  })
})

describe('discovery engine — Scenario B: casual day hiker', () => {
  const turn1 = discover(
    "I just bought hiking boots and I'm doing 3-hour day hikes. What else do I need?",
    emptySessionContext(),
    'outdoor',
  )

  it('parses the activity and footwear constraint', () => {
    expect(turn1.updatedContext.activity).toBe('day hiking')
    expect(turn1.updatedContext.constraints).toContain('already has footwear')
  })

  it('returns a cross-category basket and no footwear', () => {
    expect(turn1.results.length).toBeGreaterThan(0)
    const cats = new Set(turn1.results.map(r => r.product.category))
    expect(cats.has('shoes')).toBe(false)
    expect(cats.has('heels')).toBe(false)
    // basket spans more than one category
    expect(cats.size).toBeGreaterThan(1)
  })

  it('Turn 2: cold Lapland evenings surfaces a jacket/layer', () => {
    const turn2 = discover(
      "I'll be hiking in Lapland in August, so evenings can be cold.",
      turn1.updatedContext,
      'outdoor',
    )
    expect(turn2.updatedContext.constraints).toContain('cold evenings')
    const topCats = turn2.results.slice(0, 5).map(r => r.product.category)
    expect(topCats.some(c => c === 'jacket' || c === 'sweatshirt')).toBe(true)
  })
})

describe('updateSessionContext', () => {
  it('accumulates exclusions across turns', () => {
    const c1 = updateSessionContext(emptySessionContext(), 'no floral please')
    const c2 = updateSessionContext(c1, 'and not black')
    expect(c2.exclusions).toEqual(expect.arrayContaining(['floral', 'black']))
    expect(c2.turnCount).toBe(2)
  })

  it.each([
    'nothing floral',
    'no florals',
    'not floral',
    'I already have a floral dress so something different',
  ])('parses "%s" as a floral exclusion', (phrase) => {
    expect(updateSessionContext(emptySessionContext(), phrase).exclusions).toContain('floral')
  })

  it.each([
    "it'll be cold in the evenings",
    'evenings can be cold',
    'it gets cold at night',
  ])('parses "%s" as a cold-evenings constraint', (phrase) => {
    expect(updateSessionContext(emptySessionContext(), phrase).constraints).toContain('cold evenings')
  })
})

describe('why-line grammar', () => {
  it('uses "an" before a vowel-initial colour (voice rule 7)', () => {
    const vision = visionCatalogForGrammar as unknown as Product[]
    const olive = vision.find(p => p.name === 'Olive Green T-Shirt Dress')!
    const r = composeFromCandidates('a dress for the weekend', emptySessionContext(), [olive])
    const why = r.results[0]?.matchExplanation ?? ''
    expect(why).toContain('an olive green camo piece')
    expect(why).not.toMatch(/\ba olive\b/)
  })
})
