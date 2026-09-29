// ─────────────────────────────────────────────
// discovery/situation-custom.ts  ·  SERVER ONLY
//
// PM-authored NET-NEW situations, on top of the committed defaults. Different
// stores need different situations ("school run", "festival", "boardroom"),
// so the tuner isn't limited to the seeded profiles — a PM creates one and
// tunes it with the same soft-weight sliders.
//
// Backed by the doc-store seam (key 'situation-custom'): a full profile per
// custom id. loadMergedProfiles merges the SAME runtime overrides onto these
// bases, so editing a custom situation reuses the existing save path.
// ─────────────────────────────────────────────

import { readDoc, writeDoc } from '@/lib/store/doc-store'
import type { SituationProfile } from './situation-match'

type CustomMap = Record<string, SituationProfile>

export async function readCustomProfiles(): Promise<CustomMap> {
  return (await readDoc<CustomMap>('situation-custom')) ?? {}
}

/** kebab-case slug from a label, uniqueness-suffixed against `taken`. */
export function slugId(label: string, taken: Set<string>): string {
  const base = (label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'situation').slice(0, 40)
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** A fresh custom profile with neutral seed weights/emphasis — the PM tunes it.
 *  (Single catalogue: no catalog choice is exposed; the internal field stays at
 *  the engine default and is never surfaced.) */
export function seedCustomProfile(
  id: string, label: string, keywords: string[],
): SituationProfile {
  return {
    id,
    label,
    query: label.toLowerCase(),
    keywords,
    catalog: 'fashion',
    weights: { formality: 50, occasion: 50, garment: 50, style: 50, season: 50, material: 50 },
    emphasis: { formality: 3, garments: {}, occasionTags: [], styleArchetypes: [], seasons: [], materials: [] },
  }
}

export async function saveCustomProfile(p: SituationProfile): Promise<void> {
  const map = await readCustomProfiles()
  map[p.id] = p
  await writeDoc('situation-custom', map)
}

export async function deleteCustomProfile(id: string): Promise<boolean> {
  const map = await readCustomProfiles()
  if (!(id in map)) return false
  delete map[id]
  await writeDoc('situation-custom', map)
  return true
}
