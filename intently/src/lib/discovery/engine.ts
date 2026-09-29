// ─────────────────────────────────────────────
// discovery/engine.ts
//
// The deterministic discovery engine: situation → explained shortlist.
// Composes session parsing + pre-filter + templated explanations. This is
// the no-key path (CI / offline) and the safety net the /api/discover route
// falls back to when the LLM re-ranker is unavailable.
// ─────────────────────────────────────────────

import type {
  Product, SessionContext, DiscoveryResult, Catalog, ConsultQuestion, CompanionSuggestion,
  CartContextItem, ParsedContextPatch,
} from '@/types'
import { mergeParsedPatch } from './parse-context'
import { getProductsByCatalog } from '@/lib/data'
import { updateSessionContext } from './session'
import { prefilter, type ScoredProduct } from './prefilter'
import { matchSituation, scoreSituation, DEFAULT_PROFILES, type SituationProfile } from './situation-match'
import {
  shouldConsult, canSharpen, nextQuestion, applyAnswer, findOption, signalCount,
  type ConsultAnswer,
} from './consult'
import { askMessage, revealMessage, garmentGapPrefix, cartAnchoredMessage } from './voice'
import { buildCompanions, completionSlotFor, occasionCompatible } from './companions'
import {
  matchesPreferenceToken, detectRequestedGarment, garmentCategories, garmentFallbackCategories,
  isAccessoryCategory,
  PREF_DARKER, PREF_LIGHTER, PREF_SOLIDS, PREF_PATTERN,
  PREF_TRIM, PREF_SHOULDERS, PREF_MIDDLE, PREF_GENEROUS,
} from './attributes'

export interface DiscoverResponse {
  message: string
  results: DiscoveryResult[]
  updatedContext: SessionContext
  // The consultation beat. With results: [] this is a BLOCKING ask (the
  // ask-before-offer turn); alongside results it's a non-blocking "sharpen it"
  // offer the UI renders as tappable A/B options.
  question?: ConsultQuestion
  // Outfit completion — context-justified companion groups ("a light layer
  // for the evening") rendered as a "complete the look" rail. Never pushy:
  // see discovery/companions.ts for the restraint rules.
  addOns?: CompanionSuggestion[]
  // The garment the shopper asked for that this shortlist can't satisfy (the
  // honesty beat fired). Exposed structurally so callers — notably the LLM
  // re-voicer — read the fact instead of regexing the rendered message.
  gapGarment?: string
}

export interface ComposeOpts {
  answer?: ConsultAnswer
  // Candidate universe for outfit completion. Defaults to `candidates`; the
  // vector-retrieval route passes a wider pool so a dress-narrowed top-k
  // doesn't hide every jacket from the layer slot.
  companionPool?: Product[]
  // The shopper's cart (UI state, not session state). Carted items are never
  // re-offered, and a cart item can ANCHOR a follow-up turn — dress in cart +
  // "it gets cold in the evenings" makes the layer the primary answer.
  cart?: CartContextItem[]
  // Tier-1 comprehension: a validated LLM patch (parse-llm.ts) folded in right
  // after the regex parse — regex-first, the patch fills gaps. The route passes
  // it when DISCOVERY_PARSER=llm; absent = today's deterministic comprehension.
  contextPatch?: ParsedContextPatch
}

// After a cart-anchored pivot, the running "what they're shopping for" becomes
// the slot's garment word so refinements stick to the pivoted grid.
const ANCHOR_GARMENT_WORD: Record<string, string> = {
  layer: 'layer',
  pair: 'top',
  carry: 'backpack',
  shade: 'sunglasses',
}

// Tailor acknowledgments — a chosen preference is reflected back in the "why",
// but only when the product genuinely expresses it (never claim falsely).
const PREF_ACKNOWLEDGMENTS: Array<[string, string]> = [
  [PREF_DARKER, 'sits in the deeper tones you asked for'],
  [PREF_LIGHTER, 'sits in the softer tones you asked for'],
  [PREF_SOLIDS, 'keeps to the clean solids you wanted'],
  [PREF_PATTERN, 'brings the little pattern you welcomed'],
  // Build/fit acknowledgments — silhouette-backed (matchesPreferenceToken
  // checks the product's actual silhouette), so the claim is always honest.
  [PREF_TRIM, 'cut close and trim, the way you asked'],
  [PREF_SHOULDERS, 'cut with room through the shoulders'],
  [PREF_MIDDLE, 'falls easy through the middle'],
  [PREF_GENEROUS, 'cut generous and easy, as asked'],
]

// A short, situation-referencing explanation — "why this fits", not "what this is".
function explain(product: Product, ctx: SessionContext): string {
  const bits: string[] = []
  const occasion = ctx.occasion ?? ctx.activity
  // Only claim occasion fit when the product actually carries a matching tag —
  // never assert "works for wedding guest" about something that doesn't.
  const matchesOccasion = !!occasion && product.occasionTags.some(
    t => t.includes(occasion) || occasion.includes(t),
  )
  if (matchesOccasion) bits.push(`works for ${occasion}`)
  // The consultation payoff: what the shopper chose, visibly honoured.
  for (const [token, ack] of PREF_ACKNOWLEDGMENTS) {
    if (ctx.preferences.includes(token) && matchesPreferenceToken(product, token)) {
      bits.push(ack)
      break // one acknowledgment per piece keeps the line crisp
    }
  }
  if (ctx.formality) bits.push(`reads ${ctx.formality}`)
  if (ctx.season && product.season.includes(ctx.season)) bits.push(`right for ${ctx.season}`)
  if (ctx.constraints.includes('outdoor venue') && product.occasionTags.includes('outdoor event')) {
    bits.push('holds up at an outdoor venue')
  }
  if (ctx.constraints.includes('cold evenings') && (product.category === 'jacket' || product.category === 'sweatshirt')) {
    bits.push('adds a warm layer for cold evenings')
  }
  const lead = bits.length
    ? `This ${product.category} ${bits.slice(0, 2).join(' and ')}`
    : `This ${product.category} fits what you described`
  const patterned = [product.color[0], product.pattern].filter(Boolean).join(' ')
  const detail = product.pattern !== 'solid'
    ? `— ${/^[aeiou]/i.test(patterned) ? 'an' : 'a'} ${patterned} piece`
    : product.color[0] ? `— in ${product.color[0]}` : ''
  return `${lead} ${detail}.`.replace(/\s+/g, ' ').trim()
}

// Round-robin across categories so a basket scenario (hiking → jacket +
// daypack + sunglasses + base layer) returns a curated cross-category spread,
// faithful to the brief ("rain jacket stays, adds a layer, sunglasses remain")
// rather than 12 of one category. Categories are visited in order of their
// best-scoring member, so a refinement that boosts a category (cold → jackets)
// leads the spread. A single-category result (dresses) is returned fully ranked.
function diversifyByCategory(scored: ScoredProduct[], limit: number): ScoredProduct[] {
  const byCat = new Map<string, ScoredProduct[]>()
  for (const s of scored) {
    const list = byCat.get(s.product.category) ?? []
    list.push(s)
    byCat.set(s.product.category, list)
  }
  if (byCat.size <= 1) return scored.slice(0, limit)

  const cats = [...byCat.keys()].sort(
    (a, b) => byCat.get(b)![0].score - byCat.get(a)![0].score,
  )
  const out: ScoredProduct[] = []
  for (let round = 0; out.length < limit; round++) {
    let added = false
    for (const c of cats) {
      const item = byCat.get(c)![round]
      if (item) { out.push(item); added = true; if (out.length >= limit) break }
    }
    if (!added) break
  }
  return out
}

// Hand-picked, never padded. Two mechanisms keep the shortlist honest:
//   · a relevance cutoff — only pieces genuinely close to the best stay
//     (a flat, signal-less brief keeps everything: that's the tailor's pick,
//     not filler; the moment signals sharpen the scores, the tail drops), and
//   · a confidence-scaled cap — two real signals (e.g. both consultation
//     taps, or one tap + a parsed constraint) earn the tight, hand-picked
//     shelf; the 12-wide one is reserved for the genuinely-no-information
//     brief ("surprise me" with nothing else), where breadth IS the pick.
// MIN_SHOW guards the degenerate case: a 1-piece reveal reads as broken, so
// the closest alternatives round it out (their why-lines stay honest — they
// simply carry plainer reasons).
const REL_FLOOR = 0.5
const MIN_SHOW = 3
const LIMIT_COLD = 12
const LIMIT_CONSULTED = 8

function toResults(scored: ScoredProduct[], ctx: SessionContext, limit?: number): DiscoveryResult[] {
  const max = scored[0]?.score || 1
  const worthy = scored.filter(s => s.score >= REL_FLOOR * max)
  const pool = worthy.length >= MIN_SHOW ? worthy : scored.slice(0, MIN_SHOW)
  const cap = limit ?? (signalCount(ctx) >= 2 ? LIMIT_CONSULTED : LIMIT_COLD)
  const picked = diversifyByCategory(pool.filter(s => s.score > 0), cap)
  return picked.map((s, i) => ({
    product: { ...s.product, isBestMatch: i === 0 },
    matchExplanation: explain(s.product, ctx),
    relevanceScore: max > 0 ? Math.round((s.score / max) * 100) / 100 : 0,
  }))
}

/**
 * Compose a turn from an already-retrieved candidate set. This is the shared
 * tail of every retrieval strategy: parse the turn into context (and apply a
 * tapped consultation answer, if any), then either ASK — when the brief is too
 * thin and a question would genuinely narrow the live candidates — or OFFER:
 * filter (hard exclusions) + score + diversify + explain.
 *
 * The candidate set is the only thing that differs between strategies:
 *   - deterministic (default): the whole in-memory catalogue for the catalog.
 *   - vector (opt-in): the top-k from the enrichment layer's pgvector/Xenova
 *     retrieval (see discovery/retrieve.ts). Same products, narrowed upstream.
 */
export function composeFromCandidates(
  query: string,
  prev: SessionContext,
  candidates: Product[],
  profiles: SituationProfile[] = DEFAULT_PROFILES,
  opts: ComposeOpts = {},
): DiscoverResponse {
  const { answer } = opts
  let updatedContext = updateSessionContext(prev, query)
  // Regex-first comprehension: the LLM patch (if any) fills gaps the regex
  // missed; then the explicit tapped option wins last (most explicit signal).
  if (opts.contextPatch) updatedContext = mergeParsedPatch(updatedContext, opts.contextPatch)
  const answered = answer ? findOption(answer) : undefined
  if (answer) updatedContext = applyAnswer(updatedContext, answer)

  let scored = prefilter(candidates, updatedContext)
  // Optional soft situation bias. Multiplicative so it re-orders by "how people
  // dress for this" without ever excluding — a de-emphasised garment just drops
  // in rank. User exclusions stay the only hard lines (already applied inside
  // prefilter). The server route passes the ACTIVE, curator-tuned profiles
  // (per-situation on/off); an empty/undefined set means no situation emphasis.
  if (profiles && profiles.length) {
    const prof = matchSituation(query, profiles)
    if (prof) {
      scored = [...scored]
        .map(s => ({ product: s.product, score: s.score * (1 + scoreSituation(s.product, prof).score) }))
        .sort((a, b) => b.score - a.score)
    }
  }
  // Never re-offer what's already in the cart — a tailor doesn't try to sell
  // you the dress over your arm. Carted ids drop from results AND rails.
  const cart = opts.cart ?? []
  const cartIds = new Set(cart.map(c => c.id))
  if (cartIds.size > 0) scored = scored.filter(s => !cartIds.has(s.product.id))

  const surviving = scored.map(s => s.product)

  // Ask-before-offer: a thin brief earns a question, not a guess — provided a
  // question exists whose every answer would leave a real shortlist.
  if (shouldConsult(updatedContext)) {
    const q = nextQuestion(updatedContext, surviving)
    if (q) {
      const ctxAsked: SessionContext = {
        ...updatedContext,
        // Mark-on-ask: an ignored question is never repeated.
        askedQuestions: [...updatedContext.askedQuestions, q.id],
      }
      return {
        message: askMessage(prev, updatedContext, q, answered),
        results: [],
        updatedContext: ctxAsked,
        question: q,
      }
    }
  }

  const namedNow = detectRequestedGarment(query)?.word
  const firstReveal = prev.revealCount === 0

  // ── Cart-anchored turn? ──
  // The shopper already chose a piece; this turn asks what goes WITH it. That
  // reading applies only when no garment is named now, no option was tapped,
  // and the turn either arrived with a slot-triggering constraint ("it gets
  // cold in the evenings") or added nothing parseable at all ("what else?").
  const anchorSlot = cart.length > 0 && !namedNow && !answer
    ? completionSlotFor([...new Set(cart.map(c => c.category))], updatedContext)
    : null
  const newConstraints = updatedContext.constraints.filter(c => !prev.constraints.includes(c))
  const slotTriggered = !!anchorSlot
    && newConstraints.some(c => anchorSlot.triggerConstraints?.includes(c))
  const quietAsk = signalCount(updatedContext) === signalCount(prev) && prev.turnCount > 0
  const anchorScored = anchorSlot
    ? scored.filter(s =>
        anchorSlot.companionCategories.includes(s.product.category) &&
        occasionCompatible(s.product, updatedContext))
    : []
  const anchored = !!anchorSlot && (slotTriggered || quietAsk) && anchorScored.length >= 2

  // A named garment makes its categories the PRIMARY shortlist: "a dress,
  // evenings get cold" keeps the grid dresses — the layer goes in the
  // completion rail, not splashed across the main results. An unstocked
  // garment anchors on its closest honest substitute ("jeans" → trousers,
  // "a suit" → shirt + trousers) while the honesty beat names the gap.
  // Falls back to the full mix (basket mode) when nothing can anchor.
  const garmentWord = updatedContext.requestedGarment ?? ''
  const exactCategories = garmentCategories(garmentWord)
  const wantedCategories = exactCategories.length > 0
    ? exactCategories
    : garmentFallbackCategories(garmentWord)

  // Wise listing: on a CLOTHES brief, accessories are not clothes — a cap or
  // a backpack never pads the primary grid. They still reach the shopper, but
  // through the outfit-completion rail (carry/shade), where the context
  // justifies them — that's the cross-sell surface, not the answer itself.
  // Kit briefs (an activity, or the outdoor catalogue) keep the full mix — a
  // hiking basket genuinely IS jacket + daypack + cap. An explicitly
  // requested accessory anchors via wantedCategories as usual, and a
  // cart-anchored pivot (carry/shade) draws from the unscoped set below.
  const kitBrief = !!updatedContext.activity || candidates[0]?.catalog === 'outdoor'
  const accessoryAsked = wantedCategories.some(isAccessoryCategory)
  const gridPool = kitBrief || accessoryAsked
    ? scored
    : scored.filter(s => !isAccessoryCategory(s.product.category))

  const primaryScored = anchored
    ? anchorScored
    : wantedCategories.length > 0
      ? gridPool.filter(s => wantedCategories.includes(s.product.category))
      : gridPool
  const useSplit = anchored || (wantedCategories.length > 0 && primaryScored.length >= 4)

  const results = toResults(useSplit ? primaryScored : gridPool, updatedContext)

  // Outfit completion — the tailor dresses the occasion, not just the garment.
  const addOns = buildCompanions(
    updatedContext,
    results,
    opts.companionPool ?? candidates,
    cartIds,
  )

  // What can this turn honestly claim about cold evenings?
  const layerOffered = addOns.some(a => a.slotId === 'layer')
  const warmable = (updatedContext.activity !== null
      || surviving.some(p => p.catalog === 'outdoor'))
    && surviving.some(p => p.category === 'jacket' || p.category === 'sweatshirt')

  let message: string
  let gapGarment: string | undefined
  if (anchored) {
    const carted = cart.find(c => anchorSlot!.primaryCategories.includes(c.category))!
    message = cartAnchoredMessage(anchorSlot!.id, carted.category, carted.name, results.length)
  } else {
    message = revealMessage(
      prev, updatedContext, results.length, firstReveal, answered,
      { layerOffered, warmable },
    )
    // The honesty beat: if the shopper asked for a garment this shortlist
    // can't satisfy, say so plainly — confident reframe, never silent
    // substitution. Said once, at the first reveal (or whenever a NEW garment
    // is named) — not repeated after the shopper already knows.
    const garment = namedNow ?? (firstReveal ? updatedContext.requestedGarment : null)
    if (garment && results.length > 0
        && !results.some(r => garmentCategories(garment).includes(r.product.category))) {
      message = garmentGapPrefix(garment) + message
      gapGarment = garment
    }
  }

  // The non-blocking "sharpen it" beat: offer the next worthwhile A/B
  // alongside the shortlist — always a FRESH question, shown exactly once
  // (mark-on-ask, same as blocking asks). Each turn brings a different gentle
  // question or none; an options row that reappears reads as not listening.
  const sharpen = results.length > 0 && canSharpen(updatedContext)
    ? nextQuestion(updatedContext, surviving) ?? undefined
    : undefined
  const finalContext: SessionContext = {
    ...updatedContext,
    revealCount: updatedContext.revealCount + (results.length > 0 ? 1 : 0),
    askedQuestions: sharpen
      ? [...updatedContext.askedQuestions, sharpen.id]
      : updatedContext.askedQuestions,
    // An anchored pivot persists: after "dress in cart + cold evenings" turns
    // the grid to layers, follow-up refinements ("darker, richer tones")
    // refine the LAYERS — not bounce back to dresses. A garment named on a
    // later turn overrides as usual (latest-wins in session.ts).
    requestedGarment: anchored
      ? ANCHOR_GARMENT_WORD[anchorSlot!.id] ?? updatedContext.requestedGarment
      : updatedContext.requestedGarment,
  }

  return {
    message,
    results,
    updatedContext: finalContext,
    question: sharpen,
    addOns: addOns.length > 0 ? addOns : undefined,
    gapGarment,
  }
}

/**
 * Run deterministic in-memory discovery for a single turn. `catalog` chooses
 * the dataset; `prev` is the running context (empty on the first turn). This is
 * the default path (CI / offline / no-infra) and the fallback when vector
 * retrieval is disabled or errors.
 */
export function discover(
  query: string,
  prev: SessionContext,
  catalog: Catalog,
  profiles?: SituationProfile[],
  opts: ComposeOpts = {},
): DiscoverResponse {
  return composeFromCandidates(query, prev, getProductsByCatalog(catalog), profiles, opts)
}
