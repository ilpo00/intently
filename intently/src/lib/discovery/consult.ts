// ─────────────────────────────────────────────
// discovery/consult.ts
//
// The consultation layer — the "personal tailor" ask-before-offer beat.
// Pure Tier-0: question selection is a deterministic information-gain check
// over the LIVE candidate set, so the tailor never asks a question whose
// answer wouldn't visibly change the shortlist. (Formality, for example, is
// deliberately absent from the bank: this catalogue's formality levels span
// 1–2, and every formality target produces the identical ranking — asking
// would be theater.)
//
// Rules of the house:
//   · Ask at most 2 blocking questions before the first reveal, ever.
//   · Only ask about a dimension the shopper hasn't already given.
//   · Every option's answer must leave a real shortlist on BOTH sides of the
//     split (MIN_SIDE..len-MIN_SIDE candidates) — otherwise skip the question.
//   · Answers are structured patches (no NL parsing of a tap), applied via
//     applyAnswer. Every label is still written to parse if typed instead.
//   · Every question ends with a graceful escape ("you choose"). A concluding
//     escape hands the decision to the tailor: no more blocking questions.
//   · An asked-but-ignored question is never repeated (mark-on-ask).
// ─────────────────────────────────────────────

import type {
  Product, SessionContext, Catalog, ConsultQuestion, ConsultOption, ContextPatch,
} from '@/types'
import {
  matchesPreferenceToken, isWomenswearCategory, isGenderedGarmentWord,
  PREF_DARKER, PREF_LIGHTER, PREF_SOLIDS, PREF_PATTERN, PREF_WARMTH, PREF_CARRY,
  PREF_TRIM, PREF_SHOULDERS, PREF_MIDDLE, PREF_GENEROUS, BUILD_TOKENS,
} from './attributes'

export interface ConsultAnswer {
  questionId: string
  optionId: string
}

interface CandidateStats {
  medianPrice: number
}

interface OptionSpec {
  id: string
  label: string
  patch: ContextPatch
  // Candidate-side predicate for the information-gain check. Omitted for
  // escape options (empty patch) — they don't split anything.
  matches?: (p: Product, stats: CandidateStats) => boolean
  // "You choose" with intent: the shopper delegates, the tailor stops asking.
  concludes?: boolean
}

interface QuestionSpec {
  id: string
  prompt: string
  appliesTo: (ctx: SessionContext) => boolean
  options: OptionSpec[]
}

// Sentinel recorded in askedQuestions when the shopper delegates the choice.
export const CONSULT_CONCLUDED = 'concluded'

const MIN_SIDE = 3          // each side of a split must keep a real shortlist
const MIN_CANDIDATES = 6    // don't interrogate over a near-empty set
const MAX_BLOCKING = 2      // questions before the first reveal
const MAX_TOTAL_ASKED = 4   // blocking + answered sharpeners, per session
const SPARSE_SIGNALS = 2    // at or below this, the brief is too thin to act on

const hasPref = (ctx: SessionContext, ...tokens: string[]) =>
  tokens.some(t => ctx.preferences.includes(t))

// ── The question bank ─────────────────────────
// Order = priority. Prompts are the tailor's voice: warm, brief, decisive.

// Shared by both banks — ONE spec object, so the two catalogues can never
// silently diverge behind the same question id (applyAnswer looks up by id).
const BUDGET_QUESTION: QuestionSpec = {
  id: 'budget',
  prompt: 'On price — shall I keep it considered, or pull from the whole range?',
  appliesTo: ctx => !ctx.constraints.includes('budget conscious'),
  options: [
    {
      id: 'considered', label: 'keep it considered',
      patch: { addConstraints: ['budget conscious'] },
      matches: (p, stats) => p.price <= stats.medianPrice,
    },
    { id: 'open', label: 'the whole range', patch: {} },
  ],
}

// ── The blind tailor's first two reads ────────
// A shop-floor tailor sees who they're dressing and how clothes should sit
// the second a customer walks in. Intently can't see — so it asks, once,
// fast, with visual options (the canvas renders these as sketch tiles; the
// labels here are what a tap sends and what the transcript shows).

const AUDIENCE_QUESTION: QuestionSpec = {
  id: 'audience',
  prompt: 'Who will be wearing it — so I pull from the right rail?',
  // Moot when the shopper named a gendered garment ("a dress" answers this)
  // or already said ("for my husband").
  appliesTo: ctx => !ctx.audience && !isGenderedGarmentWord(ctx.requestedGarment),
  options: [
    {
      id: 'her', label: 'for her',
      patch: { audience: 'women' },
      // No `matches` predicate, deliberately: the catalogue has no per-item
      // gender data and everything is honestly available "for her", so this
      // option can't split the set. The question still earns its airtime —
      // through the 'him' and 'unisex' splits — and knowing "for her" is
      // real information (it CONFIRMS the full range, and the reveal says so).
    },
    {
      id: 'him', label: 'for him',
      patch: { audience: 'men' },
      // The one honest hard line: dresses/skirts leave the shortlist.
      matches: p => !isWomenswearCategory(p.category),
    },
    {
      id: 'either', label: 'either — keep it unisex',
      patch: { audience: 'unisex' },
      matches: p => ['top', 'jacket', 'sweatshirt', 'cap', 'backpack', 'trousers', 'shirt'].includes(p.category),
    },
    // A graceful decline — respected, never re-asked (mark-on-ask), and it
    // does NOT conclude the consultation: declining to say who it's for
    // shouldn't cost the shopper the palette question.
    { id: 'na', label: 'I’d rather not say', patch: {} },
  ],
}

const BUILD_QUESTION: QuestionSpec = {
  id: 'build',
  prompt: 'How should the cut sit? Point at the sketch that’s closest.',
  // The sketches depict the person; the labels speak about the CLOTHES —
  // "easy through the middle" is how a tailor talks, and it's what the chip
  // and the acknowledgment will say back. Skip for accessory briefs (a cap
  // has no cut to sit right).
  appliesTo: ctx =>
    !BUILD_TOKENS.some(t => ctx.preferences.includes(t)) &&
    !['backpack', 'sunglasses', 'cap', 'hat', 'beanie', 'daypack'].includes(ctx.requestedGarment ?? ''),
  options: [
    {
      id: 'trim', label: 'a trim, close fit',
      patch: { addPreferences: [PREF_TRIM] },
      matches: p => matchesPreferenceToken(p, PREF_TRIM),
    },
    {
      id: 'shoulders', label: 'room in the shoulders',
      patch: { addPreferences: [PREF_SHOULDERS] },
      matches: p => matchesPreferenceToken(p, PREF_SHOULDERS),
    },
    {
      id: 'middle', label: 'easy through the middle',
      patch: { addPreferences: [PREF_MIDDLE] },
      matches: p => matchesPreferenceToken(p, PREF_MIDDLE),
    },
    {
      id: 'generous', label: 'a generous, easy fit',
      patch: { addPreferences: [PREF_GENEROUS] },
      matches: p => matchesPreferenceToken(p, PREF_GENEROUS),
    },
    { id: 'na', label: 'however it falls — you choose', patch: {} },
  ],
}

const FASHION_BANK: QuestionSpec[] = [
  AUDIENCE_QUESTION,
  BUILD_QUESTION,
  {
    id: 'palette',
    prompt: 'When you picture yourself in it — do you lean darker and richer, or lighter and softer?',
    appliesTo: ctx => !hasPref(ctx, PREF_DARKER, PREF_LIGHTER),
    options: [
      {
        id: 'darker', label: 'darker, richer tones',
        patch: { addPreferences: [PREF_DARKER] },
        matches: p => matchesPreferenceToken(p, PREF_DARKER),
      },
      {
        id: 'lighter', label: 'lighter, softer tones',
        patch: { addPreferences: [PREF_LIGHTER] },
        matches: p => matchesPreferenceToken(p, PREF_LIGHTER),
      },
      { id: 'open', label: 'surprise me — show your picks', patch: {}, concludes: true },
    ],
  },
  {
    id: 'expression',
    prompt: 'And in character — clean and quiet, or a little expressive?',
    appliesTo: ctx =>
      !hasPref(ctx, PREF_SOLIDS, PREF_PATTERN) &&
      !ctx.exclusions.some(e => ['floral', 'print', 'stripe'].includes(e)),
    options: [
      {
        id: 'solid', label: 'clean, solid colours',
        patch: { addPreferences: [PREF_SOLIDS] },
        matches: p => matchesPreferenceToken(p, PREF_SOLIDS),
      },
      {
        id: 'pattern', label: 'a little pattern is welcome',
        patch: { addPreferences: [PREF_PATTERN] },
        matches: p => matchesPreferenceToken(p, PREF_PATTERN),
      },
      { id: 'open', label: 'you choose', patch: {}, concludes: true },
    ],
  },
  {
    id: 'season',
    prompt: 'Is this for the warmer months, or the cooler part of the year?',
    appliesTo: ctx => !ctx.season,
    options: [
      {
        id: 'warm', label: 'the warmer months',
        patch: { season: 'summer' },
        matches: p => p.season.includes('summer'),
      },
      {
        id: 'cool', label: 'the cooler months',
        patch: { season: 'autumn' },
        matches: p => p.season.includes('autumn'),
      },
      { id: 'open', label: 'either, really', patch: {} },
    ],
  },
  BUDGET_QUESTION,
]

const OUTDOOR_BANK: QuestionSpec[] = [
  {
    id: 'focus',
    prompt: 'What should we sort first — staying warm and dry, or carrying your kit comfortably?',
    // Moot once the shopper has named the garment — "a backpack for camping"
    // already answered what we're sorting first.
    appliesTo: ctx => !hasPref(ctx, PREF_WARMTH, PREF_CARRY) && !ctx.requestedGarment,
    options: [
      {
        id: 'warmth', label: 'warmth and weather first',
        patch: { addPreferences: [PREF_WARMTH] },
        matches: p => matchesPreferenceToken(p, PREF_WARMTH),
      },
      {
        id: 'carry', label: 'carrying comfort first',
        patch: { addPreferences: [PREF_CARRY] },
        matches: p => matchesPreferenceToken(p, PREF_CARRY),
      },
      { id: 'open', label: 'build me the full kit', patch: {}, concludes: true },
    ],
  },
  {
    id: 'sunset',
    prompt: 'Will you still be out when it cools down in the evening, or mostly in the warm hours?',
    appliesTo: ctx => !ctx.constraints.includes('cold evenings'),
    options: [
      {
        id: 'cold', label: 'out past sunset too',
        patch: { addConstraints: ['cold evenings'] },
        matches: p => p.category === 'jacket' || p.category === 'sweatshirt',
      },
      {
        id: 'day', label: 'mostly daytime warmth',
        patch: { addPreferences: ['lightweight'] },
        matches: p => p.category !== 'jacket',
      },
      { id: 'open', label: 'hard to say', patch: {} },
    ],
  },
  BUDGET_QUESTION,
]

const BANKS: Record<Catalog, QuestionSpec[]> = {
  fashion: FASHION_BANK,
  outdoor: OUTDOOR_BANK,
}

// ── Signal accounting ─────────────────────────

/** How much has the shopper actually told us? */
export function signalCount(ctx: SessionContext): number {
  return (
    (ctx.occasion ? 1 : 0) +
    (ctx.activity ? 1 : 0) +
    (ctx.formality ? 1 : 0) +
    (ctx.season ? 1 : 0) +
    (ctx.audience ? 1 : 0) +
    ctx.exclusions.length +
    ctx.constraints.length +
    ctx.preferences.length
  )
}

const concluded = (ctx: SessionContext) => ctx.askedQuestions.includes(CONSULT_CONCLUDED)

/** Ask-before-offer gate: thin brief, budget left, shopper hasn't delegated,
 *  and nothing has been revealed yet — blocking questions never follow results. */
export function shouldConsult(ctx: SessionContext): boolean {
  return (
    !concluded(ctx) &&
    ctx.revealCount === 0 &&
    ctx.askedQuestions.filter(id => id !== CONSULT_CONCLUDED).length < MAX_BLOCKING &&
    signalCount(ctx) <= SPARSE_SIGNALS
  )
}

/** Non-blocking "sharpen it" gate, used when results are being shown. */
export function canSharpen(ctx: SessionContext): boolean {
  return !concluded(ctx) && ctx.askedQuestions.length < MAX_TOTAL_ASKED
}

// ── Question selection (information gain) ─────

function stats(products: Product[]): CandidateStats {
  const prices = products.map(p => p.price).sort((a, b) => a - b)
  return { medianPrice: prices[Math.floor(prices.length / 2)] ?? 0 }
}

// A question earns its airtime only if every substantive option would leave a
// real shortlist on both sides — i.e. its answer genuinely narrows.
function splitsMeaningfully(q: QuestionSpec, products: Product[]): boolean {
  const s = stats(products)
  const substantive = q.options.filter(o => o.matches)
  if (substantive.length === 0) return false
  return substantive.every(o => {
    const n = products.filter(p => o.matches!(p, s)).length
    return n >= MIN_SIDE && n <= products.length - MIN_SIDE
  })
}

// Strip candidate-side predicates so the question is JSON-safe on the wire.
function toWire(q: QuestionSpec): ConsultQuestion {
  return {
    id: q.id,
    prompt: q.prompt,
    options: q.options.map(({ id, label, patch }): ConsultOption => ({ id, label, patch })),
  }
}

/**
 * The next question worth asking, or null when nothing would earn its airtime.
 * `products` is the LIVE candidate set (exclusions already applied) so the
 * info-gain check reflects what the shopper would actually see.
 *
 * Strictly forward-moving: a question once posed — answered, escaped, or
 * typed past — never reappears, not even as a non-blocking sharpener.
 * (A/B-judged against the alternative: re-offering reads as "it didn't
 * listen" far more often than it reads as attentiveness.)
 */
export function nextQuestion(ctx: SessionContext, products: Product[]): ConsultQuestion | null {
  if (products.length < MIN_CANDIDATES) return null
  const bank = BANKS[products[0]?.catalog ?? 'fashion']
  for (const q of bank) {
    if (ctx.askedQuestions.includes(q.id)) continue
    if (!q.appliesTo(ctx)) continue
    if (!splitsMeaningfully(q, products)) continue
    return toWire(q)
  }
  return null
}

// ── Answer application ────────────────────────

function findSpec(questionId: string): QuestionSpec | undefined {
  return [...FASHION_BANK, ...OUTDOOR_BANK].find(q => q.id === questionId)
}

export function findOption(answer: ConsultAnswer): OptionSpec | undefined {
  return findSpec(answer.questionId)?.options.find(o => o.id === answer.optionId)
}

const uniq = (arr: string[]) => [...new Set(arr)]

/**
 * Apply a tapped option deterministically: latest-wins for formality/season,
 * additive for the list fields. Always records the question as asked; a
 * concluding option also records the delegation sentinel.
 */
export function applyAnswer(ctx: SessionContext, answer: ConsultAnswer): SessionContext {
  const opt = findOption(answer)
  if (!opt) return ctx
  const asked = uniq([
    ...ctx.askedQuestions,
    answer.questionId,
    ...(opt.concludes ? [CONSULT_CONCLUDED] : []),
  ])
  const p = opt.patch
  return {
    ...ctx,
    formality: p.formality ?? ctx.formality,
    season: p.season ?? ctx.season,
    audience: p.audience ?? ctx.audience,
    preferences: uniq([...ctx.preferences, ...(p.addPreferences ?? [])]),
    exclusions: uniq([...ctx.exclusions, ...(p.addExclusions ?? [])]),
    constraints: uniq([...ctx.constraints, ...(p.addConstraints ?? [])]),
    askedQuestions: asked,
  }
}
