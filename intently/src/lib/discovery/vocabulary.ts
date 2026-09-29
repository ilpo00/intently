// ─────────────────────────────────────────────
// discovery/vocabulary.ts
//
// The single source of the canonical OUTPUT vocabulary the discovery engine
// reasons over — the exact value space the regex parser (session.ts) emits and
// the LLM parser (parse-llm.ts) must map into. The LLM prompt enumerates these;
// the validator (parse-context.ts) rejects anything outside them.
//
// Why centralise: the LLM and the deterministic fallback must agree on the
// vocabulary or the engine's matching/info-gain silently breaks. A drift guard
// (tests/vocabulary.test.ts) asserts every value the regex CAN emit is here.
// ─────────────────────────────────────────────

import type { Formality, Audience } from '@/types'
import { PREFERENCE_WORDS } from './session'
import {
  KNOWN_GARMENT_WORDS, BUILD_TOKENS,
  PREF_DARKER, PREF_LIGHTER, PREF_SOLIDS, PREF_PATTERN, PREF_WARMTH, PREF_CARRY,
} from './attributes'

// Scalars (latest-wins fields).
export const OCCASIONS = ['wedding guest', 'party', 'work', 'dinner'] as const
export const ACTIVITIES = ['day hiking', 'running', 'camping'] as const
export const FORMALITIES: Formality[] = ['casual', 'smart casual', 'formal', 'black tie']
export const SEASONS = ['summer', 'autumn', 'winter', 'spring'] as const
export const AUDIENCES: Audience[] = ['women', 'men', 'unisex']

// Lists (additive fields). Exclusions are the safety-critical one — they are
// HARD filters, so the validator only ever admits a value from THIS set.
export const EXCLUSIONS = ['floral', 'black', 'white', 'red', 'bright', 'print', 'stripe', 'heels'] as const
export const CONSTRAINTS = [
  'outdoor venue', 'cold evenings', 'cool climate', 'already has footwear', 'short trips', 'budget conscious',
] as const

// The canonical preference tokens (taps + parsed phrases converge here) plus
// the free-text fabric/cut/style words the engine matches against embeddingText.
export const PREFERENCE_TOKENS = [
  PREF_DARKER, PREF_LIGHTER, PREF_SOLIDS, PREF_PATTERN, PREF_WARMTH, PREF_CARRY,
  ...BUILD_TOKENS,
]
export const KNOWN_PREFERENCES = [...PREFERENCE_TOKENS, ...PREFERENCE_WORDS]

export const GARMENT_WORDS = KNOWN_GARMENT_WORDS

// Membership helpers (case-exact — the LLM is instructed to emit lowercase).
const set = (xs: readonly string[]) => new Set(xs)
const OCCASION_SET = set(OCCASIONS)
const ACTIVITY_SET = set(ACTIVITIES)
const FORMALITY_SET = set(FORMALITIES)
const SEASON_SET = set(SEASONS)
const AUDIENCE_SET = set(AUDIENCES)
const EXCLUSION_SET = set(EXCLUSIONS)
const CONSTRAINT_SET = set(CONSTRAINTS)
const PREFERENCE_SET = set(KNOWN_PREFERENCES)
const GARMENT_SET = set(GARMENT_WORDS)

export const isOccasion = (v: string) => OCCASION_SET.has(v)
export const isActivity = (v: string) => ACTIVITY_SET.has(v)
export const isFormality = (v: string): v is Formality => FORMALITY_SET.has(v)
export const isAudience = (v: string): v is Audience => AUDIENCE_SET.has(v)
export const isSeason = (v: string) => SEASON_SET.has(v)
export const isExclusion = (v: string) => EXCLUSION_SET.has(v)
export const isConstraint = (v: string) => CONSTRAINT_SET.has(v)
export const isKnownPreference = (v: string) => PREFERENCE_SET.has(v)
export const isGarmentWord = (v: string) => GARMENT_SET.has(v)
