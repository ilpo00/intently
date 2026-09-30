// ─────────────────────────────────────────────────────────────────
// Intently · POST /api/enrichment/sync/[id]
//
// Re-embed a single product. Powers the "re-embed" button on the
// admin table.
// ─────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'

import { assertAdminApi } from '@/lib/auth/admin-guard'
import { blockInPublicDemo } from '@/lib/public-demo-guard'
import { syncOne } from '@/lib/enrichment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const deny = await assertAdminApi()
  if (deny) return deny
  const blocked = blockInPublicDemo('Re-embedding a product')
  if (blocked) return blocked
  const { id } = await params
  try {
    const report = await syncOne(id)
    return NextResponse.json(report)
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    )
  }
}
