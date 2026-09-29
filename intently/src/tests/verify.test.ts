// ─────────────────────────────────────────────
// Layer-2 grounding: LLM prose must never promise a product the shop doesn't
// show, or an action Intently can't perform. False → keep the template.
// ─────────────────────────────────────────────

import { grounded, claimsUnsupportedCapability, namesUnshownProduct } from '@/lib/discovery/verify'

const CATALOG = [
  'Forever New Women Floral Purple Dress',
  'Arrow Woman Multi Coloured Floral Dress',
  'Mineral Women Floral Orange Dress',
]
const SHOWN = ['Forever New Women Floral Purple Dress']

describe('capability grounding', () => {
  it.each([
    "I've added it to your cart.",
    'Added this to the cart for you to review.',
    "We've reserved the last one in your size.",
    'Your order will be shipped tomorrow.',
    "It'll arrive by Friday.",
    'Free shipping on this one.',
    'Back in stock by next week.',
    'Use the discount code SUMMER10.',
    'I can order it in for you.',
    "I've popped it into your bag.",
    "We've put one aside in your size.",
    "It'll be with you by Thursday.",
    "I'll have it sent over to you.",
    "Consider it done — it's waiting in your basket.",
  ])('rejects "%s"', (text) => {
    expect(claimsUnsupportedCapability(text)).toBe(true)
  })

  it.each([
    'Your dress is settled — these layers would go with it.',
    'Three pieces that fit the evening: light, warm, easy to carry.',
    'Shall we keep it darker, or open the palette up?',
    'The cart already holds your dress, so I focused on layers.',
    'Set the florals aside — solids suit this evening better.',
    'Keep it simple: the jacket over what you already have.',
    'These would be ready for anything the evening throws at you.',
  ])('passes "%s"', (text) => {
    expect(claimsUnsupportedCapability(text)).toBe(false)
  })
})

describe('product grounding', () => {
  it('rejects prose naming a catalogue product that is not shown', () => {
    expect(namesUnshownProduct(
      'You might also love the Arrow Woman Multi Coloured Floral Dress.',
      SHOWN, CATALOG,
    )).toBe(true)
  })

  it('passes prose naming only shown products', () => {
    expect(namesUnshownProduct(
      'The Forever New Women Floral Purple Dress fits the brief.',
      SHOWN, CATALOG,
    )).toBe(false)
  })

  it('never false-positives on ordinary garment words', () => {
    expect(namesUnshownProduct('A floral dress in purple would be lovely.', SHOWN, CATALOG)).toBe(false)
  })
})

describe('grounded() — the route-facing gate', () => {
  it('accepts a faithful, grounded rephrase across all prose fields', () => {
    expect(grounded(
      ['Three pieces for the evening.', 'Darker or lighter?', 'keep it dark', undefined],
      SHOWN, CATALOG,
    )).toBe(true)
  })

  it('rejects when ANY field over-promises', () => {
    expect(grounded(
      ['Three pieces for the evening.', "I've added one to your cart."],
      SHOWN, CATALOG,
    )).toBe(false)
  })

  it('rejects when a lead names an unshown product', () => {
    expect(grounded(
      ['Three pieces.', 'To go with it: the Mineral Women Floral Orange Dress.'],
      SHOWN, CATALOG,
    )).toBe(false)
  })
})
