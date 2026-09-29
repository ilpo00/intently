// ─────────────────────────────────────────────
// discovery/escalate.ts
//
// The Tier-1 complexity gate: simple turns must never pay for an LLM call.
// Pure and deterministic — decides, per turn, whether the cheap regex parse
// would leave signal on the table. The route ANDs this with the existing
// provider flag + daily budget, so it only ever *reduces* LLM spend; when it
// says no, the regex parser answers exactly as before.
//
// Escalate when one of the LLM's documented wins over the regex is in play
// (see parse-llm.ts header — paraphrase, negation, indirect phrasing):
//   1. Rejection/negation language — exclusions are HARD filters and indirect
//      rejections ("I hate florals") are precisely what the regex misses.
//   2. Long, multi-clause free text — several signals in one breath.
//   3. Low vocabulary coverage — most content words are outside the canonical
//      vocabulary, i.e. the shopper is paraphrasing rather than naming.
// Everything else ("blue shirt", "something more formal", tapped chips) stays
// on the deterministic path: instant and free.
// ─────────────────────────────────────────────

import {
  OCCASIONS, ACTIVITIES, FORMALITIES, SEASONS, AUDIENCES,
  EXCLUSIONS, CONSTRAINTS, KNOWN_PREFERENCES, GARMENT_WORDS,
} from './vocabulary'

// Same cue set the inversion guard trusts (parse-llm.ts) — one definition of
// "this message rejects something".
const REJECTION_CUES =
  /\b(no|not|non|never|without|avoid|hate|dislike|don'?t|doesn'?t|isn'?t|except|skip|nothing|anything but|already (?:have|has|got|own))\b/i

// Filler that shouldn't count for or against coverage.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'i', 'im', "i'm", 'my', 'me', 'we', 'our', 'it', 'its',
  'is', 'am', 'are', 'be', 'to', 'of', 'in', 'on', 'at', 'and', 'or', 'so',
  'for', 'with', 'need', 'needs', 'want', 'wants', 'looking', 'like', 'some',
  'something', 'please', 'more', 'bit', 'that', 'this', 'was', 'will',
])

// Every single word the canonical vocabulary can express (multi-word values
// like "wedding guest" contribute each word) — the regex parser's reachable
// language, approximately.
const KNOWN_WORDS: Set<string> = new Set(
  [
    ...OCCASIONS, ...ACTIVITIES, ...FORMALITIES, ...SEASONS, ...AUDIENCES,
    ...EXCLUSIONS, ...CONSTRAINTS, ...KNOWN_PREFERENCES, ...GARMENT_WORDS,
  ].flatMap(v => v.toLowerCase().split(/[\s-]+/)),
)

const LONG_TURN_WORDS = Number(process.env.DISCOVERY_ESCALATE_MINWORDS || 8)
const MIN_COVERAGE = 0.5

/**
 * Should this turn escalate to the Tier-1 LLM parse? Pure; no I/O.
 * Tapped-option answers never reach here (the route skips them outright).
 */
export function shouldEscalate(query: string, minWords: number = LONG_TURN_WORDS): boolean {
  const q = query.trim()
  if (!q) return false

  // 1. Rejection language → the LLM's negation comprehension earns its call.
  if (REJECTION_CUES.test(q)) return true

  const words = q.toLowerCase().replace(/[^\p{L}\p{N}'\s-]/gu, ' ').split(/\s+/).filter(Boolean)

  // 2. A long, multi-clause brief carries more than the regex reliably folds.
  if (words.length >= minWords) return true

  // 3. Paraphrase detection: if most content words fall outside the canonical
  //    vocabulary, the shopper is describing rather than naming — the regex
  //    would parse this to little or nothing.
  const content = words.filter(w => !STOPWORDS.has(w))
  if (content.length >= 3) {
    const known = content.filter(w => KNOWN_WORDS.has(w)).length
    if (known / content.length < MIN_COVERAGE) return true
  }

  return false
}
