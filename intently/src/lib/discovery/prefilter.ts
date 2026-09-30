// ─────────────────────────────────────────────
// discovery/prefilter.ts
//
// Deterministic relevance scoring over the in-memory catalogue. For the
// Phase-1 catalogue (tens–hundreds of items) this stands in for vector
// retrieval; in Phase 2 it becomes the fast pre-filter that runs AFTER
// pgvector narrows the catalogue (see docs/roadmap.md).
//
// Hard exclusions (e.g. "not floral") drop a product entirely — that's what
// makes the conversational refinement visibly change the results.
// ─────────────────────────────────────────────

import type { Product, SessionContext, Formality } from '@/types'
import {
  matchesPreferenceToken, opposesPreferenceToken, isWomenswearCategory, garmentCategories,
  isColourWord, namedColours, wearsColour, hasColourAccent,
} from './attributes'

// A colour named outright is the most literal request there is — a shopper who
// asks for "a black dress" must see black dresses first, whatever the occasion
// tags say. So it outweighs the occasion signal (+5). Applied once per product
// however many colours were named ("black or navy" = either). A piece that
// only carries the colour as an accent gets a small nudge, nothing more.
const NAMED_COLOUR_BOOST = 7
const NAMED_COLOUR_ACCENT_BOOST = 1.5

export interface ScoredProduct {
  product: Product
  score: number          // higher = more relevant
}

const FORMALITY_LEVEL: Record<Formality, number> = {
  casual: 2, 'smart casual': 3, formal: 4, 'black tie': 5,
}

// Does this product violate a stated exclusion? If so it's dropped outright.
function isExcluded(p: Product, exclusions: string[]): boolean {
  for (const ex of exclusions) {
    const e = ex.toLowerCase()
    if (e === 'floral' && p.pattern === 'floral') return true
    if (e === 'print' && p.pattern === 'print') return true
    if (e === 'stripe' && p.pattern === 'stripe') return true
    if (e === 'heels' && p.category === 'heels') return true
    if (['black', 'white', 'red'].includes(e) && p.color.some(c => c.includes(e))) return true
  }
  return false
}

// "already has footwear" → don't recommend shoes back to the hiker.
function isCategoryRuledOut(p: Product, ctx: SessionContext): boolean {
  if (ctx.constraints.includes('already has footwear') && (p.category === 'shoes' || p.category === 'heels')) {
    return true
  }
  // Audience: 'for him' hard-excludes the conventionally womenswear categories
  // (dress/skirt/heels) — the one recommendation embarrassment worth a hard
  // line. Deliberately asymmetric: the catalogue has no per-item gender data,
  // so category is the only claim we can honestly act on; 'women'/'unisex'/
  // unknown exclude nothing. EXCEPTION: an explicitly requested garment wins —
  // a man asking for a dress gets dresses, no questions asked.
  if (ctx.audience === 'men' && isWomenswearCategory(p.category)) {
    const requested = ctx.requestedGarment ? garmentCategories(ctx.requestedGarment) : []
    if (!requested.includes(p.category)) return true
  }
  return false
}

function scoreProduct(p: Product, ctx: SessionContext): number {
  // Baseline: every surviving candidate is already catalogue-appropriate.
  let score = 1

  // Occasion / activity signal — the strongest driver.
  const situational = [ctx.occasion, ctx.activity].filter(Boolean) as string[]
  for (const s of situational) {
    if (p.occasionTags.some(t => t.includes(s) || s.includes(t))) score += 5
  }
  // An activity (hiking etc.) also rewards general outdoor/sport tags so base
  // layers and accessories join the basket, not just exact "day hiking" hits.
  if (ctx.activity && p.occasionTags.some(t => ['outdoors', 'outdoor activity', 'sport', 'travel', 'base layer'].includes(t))) {
    score += 2
  }
  // Constraint-driven occasion hints.
  if (ctx.constraints.includes('outdoor venue') && p.occasionTags.includes('outdoor event')) score += 3
  // Cold evenings strongly favour insulating layers — but only on KIT briefs
  // (outdoor gear / an activity), where a warmer basket is the right answer.
  // On a garment brief ("a dress, evenings get cold") the layer belongs in
  // the outfit-completion rail, not flooding the primary shortlist.
  if (ctx.constraints.includes('cold evenings')
      && (p.catalog === 'outdoor' || ctx.activity)
      && (p.category === 'jacket' || p.category === 'sweatshirt')) score += 8

  // Formality proximity.
  if (ctx.formality) {
    const target = FORMALITY_LEVEL[ctx.formality]
    score += 3 * (1 - Math.abs(target - p.formalityLevel) / 4)
  }

  // Season match.
  if (ctx.season && p.season.includes(ctx.season)) score += 2

  // Preferences — canonical consultation tokens (darker tones, clean solids,
  // warmth first, …) match via the shared attribute matchers; anything else
  // (linen, lightweight, earthy, …) falls through to the enriched text.
  // Opposing a palette/pattern lean is a gentle penalty, never a drop — an
  // A/B answer reorders the shortlist, it doesn't punish the other half.
  const colours = namedColours(ctx.preferences)
  if (colours.some(c => wearsColour(p, c))) score += NAMED_COLOUR_BOOST
  else if (colours.some(c => hasColourAccent(p, c))) score += NAMED_COLOUR_ACCENT_BOOST
  for (const pref of ctx.preferences) {
    if (isColourWord(pref)) continue // handled above, as one signal
    if (matchesPreferenceToken(p, pref)) score += 2.5
    else if (opposesPreferenceToken(p, pref)) score -= 1.5
  }

  // Floor above zero: soft leans must only ever reorder. Hard lines are the
  // exclusions, applied before scoring.
  return Math.max(score, 0.1)
}

/**
 * Score, drop exclusions, and sort. Returns the full ranked candidate set;
 * the engine applies category diversity + a final cap (so a basket scenario
 * doesn't return 12 of the same category).
 */
export function prefilter(products: Product[], ctx: SessionContext): ScoredProduct[] {
  const surviving = products.filter(
    p => !isExcluded(p, ctx.exclusions) && !isCategoryRuledOut(p, ctx),
  )
  const scored = surviving.map(product => ({ product, score: scoreProduct(product, ctx) }))

  // "Keep it considered" — relative to THIS candidate set, not an absolute
  // price band, so the lean adapts when the catalogue (PIM source) changes.
  if (ctx.constraints.includes('budget conscious') && scored.length > 0) {
    const prices = surviving.map(p => p.price).sort((a, b) => a - b)
    const median = prices[Math.floor(prices.length / 2)]
    for (const s of scored) {
      if (s.product.price <= median) s.score += 2
    }
  }

  return scored.sort((a, b) => b.score - a.score)
}
