// ─────────────────────────────────────────────────────────────────
// Intently · /admin/enrichment/studio/situations — Situation tuner
//
// Interactive PM surface: pick a situation, adjust SOFT weights + emphasis
// (importance per dimension, formality target, per-garment lean), and watch the
// catalogue re-rank live with a per-dimension score breakdown. Emphasis, never
// filters — de-emphasised garments still appear, lower. Save persists an
// override (the hybrid "tune, don't re-code" seam).
// ─────────────────────────────────────────────────────────────────

import { getAllProducts } from '@/lib/data'
import { rankBySituation, type SituationProfile } from '@/lib/discovery/situation-match'
import { loadMergedProfiles } from '@/lib/discovery/situation-overrides'
import { readCustomProfiles } from '@/lib/discovery/situation-custom'
import { readInactiveIds } from '@/lib/discovery/situation-active'
import { mineSituationSuggestions } from '@/lib/analytics/mine-situations'
import SituationsClient, { type ScoredRow } from './SituationsClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Situation tuner — Intently admin' }

function rankFor(prof: SituationProfile): ScoredRow[] {
  return rankBySituation(getAllProducts(), prof).slice(0, 18).map(r => ({
    id: r.product.id, name: r.product.name, category: r.product.category,
    catalog: r.product.catalog, formalityLevel: r.product.formalityLevel,
    imageUrl: r.product.imageUrl, score: r.score, breakdown: r.breakdown,
  }))
}

export default async function SituationsPage() {
  const [profiles, custom, inactive] = await Promise.all([
    loadMergedProfiles(), readCustomProfiles(), readInactiveIds(),
  ])
  return (
    <SituationsClient
      initialProfiles={profiles}
      initialResults={rankFor(profiles[0])}
      initialCustomIds={Object.keys(custom)}
      initialInactiveIds={inactive}
      suggestions={await mineSituationSuggestions(profiles)}
    />
  )
}
