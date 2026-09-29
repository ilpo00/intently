// ─────────────────────────────────────────────
// /next · Scripted discovery engine (no live AI)
//
// A self-contained stand-in for the tiered discovery pipeline, built to the
// SAME single response contract the plan defines for scripted ↔ live parity:
//
//   discover(query, ctx) -> {
//     message, results[], updatedContext, followUp, refineChips, diff, ...
//   }
//
// `diff` (added / removed / kept ids) is what powers the re-rank choreography
// on refinement turns — the product's hero motion. Everything here is
// deterministic and key-free so the /next route runs offline in Preview.
//
// Scenarios are chosen to be CREDIBLE against the actual picture bank
// (public/catalog/*.webp): casual basics + outerwear. No formal-dress story,
// because the bank can't sell one honestly.
// ─────────────────────────────────────────────

export interface NextProduct {
  id: string
  name: string
  brand: string
  price: number // EUR cents
  image: string // /catalog/<id>.webp
  category: string
  variantId?: string // Medusa variant (plugin mode) — added to the shared store cart
}

export interface ExplainedResult {
  product: NextProduct
  why: string // the "why-this" line — hero of the card
  isBest?: boolean
}

export type ChipKind = 'occasion' | 'season' | 'place' | 'formality' | 'constraint' | 'pref'

export interface ParsedChip {
  id: string
  label: string
  kind: ChipKind
}

export interface RefineChip {
  id: string
  label: string
  query: string
}

export interface ResultDiff {
  added: string[]
  removed: string[]
  kept: string[]
}

// The tailor's consultation question, mapped from the engine's ConsultQuestion.
// With results: [] it's a BLOCKING ask (ask-before-offer); alongside results
// it's the non-blocking "sharpen it" beat. Tapping an option sends the label
// as the query plus { questionId, optionId } so the patch applies server-side.
export interface TurnAsk {
  id: string
  prompt: string
  options: { id: string; label: string }[]
}

// Outfit completion — a "complete the look" group beside the shortlist
// (a light layer for a cool evening, the other half of an outfit). The lead
// line carries the reason; the cards carry the Add-to-cart.
export interface TurnAddOnGroup {
  slotId: string
  lead: string
  items: ExplainedResult[]
}

export interface DiscoverTurn {
  scenario: ScenarioId
  message: string
  chips: ParsedChip[]
  results: ExplainedResult[]
  followUp?: { question: string }
  ask?: TurnAsk
  addOns?: TurnAddOnGroup[]
  refineChips: RefineChip[]
  diff?: ResultDiff
  summary?: string // mobile one-liner, e.g. "Swapped 2 · kept 3"
  noMatch?: boolean
}

type ScenarioId = 'outdoor' | 'city' | 'nomatch'

// ── The product pool (real webp images, hand-labelled) ──────────────
const P = {
  softshell: { id: 'softshell', name: 'Hooded Softshell Jacket', brand: 'Norse Trail', price: 5900, image: '/catalog/282832017.webp', category: 'shell jacket' },
  jacketRust: { id: 'jacketRust', name: 'Padded Hooded Jacket', brand: 'Norse Trail', price: 6900, image: '/catalog/176209033.webp', category: 'insulated jacket' },
  sweatshirt: { id: 'sweatshirt', name: 'Loopback Sweatshirt', brand: 'Råvara', price: 3200, image: '/catalog/189691044.webp', category: 'sweatshirt' },
  joggers: { id: 'joggers', name: 'Brushed Sweat Joggers', brand: 'Råvara', price: 3500, image: '/catalog/118458004.webp', category: 'joggers' },
  beanieMerino: { id: 'beanieMerino', name: 'Merino Wool Beanie', brand: 'Fjäll Basics', price: 1900, image: '/catalog/204892024.webp', category: 'beanie' },
  beaniePom: { id: 'beaniePom', name: 'Cable-Knit Pom Beanie', brand: 'Fjäll Basics', price: 2200, image: '/catalog/224314013.webp', category: 'beanie' },
  teeWhite: { id: 'teeWhite', name: 'Pima Cotton Tee', brand: 'Everyday', price: 1500, image: '/catalog/203027045.webp', category: 't-shirt' },
  tankStripe: { id: 'tankStripe', name: 'Striped Cotton Tank', brand: 'Everyday', price: 1300, image: '/catalog/218354045.webp', category: 'tank top' },
  skirtWrap: { id: 'skirtWrap', name: 'Jersey Wrap Skirt', brand: 'Maud', price: 2900, image: '/catalog/327310001.webp', category: 'skirt' },
  skirtSkater: { id: 'skirtSkater', name: 'Pleated Skater Skirt', brand: 'Maud', price: 3100, image: '/catalog/356289075.webp', category: 'skirt' },
  dressMaxi: { id: 'dressMaxi', name: 'Strapless Striped Maxi', brand: 'Wilder', price: 4500, image: '/catalog/220094016.webp', category: 'dress' },
  dressPrint: { id: 'dressPrint', name: 'Graphic Jersey Dress', brand: 'Wilder', price: 3900, image: '/catalog/384654022.webp', category: 'dress' },
  shirtWhite: { id: 'shirtWhite', name: 'Poplin Shirt', brand: 'Maud', price: 3900, image: '/catalog/392938001.webp', category: 'shirt' },
  shirtBeige: { id: 'shirtBeige', name: 'Linen-Blend Shirt', brand: 'Maud', price: 3400, image: '/catalog/283236034.webp', category: 'shirt' },
} satisfies Record<string, NextProduct>

function r(p: NextProduct, why: string, isBest = false): ExplainedResult {
  return { product: p, why, isBest }
}

// ── Example seeds (the invitation's tappable ≤1-sentence situations) ──
export const SEEDS = [
  'Something warm for a cold evening',
  'A black dress for a party',
  'Relaxed minimalist everyday basics',
]

// ── Refine chip catalogue ───────────────────────────────────────────
const COLD: RefineChip = { id: 'cold', label: "it'll be cold in the evenings", query: "it'll be cold in the evenings" }
const LIGHT: RefineChip = { id: 'light', label: 'keep it lightweight', query: 'keep it lightweight' }
const CHEAPER: RefineChip = { id: 'cheap', label: 'something more affordable', query: 'something more affordable' }
const SMARTER: RefineChip = { id: 'smart', label: 'something smarter', query: 'something smarter' }
const NOPRINT: RefineChip = { id: 'noprint', label: 'nothing with a print', query: 'nothing with a print' }
const RELAXED: RefineChip = { id: 'relaxed', label: 'more relaxed', query: 'more relaxed' }

// ── First-turn scenarios ────────────────────────────────────────────
function outdoorTurn1(): DiscoverTurn {
  return {
    scenario: 'outdoor',
    message: 'Five pieces for a weekend hike in the hills — a light kit that layers.',
    chips: [
      { id: 'c-hike', label: 'day hiking', kind: 'occasion' },
      { id: 'c-active', label: 'active', kind: 'pref' },
      { id: 'c-layer', label: 'layerable', kind: 'pref' },
    ],
    results: [
      r(P.softshell, 'Wind- and shower-proof shell — the piece that earns its place on a changeable hill day.', true),
      r(P.joggers, 'Brushed-back sweat that moves with you and packs down small for the trail.'),
      r(P.teeWhite, 'Breathable cotton base layer for the climb before the wind picks up.'),
      r(P.tankStripe, 'A lighter layer for the warm stretch at midday.'),
      r(P.beanieMerino, 'Thin merino that holds heat without bulk once you stop moving.'),
    ],
    followUp: { question: 'Will you still be out after sunset?' },
    refineChips: [COLD, LIGHT, CHEAPER],
  }
}

function cityTurn1(): DiscoverTurn {
  return {
    scenario: 'city',
    message: 'Five easy pieces for a relaxed summer weekend in the city.',
    chips: [
      { id: 'c-summer', label: 'summer', kind: 'season' },
      { id: 'c-casual', label: 'relaxed', kind: 'formality' },
      { id: 'c-city', label: 'city weekend', kind: 'occasion' },
    ],
    results: [
      r(P.tankStripe, 'An easy striped tank that does the whole weekend with a skirt or under a shirt.', true),
      r(P.skirtWrap, 'Jersey wrap that reads put-together but feels like nothing on a warm day.'),
      r(P.dressMaxi, 'One-and-done maxi for an evening out without changing.'),
      r(P.teeWhite, 'The plain cotton tee everything else leans on.'),
      r(P.dressPrint, 'A graphic jersey dress for when you want a little more personality.'),
    ],
    followUp: { question: 'Dress it up at all, or keep it easy?' },
    refineChips: [SMARTER, NOPRINT, RELAXED],
  }
}

function noMatchTurn(): DiscoverTurn {
  return {
    scenario: 'nomatch',
    message:
      "I didn't find a strong match for that in this range — it leans casual and outdoor. Want to adjust your description, or browse the full category?",
    chips: [],
    results: [],
    refineChips: [
      { id: 'try-hike', label: 'a weekend hike instead', query: SEEDS[0] },
      { id: 'try-city', label: 'a relaxed city weekend', query: SEEDS[1] },
    ],
    noMatch: true,
  }
}

// ── Refinement turns (carry the previous result ids to compute a diff) ──
function refineOutdoorCold(prevIds: string[]): DiscoverTurn {
  const results = [
    r(P.jacketRust, 'Padded and hooded — the warm layer that takes over once the sun drops.', true),
    r(P.softshell, 'Stays as your outer shell over the new mid-layers.'),
    r(P.sweatshirt, 'A loopback mid-layer to trap heat under the shell on cold evenings.'),
    r(P.joggers, 'Still the right legwear — warm enough brushed-back for a cool night.'),
    r(P.beanieMerino, 'Stays on the list — even more useful once the temperature drops.'),
  ]
  return withDiff({
    scenario: 'outdoor',
    message:
      'Leaning warmer for the cold evenings — swapped the two lightest pieces for an insulated jacket and a mid-layer; your shell, joggers and beanie stay.',
    chips: [
      { id: 'c-hike', label: 'day hiking', kind: 'occasion' },
      { id: 'c-active', label: 'active', kind: 'pref' },
      { id: 'c-cold', label: 'cold evenings', kind: 'constraint' },
    ],
    results,
    refineChips: [LIGHT, CHEAPER],
  }, prevIds)
}

function refineCitySmarter(prevIds: string[]): DiscoverTurn {
  const results = [
    r(P.shirtWhite, 'A crisp poplin shirt lifts the whole outfit a notch without trying hard.', true),
    r(P.skirtWrap, 'Stays — the wrap skirt reads smart with a shirt tucked in.'),
    r(P.shirtBeige, 'Linen-blend, half-tucked: relaxed but pulled-together.'),
    r(P.dressMaxi, 'Stays — the maxi already carries an evening on its own.'),
    r(P.tankStripe, 'Still here, now a layer under the shirt rather than the lead.'),
  ]
  return withDiff({
    scenario: 'city',
    message:
      'A touch more put-together — dropped the plainest tee and the graphic dress, added two shirts that sharpen it up.',
    chips: [
      { id: 'c-summer', label: 'summer', kind: 'season' },
      { id: 'c-smart', label: 'smart casual', kind: 'formality' },
      { id: 'c-city', label: 'city weekend', kind: 'occasion' },
    ],
    results,
    refineChips: [NOPRINT, RELAXED],
  }, prevIds)
}

function refineCityNoPrint(prevIds: string[]): DiscoverTurn {
  const results = [
    r(P.tankStripe, 'Solid stripes, no graphics — stays as the easy lead.', true),
    r(P.skirtWrap, 'Plain jersey, nothing busy.'),
    r(P.dressMaxi, 'A clean striped maxi — pattern, but no print.'),
    r(P.teeWhite, 'About as print-free as it gets.'),
    r(P.skirtSkater, 'Added a plain black skater skirt to replace the graphic dress.'),
  ]
  return withDiff({
    scenario: 'city',
    message: 'Taken the graphic dress out — here are five print-free pieces instead.',
    chips: [
      { id: 'c-summer', label: 'summer', kind: 'season' },
      { id: 'c-casual', label: 'relaxed', kind: 'formality' },
      { id: 'c-noprint', label: 'no prints', kind: 'pref' },
    ],
    results,
    refineChips: [SMARTER, RELAXED],
  }, prevIds)
}

// Generic, never-dead-end refinement: lightly reshuffle + acknowledge.
function refineGeneric(prev: DiscoverTurn, query: string): DiscoverTurn {
  const cheaper = /afford|cheap|budget|less/.test(query)
  const sorted = cheaper
    ? [...prev.results].sort((a, b) => a.product.price - b.product.price)
    : prev.results
  const results = sorted.map((res, i) => ({ ...res, isBest: i === 0 }))
  const message = cheaper
    ? 'Re-ordered to put the most affordable pieces first — same set, gentler on the budget.'
    : `Adjusted for “${query}.” Same strong matches, re-ranked to lean that way.`
  const { diff: _d, summary: _s, ...rest } = prev
  return withDiff({ ...rest, message, results }, prev.results.map(p => p.product.id))
}

// ── Diff helper: compute added/removed/kept against the previous ids ──
function withDiff(turn: Omit<DiscoverTurn, 'diff' | 'summary'>, prevIds: string[]): DiscoverTurn {
  const nextIds = turn.results.map(r => r.product.id)
  const added = nextIds.filter(id => !prevIds.includes(id))
  const removed = prevIds.filter(id => !nextIds.includes(id))
  const kept = nextIds.filter(id => prevIds.includes(id))
  const summary =
    added.length || removed.length
      ? `Swapped ${Math.max(added.length, removed.length)} · kept ${kept.length}`
      : 'Re-ranked'
  return { ...turn, diff: { added, removed, kept }, summary }
}

// ── Routing ─────────────────────────────────────────────────────────
function detectScenario(q: string): ScenarioId {
  const t = q.toLowerCase()
  if (/\b(hik|trek|trail|mountain|hill|camp|outdoor|walk|wild)/.test(t)) return 'outdoor'
  if (/\b(tux|tuxedo|gala|black[\s-]?tie|wedding|gown|cocktail|suit|ball gown|formal)/.test(t)) return 'nomatch'
  return 'city'
}

export interface DiscoverState {
  turn: DiscoverTurn | null
}

/**
 * First turn — from the empty state. Picks a scenario from the situation.
 */
export function discoverFirst(query: string): DiscoverTurn {
  const scenario = detectScenario(query)
  if (scenario === 'outdoor') return outdoorTurn1()
  if (scenario === 'nomatch') return noMatchTurn()
  return cityTurn1()
}

/**
 * Refinement turn — folds the new query into the previous turn and returns a
 * turn carrying a re-rank `diff`. Known refinements are hand-scripted for the
 * marquee choreography; anything else gets a graceful generic re-rank.
 */
export function discoverRefine(prev: DiscoverTurn, query: string): DiscoverTurn {
  const prevIds = prev.results.map(p => p.product.id)
  const t = query.toLowerCase()

  if (prev.scenario === 'outdoor') {
    if (/cold|chilly|evening|night|warm/.test(t)) return refineOutdoorCold(prevIds)
  }
  if (prev.scenario === 'city') {
    if (/smart|formal|put.together|dress.?up|nicer|elegant/.test(t)) return refineCitySmarter(prevIds)
    if (/print|graphic|floral|pattern|plain/.test(t)) return refineCityNoPrint(prevIds)
  }
  return refineGeneric(prev, query)
}

// Show the EXACT price (never round to whole euros): €49.99 stays €49.99; a whole
// price shows without trailing .00 (€35). The amount is the PIM/Medusa price.
export function formatPrice(cents: number): string {
  const euros = cents / 100
  return `€${Number.isInteger(euros) ? euros.toFixed(0) : euros.toFixed(2)}`
}
