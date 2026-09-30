// ─────────────────────────────────────────────────────────────────
// Intently · POST /api/enrichment/sync
//
// Pulls every product from the configured PIM, embeds each one, and
// upserts into the vector store. Returns a SyncReport.
//
// Admin-gated (mutation). The Xenova model can take ~5s to warm up
// on first call, so callers shouldn't expect this to be instant.
// ─────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'

import { assertAdminApi } from '@/lib/auth/admin-guard'
import { blockInPublicDemo } from '@/lib/public-demo-guard'
import { syncAll } from '@/lib/enrichment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A full catalogue sync (~3 batched embedding round-trips + one upsert)
// finishes in seconds, but leave headroom over Vercel's 10s default.
export const maxDuration = 60

export async function POST() {
  const deny = await assertAdminApi()
  if (deny) return deny
  const blocked = blockInPublicDemo('Catalogue sync (re-embedding)')
  if (blocked) return blocked
  try {
    const report = await syncAll()
    return NextResponse.json(report)
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    )
  }
}
