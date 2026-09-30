// ─────────────────────────────────────────────
// discovery/probe-fixtures.ts
//
// Recorded model-bench results for the public demo. The Studio's model bench
// (POST /api/discover/probe) normally makes live LLM calls with an explicit
// provider; on the open web that would let any visitor spend budget. In
// public-demo mode the route serves these recordings instead — real outputs,
// captured once per sample query and provider by
// scripts/probe-fixtures.record.ts — and never calls a model.
//
// The deterministic engine still runs live, using the recorded context patch,
// so the shortlist a visitor sees is computed, not replayed.
// ─────────────────────────────────────────────

import type { Provider } from './llm-client'
import recorded from './probe-fixtures.json'

/** The queries the public model bench offers. Chosen to exercise what the LLM
 *  tier is for: negation, paraphrase, an audience cue, and an unstocked garment. */
export const PROBE_SAMPLE_QUERIES = [
  'a black dress for a party, it might get cold later',
  'something for the office, nothing too loud',
  'my budget kind of died in December, I need a warm layer',
  'a jacket for my husband',
  'jeans for the office',
] as const

export const PROBE_FIXTURE_PROVIDERS: Provider[] = ['deepseek', 'openai', 'haiku']

export interface ProbeFixture {
  model: string | null
  recordedAt: string
  parse: { ok: boolean; ms: number; patch: unknown } | null
  generate: { ok: boolean; ms: number; message: string | null; prompt: string | null; grounded: boolean | null } | null
}

const norm = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ')
export const probeFixtureKey = (provider: Provider, query: string) => `${provider}|${norm(query)}`

const FIXTURES = recorded as Record<string, ProbeFixture>

export function lookupProbeFixture(provider: Provider, query: string): ProbeFixture | null {
  return FIXTURES[probeFixtureKey(provider, query)] ?? null
}
