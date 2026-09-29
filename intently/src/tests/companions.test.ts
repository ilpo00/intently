// ─────────────────────────────────────────────
// Outfit completion — the tailor dresses the occasion, not just the garment.
//
// The rachel case that motivated this layer: "a dress for an outdoor summer
// wedding … it gets cold in the evenings" must produce a LAYER OFFER beside
// the dresses (a light jacket/cardigan to go over it), never a false claim
// that the dresses got "warmer", and never jackets flooding the dress grid.
//
// Vision-catalogue scenarios pass the catalogue in as candidates directly —
// composeFromCandidates is the seam, no env flip needed.
// ─────────────────────────────────────────────

import { composeFromCandidates, discover } from '@/lib/discovery/engine'
import { buildCompanions } from '@/lib/discovery/companions'
import { emptySessionContext, type Product, type SessionContext } from '@/types'
import visionCatalogJson from '@/lib/catalog/vision-catalog.json'

const vision = visionCatalogJson as unknown as Product[]

const WEDDING = "I need a dress for a friend's wedding in July. It's outdoors, smart casual."

describe('the rachel case: layering, not warmer dresses', () => {
  const turn1 = composeFromCandidates(WEDDING, emptySessionContext(), vision)
  const turn2 = composeFromCandidates(
    "it gets cold in the evenings", turn1.updatedContext, vision,
  )

  it('the primary shortlist stays dresses — layers never flood the grid', () => {
    expect(turn1.results.length).toBeGreaterThan(0)
    expect(turn1.results.every(r => r.product.category === 'dress')).toBe(true)
    expect(turn2.results.every(r => r.product.category === 'dress')).toBe(true)
  })

  it('cold evenings produces a layer group beside the dresses', () => {
    const layer = turn2.addOns?.find(a => a.slotId === 'layer')
    expect(layer).toBeDefined()
    expect(layer!.results.length).toBeGreaterThanOrEqual(2)
    expect(layer!.results.every(r =>
      ['jacket', 'sweatshirt'].includes(r.product.category))).toBe(true)
  })

  it('the message says a layer was set beside them — not "leaning warmer"', () => {
    expect(turn2.message).toContain('light layer beside them')
    expect(turn2.message).not.toContain('leaning warmer')
  })

  it('the outdoor venue alone already earns the layer offer (before anyone mentions cold)', () => {
    expect(turn1.addOns?.some(a => a.slotId === 'layer')).toBe(true)
  })

  it('layer pieces respect exclusions ("nothing black")', () => {
    const turn3 = composeFromCandidates('nothing black', turn2.updatedContext, vision)
    const layer = turn3.addOns?.find(a => a.slotId === 'layer')
    if (layer) {
      expect(layer.results.every(r => !r.product.color.some(c => c.includes('black')))).toBe(true)
    }
  })
})

describe('outfit pairing (toes-to-hair direction)', () => {
  it('"trousers for work" offers the other half of the outfit', () => {
    // Rich enough to skip the consultation (classic + work + summer).
    const r = composeFromCandidates('classic trousers for work this summer', emptySessionContext(), vision)
    expect(r.results.length).toBeGreaterThan(0)
    expect(r.results.every(x => x.product.category === 'trousers')).toBe(true)
    const pair = r.addOns?.find(a => a.slotId === 'pair')
    expect(pair).toBeDefined()
    expect(pair!.results.every(x => ['shirt', 'top'].includes(x.product.category))).toBe(true)
  })

  it('a hiking jacket brief gets carry/shade companions (outdoor catalogue)', () => {
    const r = discover('a lightweight jacket for day hiking in summer', emptySessionContext(), 'outdoor')
    expect(r.results.every(x => x.product.category === 'jacket')).toBe(true)
    const slots = (r.addOns ?? []).map(a => a.slotId)
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.every(s => ['carry', 'shade'].includes(s))).toBe(true)
  })
})

describe('restraint — never pushy, never out of place', () => {
  const turn1 = composeFromCandidates(WEDDING, emptySessionContext(), vision)
  const turn2 = composeFromCandidates("it gets cold in the evenings", turn1.updatedContext, vision)

  it('at most two groups, two to three pieces each', () => {
    for (const t of [turn1, turn2]) {
      const groups = t.addOns ?? []
      expect(groups.length).toBeLessThanOrEqual(2)
      for (const g of groups) {
        expect(g.results.length).toBeGreaterThanOrEqual(2)
        expect(g.results.length).toBeLessThanOrEqual(3)
      }
    }
  })

  it('companions never duplicate categories already in the shortlist', () => {
    const primary = new Set(turn2.results.map(r => r.product.category))
    for (const g of turn2.addOns ?? []) {
      expect(g.results.every(r => !primary.has(r.product.category))).toBe(true)
    }
  })

  it('every group leads with a situation-rooted reason', () => {
    for (const g of turn2.addOns ?? []) {
      expect(g.lead.length).toBeGreaterThan(10)
    }
  })

  it('the basket scenario stays add-on free (its grid already spans the kit)', () => {
    const r = discover(
      "I just bought hiking boots and I'm doing 3-hour day hikes. What else do I need?",
      emptySessionContext(),
      'outdoor',
    )
    expect(r.addOns ?? []).toHaveLength(0)
  })

  it('no add-ons without primary results', () => {
    expect(buildCompanions(emptySessionContext(), [], vision)).toHaveLength(0)
  })
})

describe('honesty when the catalogue cannot layer (42-dress demo set)', () => {
  it('claims neither warmth nor a layer — acknowledges and stands firm', () => {
    const turn1 = discover(WEDDING, emptySessionContext(), 'fashion')
    const turn2 = discover('it gets cold in the evenings', turn1.updatedContext, 'fashion')
    expect(turn2.addOns ?? []).toHaveLength(0)
    expect(turn2.message).not.toContain('leaning warmer')
    expect(turn2.message).not.toContain('layer beside')
    expect(turn2.message).toContain('Cold evenings — noted')
  })

  it('outdoor kit briefs still honestly lean warmer (jackets genuinely re-rank)', () => {
    const turn1 = discover(
      "I just bought hiking boots and I'm doing 3-hour day hikes. What else do I need?",
      emptySessionContext(), 'outdoor',
    )
    const turn2 = discover(
      "I'll be hiking in Lapland in August, so evenings can be cold.",
      turn1.updatedContext, 'outdoor',
    )
    expect(turn2.message).toContain('leaning warmer')
  })
})

describe('the cart anchors the context (never re-sell the dress over their arm)', () => {
  const turn1 = composeFromCandidates(WEDDING, emptySessionContext(), vision)
  const chosen = turn1.results[0].product
  const cart = [{ id: chosen.id, category: chosen.category, name: chosen.name }]

  it('a carted item is never offered again — results or rails', () => {
    const turn2 = composeFromCandidates('nothing black', turn1.updatedContext, vision, undefined, { cart })
    expect(turn2.results.some(r => r.product.id === chosen.id)).toBe(false)
    for (const g of turn2.addOns ?? []) {
      expect(g.results.some(r => r.product.id === chosen.id)).toBe(false)
    }
  })

  it('THE bug report: carted dress + "cold evenings" pivots the grid to layers', () => {
    const turn2 = composeFromCandidates(
      'it gets cold in the evenings', turn1.updatedContext, vision, undefined, { cart },
    )
    expect(turn2.results.length).toBeGreaterThanOrEqual(2)
    expect(turn2.results.every(r => ['jacket', 'sweatshirt'].includes(r.product.category))).toBe(true)
    expect(turn2.results.some(r => r.product.id === chosen.id)).toBe(false)
    expect(turn2.message).toContain('is settled')
  })

  it('the pivot persists: a palette refinement keeps refining the layers', () => {
    const turn2 = composeFromCandidates(
      'it gets cold in the evenings', turn1.updatedContext, vision, undefined, { cart },
    )
    expect(turn2.updatedContext.requestedGarment).toBe('layer')
    const turn3 = composeFromCandidates(
      'darker, richer tones', turn2.updatedContext, vision, undefined, { cart },
    )
    expect(turn3.results.every(r => ['jacket', 'sweatshirt'].includes(r.product.category))).toBe(true)
  })

  it('a refinement that is NOT a completion ask stays on dresses', () => {
    const turn2 = composeFromCandidates('nothing black', turn1.updatedContext, vision, undefined, { cart })
    expect(turn2.results.every(r => r.product.category === 'dress')).toBe(true)
  })

  it('naming a garment overrides the anchor — "another dress" means dresses', () => {
    const turn2 = composeFromCandidates(
      'show me another dress option', turn1.updatedContext, vision, undefined, { cart },
    )
    expect(turn2.results.every(r => r.product.category === 'dress')).toBe(true)
    expect(turn2.results.some(r => r.product.id === chosen.id)).toBe(false)
  })

  it('an empty cart changes nothing', () => {
    const withEmpty = composeFromCandidates(
      'it gets cold in the evenings', turn1.updatedContext, vision, undefined, { cart: [] },
    )
    expect(withEmpty.results.every(r => r.product.category === 'dress')).toBe(true)
  })
})

describe('the suit case (an unstocked garment with a clear occasion)', () => {
  it('honesty beat + confident results, no fake suits', () => {
    const ctx: SessionContext = emptySessionContext()
    const r = composeFromCandidates('a suit for an outdoor wedding in June, smart casual', ctx, vision)
    expect(r.results.length).toBeGreaterThan(0)
    expect(r.message).toContain('No suit in the collection')
    // The honest substitute IS the assembled suit: shirts + trousers.
    expect(r.results.every(x => ['shirt', 'trousers'].includes(x.product.category))).toBe(true)
  })

  it('"jeans for work" anchors on trousers — named gap, honest stand-in, paired shirt', () => {
    const r = composeFromCandidates(
      'classic jeans for work this summer', emptySessionContext(), vision,
    )
    expect(r.message).toContain('No jeans in the collection')
    expect(r.results.every(x => x.product.category === 'trousers')).toBe(true)
    expect(r.addOns?.some(a => a.slotId === 'pair')).toBe(true)
  })
})
