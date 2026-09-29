// ─────────────────────────────────────────────
// discovery/attributes.ts
//
// Shared attribute vocabulary for the consultation layer and the prefilter.
// Canonical preference tokens (what a tapped option or a parsed phrase writes
// into SessionContext.preferences) plus the product-side matchers that decide
// whether a product expresses that token.
//
// Tokens are phrased to read well in the "understood" chips ("darker tones",
// "clean solids") — the chip surface renders preferences verbatim.
// ─────────────────────────────────────────────

import type { Product } from '@/types'

// Palette grouping by TOKEN over the colour strings, not exact membership —
// real catalogues speak in qualified colours ('charcoal grey', 'dark navy',
// 'pale pink', 'bright red'), and an exact list can never keep up. A colour
// is dark if any dark token appears, light if any light token appears; bare
// mid-tones ('grey', 'sage green', 'multi') are deliberately neither — a
// neutral piece shouldn't be boosted or penalised by a palette lean.
const DARK_TOKENS = /\b(black|charcoal|navy|burgundy|maroon|wine|brown|cognac|espresso|chocolate|indigo|plum|forest|rust|dark|deep)\b/
const LIGHT_TOKENS = /\b(white|ivory|cream|beige|oatmeal|tan|sand|camel|peach|pink|blush|rose|mint|lavender|lilac|sky|pale|light|bright|pastel|silver|gold|golden|yellow|periwinkle)\b/

export const PREF_DARKER = 'darker tones'
export const PREF_LIGHTER = 'lighter tones'
export const PREF_SOLIDS = 'clean solids'
export const PREF_PATTERN = 'a little pattern'
export const PREF_WARMTH = 'warmth first'
export const PREF_CARRY = 'carrying comfort'

// ── Build / fit tokens (the blind tailor's second question) ──
// The consultation SHOWS body-shape sketches (fast to self-identify), but the
// tokens speak about the CLOTHES, not the person — "easy through the middle"
// is how a tailor talks, and it reads kindly in the "understood" chips and
// acknowledgments. Matching is silhouette-token based (rule: token patterns
// over the live catalogue's vocabulary, never exact membership) and biases
// rank only — a build lean reorders, it never excludes.
export const PREF_TRIM = 'trim fit'
export const PREF_SHOULDERS = 'room in the shoulders'
export const PREF_MIDDLE = 'easy through the middle'
export const PREF_GENEROUS = 'generous fit'
export const BUILD_TOKENS = [PREF_TRIM, PREF_SHOULDERS, PREF_MIDDLE, PREF_GENEROUS]

// Accessories vs garments. Build leans apply only to garments (a cap has no
// cut to sit right), and a CLOTHES brief keeps accessories out of the primary
// shortlist — they reach the shopper through the outfit-completion rail
// (carry/shade), the designed cross-sell surface, never as grid filler.
const NON_APPAREL_CATEGORIES = ['backpack', 'cap', 'sunglasses']

export function isAccessoryCategory(category: string): boolean {
  return NON_APPAREL_CATEGORIES.includes(category)
}

// Silhouette-token groups (vision vocabulary: 'boxy', 'a-line', 'longline',
// 'fitted', 'tapered', 'relaxed', 'wrap', compounds like 'fitted bodycon').
const SIL_CLOSE = /\b(fitted|tapered|bodycon|slim)\b|straight/
const SIL_ROOMY = /\b(boxy|relaxed|oversized)\b/
const SIL_EASY_MIDDLE = /\b(a-line|longline|relaxed|wrap)\b|straight/
const SIL_GENEROUS = /\b(a-line|longline|relaxed|oversized|wrap)\b/

function buildMatch(p: Product, favours: RegExp): boolean {
  if (NON_APPAREL_CATEGORIES.includes(p.category)) return false
  return favours.test((p.silhouette ?? '').toLowerCase())
}

const WARMTH_CATEGORIES = ['jacket', 'sweatshirt', 'top']
const CARRY_CATEGORIES = ['backpack']

// ── Audience (who we're dressing) ──
// The catalogue carries no per-item gender data; category is the only honest
// signal. Dresses and skirts are the conventionally womenswear categories —
// 'for him' hard-excludes them (the one embarrassment worth a hard line),
// while 'for her'/'unisex'/unknown exclude nothing. Never claim a cut is
// "men's" in a why-line — the data can't back it.
const WOMENSWEAR_CATEGORIES = ['dress', 'skirt', 'heels']

export function isWomenswearCategory(category: string): boolean {
  return WOMENSWEAR_CATEGORIES.includes(category)
}

// Garment words that already answer the audience question — asking "who is it
// for?" after "a dress" reads as not listening (skip-moot rule).
const GENDERED_GARMENT_WORDS = ['dress', 'gown', 'skirt', 'blouse', 'heels']

export function isGenderedGarmentWord(word: string | null): boolean {
  return !!word && GENDERED_GARMENT_WORDS.includes(word)
}

export function isDarkPalette(p: Product): boolean {
  return p.color.some(c => DARK_TOKENS.test(c))
}

export function isLightPalette(p: Product): boolean {
  return p.color.some(c => LIGHT_TOKENS.test(c))
}

export function isSolid(p: Product): boolean {
  return p.pattern === 'solid'
}

/** Does this product express the given canonical preference token? */
export function matchesPreferenceToken(p: Product, token: string): boolean {
  switch (token) {
    case PREF_DARKER: return isDarkPalette(p)
    case PREF_LIGHTER: return isLightPalette(p)
    case PREF_SOLIDS: return isSolid(p)
    case PREF_PATTERN: return !isSolid(p)
    case PREF_WARMTH: return WARMTH_CATEGORIES.includes(p.category)
    case PREF_CARRY: return CARRY_CATEGORIES.includes(p.category)
    case PREF_TRIM: return buildMatch(p, SIL_CLOSE)
    case PREF_SHOULDERS: return buildMatch(p, SIL_ROOMY)
    case PREF_MIDDLE: return buildMatch(p, SIL_EASY_MIDDLE)
    case PREF_GENEROUS: return buildMatch(p, SIL_GENEROUS)
    default: return p.embeddingText.includes(token)
  }
}

// ── Requested-garment detection (the honesty check) ──
// Which catalogue categories satisfy a garment word the shopper used. An empty
// list means "we genuinely don't carry this" — the reveal then says so plainly
// instead of silently substituting ("you asked for jeans, here are dresses").
// Spans both the Kaggle demo set (dress/jacket/backpack/sunglasses/top/cap)
// and the vision catalogue (adds shirt/trousers/skirt/sweatshirt).
const GARMENT_CATEGORIES: Record<string, string[]> = {
  dress: ['dress'], gown: ['dress'],
  jacket: ['jacket'], coat: ['jacket'], parka: ['jacket'], shell: ['jacket'],
  blazer: ['jacket'], cardigan: ['jacket', 'sweatshirt'],
  shirt: ['shirt', 'top'], blouse: ['shirt', 'top'], tee: ['top'], top: ['top', 'shirt'],
  trousers: ['trousers'], pants: ['trousers'], chinos: ['trousers'],
  skirt: ['skirt'],
  sweater: ['sweatshirt'], hoodie: ['sweatshirt'], sweatshirt: ['sweatshirt'], knitwear: ['sweatshirt'],
  layer: ['jacket', 'sweatshirt'],
  backpack: ['backpack'], daypack: ['backpack'],
  sunglasses: ['sunglasses'],
  cap: ['cap'], hat: ['cap'], beanie: ['cap'],
  jeans: [], suit: [],
  shoes: [], boots: [], sneakers: [], heels: [], trainers: [],
}

// Possession/negation cue — "just bought hiking boots" is not a request for boots.
const NON_REQUEST_CUE = /(?:bought|have|own|got|wearing|purchased|no|not|nothing|without|avoid)\b[\w\s]{0,18}$/i

export interface RequestedGarment {
  word: string
  categories: string[]   // catalogue categories that would satisfy it
}

/** Catalogue categories that would satisfy a remembered garment word. */
export function garmentCategories(word: string): string[] {
  return GARMENT_CATEGORIES[word] ?? []
}

/** Every garment word the engine recognises — the vocabulary the LLM parser's
 *  `requestedGarment` is validated against (anything else is dropped). */
export const KNOWN_GARMENT_WORDS = Object.keys(GARMENT_CATEGORIES)

// When a garment can't be satisfied exactly, the closest honest substitute
// to anchor the PRIMARY shortlist on (the honesty beat still fires — these
// are stand-ins, named as such, not silent replacements). "A suit" becomes
// shirt + trousers: the assembled version of the same intent.
const GARMENT_FALLBACK: Record<string, string[]> = {
  jeans: ['trousers'],
  suit: ['shirt', 'trousers'],
}

/** Stand-in categories for an unstocked garment (empty = no honest substitute). */
export function garmentFallbackCategories(word: string): string[] {
  return GARMENT_FALLBACK[word] ?? []
}

/** The garment the shopper is actually asking for this turn, if any.
 *  Earliest mention wins — "a layer over the dress" asks for the layer. */
export function detectRequestedGarment(query: string): RequestedGarment | null {
  const text = query.toLowerCase()
  let best: { word: string; categories: string[]; idx: number } | null = null
  for (const [word, categories] of Object.entries(GARMENT_CATEGORIES)) {
    const idx = text.search(new RegExp(`\\b${word}\\b`))
    if (idx === -1) continue
    if (NON_REQUEST_CUE.test(text.slice(0, idx))) continue
    if (!best || idx < best.idx) best = { word, categories, idx }
  }
  return best ? { word: best.word, categories: best.categories } : null
}

/**
 * Does this product lean AGAINST the token (the soft counter-side of an A/B)?
 * Used for a gentle rank penalty, never a hard drop — a palette lean reorders,
 * it doesn't exclude.
 */
export function opposesPreferenceToken(p: Product, token: string): boolean {
  switch (token) {
    case PREF_DARKER: return !isDarkPalette(p) && isLightPalette(p)
    case PREF_LIGHTER: return !isLightPalette(p) && isDarkPalette(p)
    case PREF_SOLIDS: return !isSolid(p)
    case PREF_PATTERN: return isSolid(p)
    // A close cut works against an asked-for easy fit (and vice versa) — a
    // gentle demotion so the wrong cut sinks, never disappears.
    case PREF_TRIM: return buildMatch(p, /\b(oversized|slouchy)\b/)
    case PREF_SHOULDERS: return buildMatch(p, /\b(fitted|bodycon)\b/)
    case PREF_MIDDLE: return buildMatch(p, /\b(fitted|bodycon)\b/)
    case PREF_GENEROUS: return buildMatch(p, /\b(fitted|bodycon|cropped)\b/)
    default: return false
  }
}
