// ─────────────────────────────────────────────
// discovery/situation-match.ts
//
// The productionised "B" approach: a SOFT, weighted situation scorer. It biases
// ranking toward what people typically wear for a situation — it NEVER excludes.
// A de-emphasised garment (shorts for an office) still scores on every other
// dimension and can surface; the situation only re-orders. Hard exclusions are
// the user's alone (ctx.exclusions in prefilter.ts), not the situation's.
//
// Profiles are data (situation-profiles.json) + optional runtime overrides — the
// hybrid seam. A curator tunes the weights/emphasis in the Studio; later, learned
// signals can adjust them behind this same contract.
// ─────────────────────────────────────────────

import type { Product } from '@/types'
import profilesData from './situation-profiles.json'

export type SituationDim = 'formality' | 'occasion' | 'garment' | 'style' | 'season' | 'material'
export type SituationWeights = Record<SituationDim, number> // 0..100 importance

export interface SituationEmphasis {
  formality: number // 1..5 soft target
  garments: Record<string, number> // category → 0..1 soft preference (unset = neutral 0.5)
  occasionTags: string[]
  styleArchetypes: string[]
  seasons: string[]
  materials: string[]
}

export interface SituationProfile {
  id: string
  label: string
  query: string
  keywords?: string[]
  catalog?: 'fashion' | 'outdoor'
  weights: SituationWeights
  emphasis: SituationEmphasis
}

export interface DimScore { dim: SituationDim; weight: number; match: number; contribution: number }
export interface SituationScore { score: number; breakdown: DimScore[] }

const DIMS: SituationDim[] = ['formality', 'occasion', 'garment', 'style', 'season', 'material']
const NEUTRAL_GARMENT = 0.5

function overlapFrac(have: string[], want: string[]): number {
  if (!want.length) return 0.5 // nothing specified → neutral, not zero
  const set = new Set(want)
  return Math.min(1, have.filter(x => set.has(x)).length / want.length)
}

/**
 * Soft per-dimension match in [0,1]. None of these can drop a product — the
 * worst case is a low (but non-zero) contribution, so emphasis re-orders rather
 * than filters.
 */
export function scoreSituation(p: Product, prof: SituationProfile): SituationScore {
  const e = prof.emphasis
  const match: Record<SituationDim, number> = {
    formality: 1 - Math.min(Math.abs((p.formalityLevel ?? 2) - e.formality), 4) / 4,
    occasion: overlapFrac(p.occasionTags ?? [], e.occasionTags),
    garment: e.garments[p.category] ?? NEUTRAL_GARMENT,
    style: overlapFrac(p.styleTags ?? [], e.styleArchetypes),
    season: e.seasons.length ? ((p.season ?? []).some(s => e.seasons.includes(s)) ? 1 : 0.3) : 0.5,
    material: e.materials.length
      ? Math.min(1, e.materials.filter(m => (p.embeddingText ?? '').includes(m)).length / e.materials.length)
      : 0.5,
  }
  const totalW = DIMS.reduce((s, d) => s + (prof.weights[d] ?? 0), 0) / 100 || 1
  const breakdown: DimScore[] = DIMS.map(dim => {
    const weight = prof.weights[dim] ?? 0
    const m = match[dim]
    return { dim, weight, match: m, contribution: (weight / 100) * m / totalW }
  })
  return { score: breakdown.reduce((s, b) => s + b.contribution, 0), breakdown }
}

export interface RankedSituationProduct { product: Product; score: number; breakdown: DimScore[] }

export function rankBySituation(products: Product[], prof: SituationProfile): RankedSituationProduct[] {
  return products
    .map(p => ({ product: p, ...scoreSituation(p, prof) }))
    .sort((a, b) => b.score - a.score)
}

/**
 * Fuzzy, soft mapping of a free-text query to a situation profile (keyword /
 * label overlap). Returns null when nothing matches — discovery then falls back
 * to the plain deterministic ranking. Deliberately lenient: situations are not
 * hard lines.
 */
export function matchSituation(query: string, profiles: SituationProfile[]): SituationProfile | null {
  const q = query.toLowerCase()
  let best: { p: SituationProfile; hits: number } | null = null
  for (const p of profiles) {
    const kws = [...(p.keywords ?? []), ...p.label.toLowerCase().split(/\s+/).filter(w => w.length > 2)]
    const hits = kws.filter(k => k.length > 2 && q.includes(k)).length
    if (hits > 0 && (!best || hits > best.hits)) best = { p, hits }
  }
  return best?.p ?? null
}

/** Deep-merge a runtime override (partial) onto a base profile. */
export function mergeProfile(base: SituationProfile, ovr?: Partial<SituationProfile>): SituationProfile {
  if (!ovr) return base
  return {
    ...base,
    ...ovr,
    weights: { ...base.weights, ...(ovr.weights ?? {}) },
    emphasis: {
      ...base.emphasis,
      ...(ovr.emphasis ?? {}),
      garments: { ...base.emphasis.garments, ...(ovr.emphasis?.garments ?? {}) },
    },
  }
}

export const DEFAULT_PROFILES: SituationProfile[] =
  (profilesData as unknown as { situations: SituationProfile[] }).situations
