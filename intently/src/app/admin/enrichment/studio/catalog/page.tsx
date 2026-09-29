// ─────────────────────────────────────────────────────────────────
// Intently · /admin/enrichment/studio/catalog — Catalogue management
//
// Multi-level (overview → product) view over the vision-enriched catalogue, topped by a
// Discovery Readiness score that links enrichment quality + coverage + the
// situation model. Read-only over the cached vision output + the committed
// vision Product catalogue; no model calls here.
// ─────────────────────────────────────────────────────────────────

import { DEFAULT_PROFILES, scoreSituation } from '@/lib/discovery/situation-match'

import CatalogClient, { type CatData, type Readiness } from './CatalogClient'
import { loadVisionItems, mergedVisionProducts } from './load'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Catalogue management — Intently admin' }

const SERVE_THRESHOLD = 0.65 // a situation is "strongly served" if its best match clears this
const FIT_DARK = 0.40        // a product is dark inventory if no situation fits above this

function buildReadiness(items: { confidence: number; styleArchetypes: string[]; materials: string[]; pattern: string; occasions: string[]; formality: number; seasons: string[] }[]): Readiness {
  const n = items.length || 1
  // 1 — enrichment completeness
  const complete = items.filter(x => x.confidence >= 0.7 && x.styleArchetypes.length && x.materials.length && x.pattern !== 'other' && x.occasions.length >= 2).length
  const completeness = complete / n
  // 2 — coverage breadth
  const formCovered = [1, 2, 3, 4, 5].filter(f => items.filter(x => x.formality === f).length >= 0.03 * n).length / 5
  const seasonCovered = ['spring', 'summer', 'autumn', 'winter'].filter(s => items.filter(x => x.seasons.includes(s)).length >= 0.15 * n).length / 4
  const occDiversity = Math.min(new Set(items.flatMap(x => x.occasions)).size, 30) / 30
  const coverage = (formCovered + seasonCovered + occDiversity) / 3
  // 3 — situation serviceability (over override-merged products, so curator
  // edits lift the score the same way they lift live discovery)
  const products = mergedVisionProducts()
  const situations = DEFAULT_PROFILES.map(prof => {
    let top = 0
    for (const p of products) top = Math.max(top, scoreSituation(p, prof).score)
    return { label: prof.label, top: Number(top.toFixed(2)), served: top >= SERVE_THRESHOLD }
  })
  const strong = situations.filter(s => s.served).length
  // Graded, not binary: average best-match strength across situations — honest
  // about partial fits (a formality-4 dress is a weak, not a real, black-tie match).
  const serviceability = situations.reduce((s, x) => s + x.top, 0) / (situations.length || 1)

  const score = Math.round(100 * (0.25 * completeness + 0.35 * coverage + 0.40 * serviceability))
  return {
    score,
    components: [
      {
        key: 'completeness', label: 'Enrichment completeness', value: completeness, weight: 25,
        how: `${complete}/${items.length} products fully attributed (confident vision + colour, pattern, material, ≥1 style, ≥2 occasions).`,
        outcome: 'A product missing a facet can’t be matched on it — it goes dark for those searches.',
      },
      {
        key: 'coverage', label: 'Coverage breadth', value: coverage, weight: 35,
        how: `Average of formality levels stocked (${Math.round(formCovered * 5)}/5), seasons stocked (${Math.round(seasonCovered * 4)}/4), and occasion variety (${new Set(items.flatMap(x => x.occasions)).size} distinct).`,
        outcome: 'A narrow catalogue can only answer a narrow slice of shopper situations.',
      },
      {
        key: 'serviceability', label: 'Situation serviceability', value: serviceability, weight: 40,
        how: `Average best-match strength across the ${situations.length} target situations — ${strong} strong (≥${SERVE_THRESHOLD}), ${situations.length - strong} weak.`,
        outcome: 'A situation with no strong match is a dead-end search — a lost sale and a buying signal.',
      },
    ],
    situations,
  }
}

function load(): CatData | null {
  const v = loadVisionItems()
  if (!v) return null
  return {
    items: v.items,
    readiness: buildReadiness(v.items),
    darkThreshold: FIT_DARK,
    summary: v.summary,
  }
}

export default function CatalogPage() {
  return <CatalogClient data={load()} />
}
