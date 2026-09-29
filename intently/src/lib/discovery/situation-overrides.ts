// ─────────────────────────────────────────────
// discovery/situation-overrides.ts  (server only)
//
// The runtime edit layer for situation profiles. Committed defaults
// (situation-profiles.json) are the seed; a curator's tuner saves land here as
// overrides, and this merges them with the PM-authored custom situations.
// Imported by server routes only — NEVER by the engine (which stays
// client-safe and receives profiles as a parameter).
//
// Backed by the doc-store seam (key 'situation-overrides'): local JSON in
// dev/CI, Supabase runtime_kv on cloud.
// ─────────────────────────────────────────────

import { readDoc, writeDoc } from '@/lib/store/doc-store'
import { DEFAULT_PROFILES, mergeProfile, type SituationProfile } from './situation-match'
import { readCustomProfiles } from './situation-custom'
import { readInactiveIds } from './situation-active'

type OverrideMap = Record<string, Partial<SituationProfile>>

export async function readOverrides(): Promise<OverrideMap> {
  return (await readDoc<OverrideMap>('situation-overrides')) ?? {}
}

export async function writeOverrides(ovr: OverrideMap): Promise<void> {
  await writeDoc('situation-overrides', ovr)
}

/**
 * The profiles discovery + the tuner use: committed defaults AND PM-authored
 * custom situations, each with the same runtime overrides merged on top. A
 * custom profile is just another base — so slider edits reuse the one save path.
 */
export async function loadMergedProfiles(): Promise<SituationProfile[]> {
  const [ovr, custom] = await Promise.all([readOverrides(), readCustomProfiles()])
  return [...DEFAULT_PROFILES, ...Object.values(custom)].map(p => mergeProfile(p, ovr[p.id]))
}

/** Only the ACTIVE profiles — what live discovery biases with (per-situation
 *  on/off). An empty result means no situation emphasis at all. */
export async function loadActiveProfiles(): Promise<SituationProfile[]> {
  const [profiles, inactive] = await Promise.all([loadMergedProfiles(), readInactiveIds()])
  const off = new Set(inactive)
  return profiles.filter(p => !off.has(p.id))
}
