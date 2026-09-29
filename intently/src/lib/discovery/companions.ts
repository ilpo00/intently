// ─────────────────────────────────────────────
// discovery/companions.ts
//
// Outfit completion — the tailor's "and to go with it…". A real tailor
// dresses the OCCASION, not the garment: a summer-evening wedding means a
// dress AND a light layer for when it cools; trousers want their other half;
// a day on the trail wants something to carry the kit.
//
// Pure Tier-0, same restraint rules as the consultation:
//   · A slot only renders when the CONTEXT calls for it (`when`), when the
//     catalogue genuinely fills it (≥MIN_ITEMS after the same prefilter the
//     shortlist uses — exclusions, palette leans, budget all apply), and when
//     its categories aren't already in the primary results (no duplication,
//     which also keeps basket-mode scenarios add-on-free).
//   · At most MAX_SLOTS groups, MAX_ITEMS pieces each. An out-of-place
//     recommendation is worse than none.
//   · Companion products must carry situation-compatible occasion tags —
//     a hiking shell never "completes" a wedding look.
// ─────────────────────────────────────────────

import type { Product, SessionContext, CompanionSuggestion, DiscoveryResult } from '@/types'
import { prefilter } from './prefilter'
import { opposesPreferenceToken } from './attributes'
import { companionLead, companionWhy } from './voice'

const MAX_SLOTS = 2
const MAX_ITEMS = 3
const MIN_ITEMS = 2

export interface SlotSpec {
  id: string
  // Primary shortlist categories this slot completes.
  primaryCategories: string[]
  // What fills the slot.
  companionCategories: string[]
  // Does the situation call for it? (Restraint lives here.)
  when: (ctx: SessionContext) => boolean
  // Constraints that, ARRIVING on a turn, read as asking for this slot —
  // "it gets cold in the evenings" with a dress already in the cart is a
  // request for the layer itself, not for different dresses.
  triggerConstraints?: string[]
}

const coolContext = (ctx: SessionContext) =>
  ctx.constraints.includes('cold evenings') ||
  ctx.constraints.includes('outdoor venue') ||
  ctx.season === 'autumn' || ctx.season === 'winter'

// Order = priority (first matching slots win the MAX_SLOTS budget).
const SLOTS: SlotSpec[] = [
  {
    // A light layer over a dress/skirt/top when the evening will cool.
    id: 'layer',
    primaryCategories: ['dress', 'skirt', 'top', 'shirt'],
    companionCategories: ['jacket', 'sweatshirt'],
    when: coolContext,
    triggerConstraints: ['cold evenings', 'outdoor venue'],
  },
  {
    // Trousers want a top half; a shirt wants a bottom half. Always sensible.
    id: 'pair',
    primaryCategories: ['trousers'],
    companionCategories: ['shirt', 'top'],
    when: () => true,
  },
  {
    id: 'pair',
    primaryCategories: ['shirt', 'top'],
    companionCategories: ['trousers', 'skirt'],
    when: () => true,
  },
  {
    // Something to carry the kit, when there's an activity to carry it for.
    id: 'carry',
    primaryCategories: ['jacket', 'top', 'sweatshirt'],
    companionCategories: ['backpack'],
    when: ctx => !!ctx.activity,
  },
  {
    // Sun cover for warm-season activity days.
    id: 'shade',
    primaryCategories: ['jacket', 'top', 'backpack', 'sweatshirt'],
    companionCategories: ['sunglasses', 'cap'],
    when: ctx => !!ctx.activity && ctx.season !== 'autumn' && ctx.season !== 'winter',
  },
]

// Occasion families: how the session's occasion words appear in catalogue
// tags ("work" briefs match "office"/"commute" tags, etc.).
const OCCASION_SYNONYMS: Record<string, string[]> = {
  work: ['office', 'commute', 'business'],
  party: ['party', 'social', 'evening', 'celebration'],
  dinner: ['dinner', 'evening', 'date'],
  'wedding guest': ['wedding'],
}

// Occasion compatibility: a companion must share situational ground with the
// brief — same occasion family, a layering tag, or (for activity briefs) the
// general outdoor family. Products with NO occasion tags pass (nothing claimed,
// nothing contradicted). Exported for the cart-anchored primary (engine.ts),
// which must hold the same bar as the rails.
export function occasionCompatible(p: Product, ctx: SessionContext): boolean {
  if (p.occasionTags.length === 0) return true
  const situational = [ctx.occasion, ctx.activity].filter(Boolean) as string[]
  if (situational.length === 0) return true
  const terms = situational.flatMap(s => [s, ...(OCCASION_SYNONYMS[s] ?? [])])
  return p.occasionTags.some(t =>
    terms.some(s => t.includes(s) || s.includes(t)) ||
    t.includes('layering') || t.includes('layer') ||
    (ctx.activity ? ['outdoors', 'outdoor activity', 'sport', 'travel'].includes(t) : false),
  )
}

/**
 * The completion slot a carted item calls for in this situation — the first
 * slot whose primary categories cover the carted category and whose `when`
 * gate fires. This is how a cart anchors a follow-up turn: dress in cart +
 * cold evenings → the layer slot IS the answer.
 */
export function completionSlotFor(
  cartedCategories: string[],
  ctx: SessionContext,
): SlotSpec | null {
  for (const slot of SLOTS) {
    if (!cartedCategories.some(c => slot.primaryCategories.includes(c))) continue
    if (!slot.when(ctx)) continue
    return slot
  }
  return null
}

/** The dominant category of the primary shortlist (what we'd be completing). */
export function dominantCategory(results: DiscoveryResult[]): string | null {
  const counts = new Map<string, number>()
  for (const r of results.slice(0, 6)) {
    counts.set(r.product.category, (counts.get(r.product.category) ?? 0) + 1)
  }
  let best: string | null = null
  let n = 0
  for (const [cat, c] of counts) if (c > n) { best = cat; n = c }
  return best
}

/**
 * Build the "complete the look" groups for a shortlist. `pool` is the full
 * candidate universe for companions (the whole catalogue in deterministic
 * mode; primary candidates ∪ a companion-targeted retrieval in vector mode).
 */
export function buildCompanions(
  ctx: SessionContext,
  primaryResults: DiscoveryResult[],
  pool: Product[],
  excludeIds: Set<string> = new Set(),
): CompanionSuggestion[] {
  if (primaryResults.length === 0) return []
  const primary = dominantCategory(primaryResults)
  if (!primary) return []
  const presentCategories = new Set(primaryResults.map(r => r.product.category))
  const usedIds = new Set([...excludeIds, ...primaryResults.map(r => r.product.id)])

  const out: CompanionSuggestion[] = []
  for (const slot of SLOTS) {
    if (out.length >= MAX_SLOTS) break
    if (out.some(s => s.slotId === slot.id)) continue
    if (!slot.primaryCategories.includes(primary)) continue
    if (!slot.when(ctx)) continue
    // No duplication: if the shortlist already spans these categories (basket
    // mode), the slot has nothing to add.
    if (slot.companionCategories.some(c => presentCategories.has(c))) continue

    const candidates = pool.filter(p =>
      slot.companionCategories.includes(p.category) &&
      !usedIds.has(p.id) &&
      occasionCompatible(p, ctx),
    )
    // Rank with the same prefilter the shortlist uses — but in a small rail a
    // palette-opposing piece is louder than in a 12-grid (a white jacket right
    // after "darker, richer tones" reads as not listening), so drop opposers
    // entirely when enough aligned pieces remain.
    const allRanked = prefilter(candidates, ctx)
    const aligned = allRanked.filter(
      s => !ctx.preferences.some(pref => opposesPreferenceToken(s.product, pref)),
    )
    const ranked = (aligned.length >= MIN_ITEMS ? aligned : allRanked).slice(0, MAX_ITEMS)
    if (ranked.length < MIN_ITEMS) continue

    out.push({
      slotId: slot.id,
      lead: companionLead(slot.id, ctx),
      results: ranked.map(s => ({
        product: s.product,
        matchExplanation: companionWhy(slot.id, s.product),
        relevanceScore: 1,
      })),
    })
    for (const s of ranked) usedIds.add(s.product.id)
  }
  return out
}
