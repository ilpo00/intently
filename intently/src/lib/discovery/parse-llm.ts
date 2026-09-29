// ─────────────────────────────────────────────
// discovery/parse-llm.ts  ·  SERVER ONLY
//
// Tier-1 comprehension: free text → a validated ParsedContextPatch the engine
// can fold in. DeepSeek does the extraction; parse-context.ts's deterministic
// validator clamps it to the canonical vocabulary (vocabulary.ts) before it
// touches the engine. Returns null on any failure so the route stays on the
// regex parser (the fallback that also serves CI / no-key / offline).
//
// The model maps to EXACTLY the value space the engine reasons over — its win
// over the regex parser is comprehension of paraphrase, negation, and indirect
// phrasing ("I hate florals", "my budget died in December"), not new concepts.
// ─────────────────────────────────────────────

import type { SessionContext, ParsedContextPatch } from '@/types'
import { providerChat, extractJson, type ChatMessage, type Provider } from './llm-client'
import { validateParsedPatch, isEmptyPatch } from './parse-context'
import {
  OCCASIONS, ACTIVITIES, FORMALITIES, SEASONS, EXCLUSIONS, CONSTRAINTS,
  PREFERENCE_TOKENS, GARMENT_WORDS,
} from './vocabulary'

// DISCOVERY_PARSER selects the live comprehension provider. 'off'/unset keeps
// today's regex-only path. 'deepseek' (deepseek-chat, ~1.5s) and 'haiku'
// (~1.0s) are both viable live; 'llm' aliases deepseek (the standing
// DeepSeek-bulk tiering). See llm-client.ts for the latency measurements.
export function parserProvider(): Provider | null {
  const v = (process.env.DISCOVERY_PARSER || '').toLowerCase()
  if (v === 'deepseek' || v === 'llm') return 'deepseek'
  if (v === 'haiku') return 'haiku'
  if (v === 'openai') return 'openai'
  return null
}

const list = (xs: readonly string[]) => xs.join(', ')

function systemPrompt(): string {
  return [
    'You extract structured shopping context from a single shopper message for a fashion/outdoor discovery engine.',
    'Return ONLY a JSON object. Include a field only when the message clearly expresses it; omit everything else.',
    'Map to EXACTLY these allowed values (lowercase). Never invent values outside the lists.',
    '',
    `occasion (string): ${list(OCCASIONS)}`,
    `activity (string): ${list(ACTIVITIES)}`,
    `formality (string): ${list(FORMALITIES)}`,
    `season (string): ${list(SEASONS)}`,
    `audience (string): who the clothes are FOR — one of: women, men, unisex. Only when the message says so ("for him", "for my wife", "menswear", "something unisex"); never guess from the garment.`,
    `requestedGarment (string): the garment the shopper is asking FOR (not one they already own). One of: ${list(GARMENT_WORDS)}`,
    `addExclusions (string[]): things to AVOID — only from: ${list(EXCLUSIONS)}. Use ONLY when THIS message explicitly rejects it ("no black", "without prints", "I hate florals", "already have heels").`,
    `addConstraints (string[]): situational constraints — only from: ${list(CONSTRAINTS)}.`,
    `addPreferences (string[]): leanings — prefer these tokens when they fit: ${list(PREFERENCE_TOKENS)}; otherwise a single lowercase material/style/colour word the shopper WANTS (e.g. "linen", "velvet", "black").`,
    '',
    'CRITICAL: an attribute attached to what the shopper asks FOR is a preference, never an exclusion.',
    '"a black dress" → {"requestedGarment":"dress","addPreferences":["black"]} — black is wanted, not excluded.',
    '"no black, nothing floral" → {"addExclusions":["black","floral"]} — explicit rejection.',
    'Rules: "budget conscious" for any cost-saving intent; "cold evenings" for cooling-later signals; "outdoor venue" for outdoor settings.',
    'Do not echo prior context; extract only what THIS message adds. If nothing is expressed, return {}.',
  ].join('\n')
}

// A compact view of where the conversation already is — helps the model resolve
// "make it warmer" / "the same but darker" without re-emitting known signals.
function priorContextLine(prev: SessionContext): string {
  const bits: string[] = []
  if (prev.occasion) bits.push(`occasion=${prev.occasion}`)
  if (prev.activity) bits.push(`activity=${prev.activity}`)
  if (prev.formality) bits.push(`formality=${prev.formality}`)
  if (prev.season) bits.push(`season=${prev.season}`)
  if (prev.audience) bits.push(`audience=${prev.audience}`)
  if (prev.requestedGarment) bits.push(`garment=${prev.requestedGarment}`)
  if (prev.exclusions.length) bits.push(`excluding=${prev.exclusions.join('/')}`)
  return bits.length ? `Known so far: ${bits.join(', ')}.` : 'No prior context.'
}

// ── Inversion guard ─────────────────────────────────────────────
// Exclusions are HARD filters (a wrong one silently deletes inventory), and
// live verification (2026-07-05) caught DeepSeek mapping "a black dress" →
// addExclusions:["black"] — the only place "black" appears in its allowed
// vocabulary is the exclusions list, so positive mentions got shoved there.
// The prompt now teaches the right mapping; this deterministic guard makes
// the inversion structurally impossible even when sampling misbehaves: an
// exclusion token that appears verbatim in a message containing NO rejection
// language at all is a positive mention, not an exclusion — drop it.
const REJECTION_CUES =
  /\b(no|not|non|never|without|avoid|hate|dislike|don'?t|doesn'?t|isn'?t|except|skip|nothing|anything but|already (?:have|has|got|own))\b/i

export function dropInvertedExclusions(
  query: string,
  exclusions: string[],
): string[] {
  if (REJECTION_CUES.test(query)) return exclusions
  const q = query.toLowerCase()
  return exclusions.filter((x) => !q.includes(x))
}

/**
 * Parse a turn into a validated patch, or null if the model is unavailable or
 * produced nothing usable. A non-null result is always safe to merge.
 */
export async function llmParseContext(
  query: string,
  prev: SessionContext,
  provider: Provider | null = parserProvider(),
  model?: string, // request-time override (Studio bench); unset = env default
  meter?: { tokensIn: number; tokensOut: number }, // analytics token capture
): Promise<ParsedContextPatch | null> {
  if (!provider) return null
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: `${priorContextLine(prev)}\nMessage: "${query}"` },
  ]
  // Generous token budget + timeout: DeepSeek occasionally emits a verbose
  // preamble (truncation → empty → safe regex fallback). Haiku is terse and
  // fast (~1s). Either way a failure is null and the route stays on the regex.
  const raw = await providerChat(provider, messages, { jsonMode: true, timeoutMs: 4500, maxTokens: 1024, model, meter })
  if (!raw) return null
  const json = extractJson(raw)
  if (json === null) return null
  const patch = validateParsedPatch(json)
  if (patch.addExclusions?.length) {
    const kept = dropInvertedExclusions(query, patch.addExclusions)
    if (kept.length) patch.addExclusions = kept
    else delete patch.addExclusions
  }
  return isEmptyPatch(patch) ? null : patch
}
