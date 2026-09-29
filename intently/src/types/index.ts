// ─────────────────────────────────────────────
// Intently · Type Definitions
//
// Contextual product discovery for fashion & outdoor.
// A shopper describes a situation; the system returns
// an explained shortlist. These types are the contract
// every section reads from.
//
// Three consumers:
//   1. Human browser    — name, brand, price, image
//   2. Discovery engine — enriched attributes drive retrieval + re-ranking
//   3. Cart / checkout  — Asset wrapper (see ./asset)
// ─────────────────────────────────────────────

export type { Asset, AssetKind, FulfillmentKind } from './asset'
import type { Asset } from './asset'

// ─── Catalog ──────────────────────────────────
// The two POC catalogs. Drives which dataset retrieval searches.
export type Catalog = 'fashion' | 'outdoor'

// ─── Style archetypes ─────────────────────────
// The cross-vertical style vocabulary. Used by the style picker and by
// Product.styleTags. Deliberately small + cross-vertical so one vocabulary
// covers both fashion and outdoor.
export type StyleArchetype =
  | 'classic'
  | 'minimalist'
  | 'romantic'
  | 'bohemian'
  | 'sporty'
  | 'edgy'
  | 'preppy'
  | 'relaxed'
  | 'elegant'

// ─── Core Product ─────────────────────────────
// Enriched fashion/outdoor product. In Phase 1 the enriched attributes are
// derived deterministically from the Kaggle styles.csv metadata
// (gender/articleType/baseColour/season/usage); in Phase 2 they come from
// the vision-enrichment pipeline (see docs/roadmap.md).
export interface Product {
  // Human layer
  id: string
  name: string
  brand: string
  price: number                  // EUR cents
  currency: 'EUR'
  imageUrl: string
  category: string               // 'dress' | 'jacket' | 'backpack' | 'sunglasses' | ...
  catalog: Catalog

  // Basic PIM attributes
  color: string[]                // ['sage green', 'off-white']
  sizesAvailable: string[]       // ['XS','S','M','L']

  // AI-enriched attributes — what makes contextual retrieval work
  occasionTags: string[]         // ['wedding guest','summer party','day hiking']
  formalityLevel: number         // 1 (very casual) → 5 (black tie)
  season: string[]               // ['spring','summer']
  fabric: string[]               // ['linen','cotton']
  silhouette: string             // 'wrap' | 'a-line' | 'shift' | 'relaxed' | ...
  pattern: string                // 'solid' | 'floral' | 'stripe' | 'print'
  styleTags: StyleArchetype[]

  // Concatenation of the enriched profile — the text a Phase-2 embedding is
  // generated from, and the compact summary the LLM re-ranker reads.
  embeddingText: string

  // Discovery-surface helpers
  whyItMatters?: string          // generic editorial "why" (catalogue browse)
  isBestMatch?: boolean

  // Relations (optional) — composite basket suggestions
  pairsWith?: string[]

  // Medusa variant id (when sourced from the PIM) — to add to the shared cart.
  variantId?: string
}

// ─── Session context ──────────────────────────
// The lean, structured object that accumulates across conversation turns and
// drives discovery. We pass THIS plus the current query to the LLM — never the
// raw message history — so input tokens stay roughly constant across turns.
export type Formality = 'casual' | 'smart casual' | 'formal' | 'black tie'

// Who the clothes are for — the blind tailor's first read. A shop-floor tailor
// sees this at a glance; Intently must ask (or parse "for him" / "for my wife").
// 'unisex' is an explicit "either"; null is unknown-or-declined (the question
// is mark-on-ask, so declining is respected and never re-asked).
export type Audience = 'women' | 'men' | 'unisex'

export interface SessionContext {
  occasion: string | null        // 'wedding guest' | 'day hiking' | null
  formality: Formality | null
  season: string | null
  activity: string | null        // for outdoor scenarios
  audience: Audience | null      // who we're dressing ('for him' → 'men')
  exclusions: string[]           // ['floral','heels'] — things to avoid
  constraints: string[]          // ['outdoor venue','cold evenings']
  preferences: string[]          // ['linen','earthy tones'] (incl. style-picker signals)
  // Consultation questions already posed this session (mark-on-ask: a question
  // once posed never reappears, answered or not). Drives the ask-before-offer
  // budget.
  askedQuestions: string[]
  // The garment word the shopper actually asked for ("jeans", "dress") —
  // persisted so the first reveal can say honestly when we don't carry it.
  requestedGarment: string | null
  // How many times results have been shown. 0 = still consulting; blocking
  // questions only ever happen before the first reveal.
  revealCount: number
  turnCount: number
}

export function emptySessionContext(): SessionContext {
  return {
    occasion: null,
    formality: null,
    season: null,
    activity: null,
    audience: null,
    exclusions: [],
    constraints: [],
    preferences: [],
    askedQuestions: [],
    requestedGarment: null,
    revealCount: 0,
    turnCount: 0,
  }
}

// ─── Consultation (the "personal tailor" ask-before-offer beat) ───
// A structured clarifying question the discovery layer can pose instead of —
// or alongside — results. Options carry a ContextPatch applied deterministically
// on tap (no NL parsing of the tap), though every option label is also written
// to be parseable if the shopper types it instead.
export interface ContextPatch {
  formality?: Formality
  season?: string
  audience?: Audience
  addPreferences?: string[]
  addExclusions?: string[]
  addConstraints?: string[]
}

export interface ConsultOption {
  id: string
  label: string                  // lowercase, tailor voice; shown as the user's reply
  patch: ContextPatch            // {} for the graceful "you choose" escape
}

export interface ConsultQuestion {
  id: string
  prompt: string                 // the tailor's question
  options: ConsultOption[]       // 2–5, always ends with a no-patch escape
}

// ─── LLM-parsed context (Tier-1 comprehension) ───
// What the DeepSeek parser extracts from a free-text turn, after the
// deterministic validator has clamped it to the canonical vocabulary. Scalars
// fill the running context only where it's still null (regex-first, LLM fills
// gaps); list fields are appended. Never overrides, never removes — see
// mergeParsedPatch in discovery/parse-context.ts.
export interface ParsedContextPatch {
  occasion?: string
  activity?: string
  formality?: Formality
  season?: string
  audience?: Audience
  requestedGarment?: string
  addExclusions?: string[]
  addConstraints?: string[]
  addPreferences?: string[]
}

// ─── Discovery result ─────────────────────────
// One re-ranked, explained product returned by the discovery pipeline.
export interface DiscoveryResult {
  product: Product
  matchExplanation: string       // 1–2 sentences: why this fits the situation
  relevanceScore: number         // 0..1, from LLM re-ranking
}

// ─── Outfit completion (the tailor's "and to go with it…") ───
// A context-justified companion group offered ALONGSIDE the primary shortlist
// — a layer over the dress for cool evenings, the other half of an outfit,
// something to carry the kit. Never pushy: a slot only renders when the
// situation calls for it, when the catalogue can genuinely fill it, and when
// its categories aren't already in the primary results.
export interface CompanionSuggestion {
  slotId: string                 // 'layer' | 'pair' | 'carry' | 'shade' …
  lead: string                   // one tailor-voice sentence introducing the group
  results: DiscoveryResult[]     // 2–3 pieces, ranked by the same prefilter
}

// What the discovery engine needs to know about the shopper's cart: enough to
// never re-offer what they already chose, and to anchor follow-up turns on it
// ("something for the cold evenings" + a dress in the cart = a layer FOR that
// dress). UI state, passed per call — never part of the parsed SessionContext.
export interface CartContextItem {
  id: string                     // raw product id (not the composite asset id)
  category: string
  name?: string
}

// ─── Conversation ─────────────────────────────
// Kept lightweight. The structured SessionContext is the real signal; intent
// is a coarse layout/analytics hint only.
export type IntentType = 'browse' | 'discover' | 'buy' | 'unknown'

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

// ─── Style profile (repurposed taste grid) ────
export interface StyleSignal {
  styleId: StyleArchetype
  signal: 'love' | 'skip' | 'nope'
}

export interface StyleProfile {
  signals: StyleSignal[]
  dominantStyle?: StyleArchetype
}

// ─── Cart ─────────────────────────────────────
// CartItem wraps an Asset (a thin wrapper over Product with a composite id +
// fulfillment kind). The Asset union collapsed to a single 'product' member
// when recipes were removed — see src/types/asset.ts.
export interface CartItem {
  asset: Asset
  quantity: number
  giftNote?: string
}

export interface Cart {
  items: CartItem[]
  giftWrap: boolean
  deliveryDate?: string
}
