// ─────────────────────────────────────────────────────────────────
// POST /api/enrichment/situations/score
//
// Body: { profile: SituationProfile, limit?: number }
// Ranks the WHOLE catalogue against a (possibly PM-edited) profile and returns
// each product's soft score + per-dimension breakdown. Powers the Studio tuner's
// live re-ranking. Scoring over the full catalogue is deliberate — it shows that
// de-emphasised garments still appear (lower), never filtered out.
// ─────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'

import { assertAdminApi } from '@/lib/auth/admin-guard'
import { getAllProducts } from '@/lib/data'
import { rankBySituation, type SituationProfile } from '@/lib/discovery/situation-match'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const deny = await assertAdminApi(); if (deny) return deny
  let body: { profile?: SituationProfile; limit?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }
  if (!body.profile?.weights || !body.profile?.emphasis) {
    return NextResponse.json({ error: 'profile with weights + emphasis required' }, { status: 400 })
  }
  const limit = Math.min(40, Math.max(1, body.limit ?? 18))
  const ranked = rankBySituation(getAllProducts(), body.profile).slice(0, limit)
  return NextResponse.json({
    results: ranked.map(r => ({
      id: r.product.id,
      name: r.product.name,
      category: r.product.category,
      catalog: r.product.catalog,
      formalityLevel: r.product.formalityLevel,
      imageUrl: r.product.imageUrl,
      score: r.score,
      breakdown: r.breakdown,
    })),
  })
}
