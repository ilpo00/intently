// ─────────────────────────────────────────────────────────────────
// Intently · GET /api/enrichment/products
//
// Returns every PIM product joined with its enrichment status:
//   has the vector been computed yet? when? which model?
//
// Powers the admin table.
// ─────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'

import { assertAdminApi } from '@/lib/auth/admin-guard'
import { getEnrichmentStatuses, getPimAdapter } from '@/lib/enrichment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const deny = await assertAdminApi()
  if (deny) return deny
  try {
    const [statuses, products] = await Promise.all([
      getEnrichmentStatuses(),
      getPimAdapter().list(),
    ])
    const productById = new Map(products.map((p) => [p.id, p]))
    const rows = statuses.map((s) => ({
      ...s,
      product: productById.get(s.productId) ?? null,
    }))
    return NextResponse.json({
      source: getPimAdapter().sourceName,
      total: rows.length,
      withVector: rows.filter((r) => r.hasVector).length,
      rows,
    })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    )
  }
}
