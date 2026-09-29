// ─────────────────────────────────────────────
// discovery/parse-context.ts
//
// Pure, client-safe half of the LLM comprehension tier: the deterministic
// VALIDATOR between the model and the engine, and the MERGE that folds a
// validated patch into the running context. No network here — parse-llm.ts
// owns the DeepSeek call and delegates to these.
//
// Two non-negotiables live here:
//   1. Everything is clamped to the canonical vocabulary (vocabulary.ts). A
//      value the engine doesn't understand is dropped, never passed through.
//   2. Exclusions are HARD filters — a hallucinated exclusion silently deletes
//      inventory — so addExclusions is admitted ONLY from the known set.
//
// The merge is regex-first: the LLM fills null scalars and appends list items;
// it never overrides a value the deterministic parser already set, and never
// removes anything.
// ─────────────────────────────────────────────

import type { SessionContext, ParsedContextPatch } from '@/types'
import {
  isOccasion, isActivity, isFormality, isSeason, isAudience,
  isExclusion, isConstraint, isKnownPreference, isGarmentWord,
} from './vocabulary'

const MAX_LIST_ADD = 4          // bound how much one turn can append per field
const MAX_FREEFORM_PREF_LEN = 24

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : undefined
}

// Coerce to a clean string array. Tolerates the model returning a single value
// as a bare string ("preppy" instead of ["preppy"]) or a comma-joined string —
// both observed from deepseek-v4-flash — so a well-meant answer isn't dropped.
function asStringArray(v: unknown): string[] {
  const items = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []
  return items.map(asString).filter((x): x is string => !!x)
}

// A free-form preference the engine can still match against embeddingText:
// a single short alpha word. Bounded so the LLM can surface a genuine
// material/style word ("sequins", "velvet") without opening a hole.
function isAcceptableFreeformPref(v: string): boolean {
  return /^[a-z][a-z-]{1,}$/.test(v) && v.length <= MAX_FREEFORM_PREF_LEN && !v.includes(' ')
}

/**
 * Clamp raw model output to a safe, canonical ParsedContextPatch. Never throws;
 * unknown fields and out-of-vocabulary values are silently dropped. The result
 * is always safe to merge — worst case it's empty (≡ regex-only).
 */
export function validateParsedPatch(raw: unknown): ParsedContextPatch {
  const out: ParsedContextPatch = {}
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>

  const occasion = asString(r.occasion)
  if (occasion && isOccasion(occasion)) out.occasion = occasion

  const activity = asString(r.activity)
  if (activity && isActivity(activity)) out.activity = activity

  const formality = asString(r.formality)
  if (formality && isFormality(formality)) out.formality = formality

  const season = asString(r.season)
  if (season && isSeason(season)) out.season = season

  const audience = asString(r.audience)
  if (audience && isAudience(audience)) out.audience = audience

  const garment = asString(r.requestedGarment)
  if (garment && isGarmentWord(garment)) out.requestedGarment = garment

  // SAFETY: exclusions only from the known set, ever.
  const exclusions = asStringArray(r.addExclusions).filter(isExclusion).slice(0, MAX_LIST_ADD)
  if (exclusions.length) out.addExclusions = [...new Set(exclusions)]

  const constraints = asStringArray(r.addConstraints).filter(isConstraint).slice(0, MAX_LIST_ADD)
  if (constraints.length) out.addConstraints = [...new Set(constraints)]

  // Preferences: known tokens/words pass; otherwise a bounded free-form word.
  const prefs = asStringArray(r.addPreferences)
    .filter(p => isKnownPreference(p) || isAcceptableFreeformPref(p))
    .slice(0, MAX_LIST_ADD)
  if (prefs.length) out.addPreferences = [...new Set(prefs)]

  return out
}

const uniq = (xs: string[]) => [...new Set(xs)]

/**
 * Fold a validated patch into the running context. Regex-first: scalars fill
 * only where still null; lists append. Mirrors updateSessionContext's additive
 * shape so the two parse paths converge on identical context.
 */
export function mergeParsedPatch(ctx: SessionContext, patch: ParsedContextPatch): SessionContext {
  return {
    ...ctx,
    occasion: ctx.occasion ?? patch.occasion ?? null,
    activity: ctx.activity ?? patch.activity ?? null,
    formality: ctx.formality ?? patch.formality ?? null,
    season: ctx.season ?? patch.season ?? null,
    audience: ctx.audience ?? patch.audience ?? null,
    requestedGarment: ctx.requestedGarment ?? patch.requestedGarment ?? null,
    exclusions: uniq([...ctx.exclusions, ...(patch.addExclusions ?? [])]),
    constraints: uniq([...ctx.constraints, ...(patch.addConstraints ?? [])]),
    preferences: uniq([...ctx.preferences, ...(patch.addPreferences ?? [])]),
  }
}

/** True when the patch carries nothing the merge would change. */
export function isEmptyPatch(p: ParsedContextPatch): boolean {
  return !p.occasion && !p.activity && !p.formality && !p.season && !p.audience
    && !p.requestedGarment
    && !(p.addExclusions?.length) && !(p.addConstraints?.length) && !(p.addPreferences?.length)
}
