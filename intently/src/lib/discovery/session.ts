// ─────────────────────────────────────────────
// discovery/session.ts
//
// SessionContext accumulation. Parses a shopper's natural-language turn into
// structured updates to the running context — the lean object the discovery
// engine reasons over (never raw message history).
//
// This deterministic parser handles the demo scenarios and common phrasings.
// In tiered mode the LLM also returns an updated context; this is the
// no-key/scripted path and the safety net.
// ─────────────────────────────────────────────

import type { SessionContext, Formality, Audience } from '@/types'
import { emptySessionContext } from '@/types'
import {
  detectRequestedGarment, COLOUR_WORDS,
  PREF_DARKER, PREF_LIGHTER, PREF_SOLIDS, PREF_PATTERN, PREF_WARMTH, PREF_CARRY,
  PREF_TRIM, PREF_SHOULDERS, PREF_MIDDLE, PREF_GENEROUS,
} from './attributes'

const MONTH_SEASON: Record<string, string> = {
  january: 'winter', february: 'winter', march: 'spring', april: 'spring',
  may: 'spring', june: 'summer', july: 'summer', august: 'summer',
  september: 'autumn', october: 'autumn', november: 'autumn', december: 'winter',
}

function detectSeason(text: string): string | null {
  for (const s of ['summer', 'winter', 'autumn', 'fall', 'spring']) {
    if (text.includes(s)) return s === 'fall' ? 'autumn' : s
  }
  for (const [month, season] of Object.entries(MONTH_SEASON)) {
    if (text.includes(month)) return season
  }
  return null
}

function detectFormality(text: string): Formality | null {
  if (/black[\s-]?tie/.test(text)) return 'black tie'
  if (/smart[\s-]?casual/.test(text)) return 'smart casual'
  if (/\bformal\b|cocktail/.test(text)) return 'formal'
  if (/\bcasual\b|relaxed|everyday/.test(text)) return 'casual'
  return null
}

function detectOccasion(text: string): string | null {
  if (/wedding/.test(text)) return 'wedding guest'
  if (/\bparty\b|celebration/.test(text)) return 'party'
  if (/work|office|business meeting/.test(text)) return 'work'
  if (/dinner|date night/.test(text)) return 'dinner'
  return null
}

function detectActivity(text: string): string | null {
  if (/hik(e|ing)|trek|trail/.test(text)) return 'day hiking'
  if (/run(ning)?\b/.test(text)) return 'running'
  if (/camp(ing)?/.test(text)) return 'camping'
  return null
}

// Who the clothes are for. Kinship words and "for him/her" carry the signal;
// bare pronouns are too ambiguous to act on. Order matters only for clarity —
// the boundaries keep "women's" from tripping the men's pattern.
function detectAudience(text: string): Audience | null {
  if (/\bfor (?:him|a (?:man|guy|gentleman)|my (?:husband|boyfriend|dad|father|brother|son|grandpa|grandfather))\b|\bmen'?s(?:wear)?\b|\bfor men\b/.test(text)) {
    return 'men'
  }
  if (/\bfor (?:her|a (?:woman|lady)|my (?:wife|girlfriend|mum|mom|mother|sister|daughter|grandma|grandmother))\b|\bwomen'?s(?:wear)?\b|\bladies\b|\bfor women\b/.test(text)) {
    return 'women'
  }
  if (/\bunisex\b|\bgender[- ]neutral\b|\beither way\b/.test(text)) return 'unisex'
  return null
}

// Pull "not X" / "no X" / "avoid X" / "already have ... X" exclusions.
function detectExclusions(text: string): string[] {
  const out: string[] = []
  const patterns = ['floral', 'flowers', 'black', 'heels', 'white', 'print', 'stripe', 'bright', 'red']
  // Word-boundaried negation cue, then a small gap, then the target word.
  // Handles "nothing floral", "no florals", "not floral", "avoid black",
  // "without heels", "I already have a floral dress".
  const cue = `\\b(?:no|not|nothing|none|avoid|without|don'?t want|already (?:have|got|own))\\b`
  for (const p of patterns) {
    const re = new RegExp(`${cue}[\\w\\s]{0,15}?\\b${p}s?\\b`, 'i')
    if (re.test(text)) out.push(p === 'flowers' ? 'floral' : p)
  }
  return out
}

function detectConstraints(text: string): string[] {
  const out: string[] = []
  if (/outdoor|outside|garden|beach/.test(text)) out.push('outdoor venue')
  // "cold evenings", "cold in the evenings", "evenings can be cold", "gets cold", "chilly at night"
  if (/(cold|chilly|cool)[\w\s]{0,12}?(evening|night)|(evening|night)[\w\s]{0,12}?(cold|chilly|cool)|gets? cold|can be cold|chilly/.test(text)) {
    out.push('cold evenings')
  }
  if (/lapland|mountain|north/.test(text)) out.push('cool climate')
  if (/(bought|have|own|got|purchased|wearing)[\w\s]*?(boot|shoe|footwear|sneaker|trainer)/.test(text)) out.push('already has footwear')
  if (/\b(\d+)[\s-]?hour/.test(text)) out.push('short trips')
  // "keep it considered", "price-wise", "keep the cost down" all read as the
  // same lean — converge with the consultation's budget option.
  if (/budget|under €?\d+|cheap|affordable|price[\s-]?wise|keep (?:it|the)?[\w\s]{0,12}?(?:price|cost|spend|considered)|(?:price|cost|spend)[\w\s]{0,10}?(?:down|low|control)/.test(text)) {
    out.push('budget conscious')
  }
  return out
}

// Fabric/cut/material preferences + the style archetypes (so the style picker
// feeds preferences through the same single path as free-text refinement).
// Exported so vocabulary.ts can assemble the canonical preference set the LLM
// parser maps to (one source — the regex fallback and the LLM agree).
export const PREFERENCE_WORDS = [
  'linen', 'cotton', 'midi', 'maxi', 'earthy', 'lightweight', 'breathable', 'waterproof', 'wool',
  'classic', 'minimalist', 'romantic', 'bohemian', 'sporty', 'edgy', 'preppy', 'relaxed', 'elegant',
]

// Canonical consultation tokens (see discovery/attributes.ts). Typed phrases
// fold to the SAME tokens a tapped consultation option patches in, so the two
// input paths converge — "darker, richer tones" typed or tapped is one signal.
const PREFERENCE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(darker|deeper|richer)\b/, PREF_DARKER],
  [/\b(lighter|softer|paler|pastels?)\b/, PREF_LIGHTER],
  [/\b(solid|plain|unpatterned|understated)\b/, PREF_SOLIDS],
  [/\b(?:a (?:little|bit of) )?patterns?(?:\s+(?:is|are))?\s+(?:welcome|fine|ok(?:ay)?|good)\b|\blove patterns?\b/, PREF_PATTERN],
  [/warmth (?:and weather )?first|staying warm|warm and dry/, PREF_WARMTH],
  [/carrying comfort|carry(?:ing)? (?:my |the )?kit/, PREF_CARRY],
  // Build / fit leans — each consultation option label parses to its own
  // token (tap and typed converge), plus the everyday phrasings around it.
  [/\btrim,? close fit\b|\bslim (?:fit|build|cut)\b|\bskinny\b|\bpetite\b/, PREF_TRIM],
  [/\broom in the shoulders\b|\bbroad[- ]shoulder(?:s|ed)?\b|\bathletic build\b|\bmuscular\b|\bbodybuilder\b/, PREF_SHOULDERS],
  [/\beasy through the middle\b|\b(?:bit of a |some )?(?:stomach|belly|tummy)\b|\bmidsection\b/, PREF_MIDDLE],
  [/\bgenerous,? easy fit\b|\bfuller figure\b|\bplus[- ]sized?\b|\bcurvy\b|\blarger frame\b/, PREF_GENEROUS],
]

// A colour named as a wish ("a black dress", "something in navy"). Not a wish
// when it is being rejected ("nothing black", "I hate pink", "anything but
// red" — the hard ones are the LLM parser's job, but the plain ones must not
// invert here), when the shopper already owns it, or when "black tie" is the
// dress code rather than the colour.
const COLOUR_REJECTION_CUE =
  `\\b(?:no|not|nothing|none|never|avoid|without|hate|dislike|don'?t (?:want|like)|can'?t stand|anything but|already (?:have|got|own))\\b`
function detectWantedColours(text: string): string[] {
  const t = text.replace(/\bgray\b/g, 'grey').replace(/\bblack[- ]tie\b/g, ' ')
  return COLOUR_WORDS.filter(c =>
    new RegExp(`\\b${c}\\b`).test(t) &&
    !new RegExp(`${COLOUR_REJECTION_CUE}[\\w\\s,]{0,20}?\\b${c}\\b`).test(t),
  )
}

function detectPreferences(text: string): string[] {
  const out: string[] = []
  for (const p of PREFERENCE_WORDS) {
    if (text.includes(p)) out.push(p)
  }
  for (const [re, token] of PREFERENCE_PATTERNS) {
    if (re.test(text)) out.push(token)
  }
  return out
}

function uniq(arr: string[]): string[] {
  return [...new Set(arr)]
}

/**
 * Fold a new shopper turn into the running context. Additive for
 * exclusions/constraints/preferences; latest-wins for occasion/formality/
 * season/activity when a new signal is present.
 */
export function updateSessionContext(prev: SessionContext, query: string): SessionContext {
  const text = query.toLowerCase()
  const exclusions = uniq([...prev.exclusions, ...detectExclusions(text)])
  return {
    occasion: detectOccasion(text) ?? prev.occasion,
    formality: detectFormality(text) ?? prev.formality,
    season: detectSeason(text) ?? prev.season,
    activity: detectActivity(text) ?? prev.activity,
    audience: detectAudience(text) ?? prev.audience,
    exclusions,
    constraints: uniq([...prev.constraints, ...detectConstraints(text)]),
    // A colour excluded now (or earlier) is never also a wish: the hard filter wins.
    preferences: uniq([...prev.preferences, ...detectPreferences(text), ...detectWantedColours(text)])
      .filter(p => !exclusions.includes(p)),
    askedQuestions: prev.askedQuestions,
    requestedGarment: detectRequestedGarment(text)?.word ?? prev.requestedGarment,
    revealCount: prev.revealCount,
    turnCount: prev.turnCount + 1,
  }
}

export function freshContextFrom(query: string): SessionContext {
  return updateSessionContext(emptySessionContext(), query)
}
