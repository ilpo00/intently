// ─────────────────────────────────────────────────────────────────
// Intently · /admin/enrichment/studio — Enrichment Studio
//
// A merchandiser-facing workspace that opens the enrichment "black box":
// makes raw → enriched → vector → discovery visible per product, scores
// enrichment quality, and lets a PM probe how a product surfaces and tune
// the embed text. Server shell fetches once; StudioClient owns interaction.
//
// Reuses the same read path as the classic inspector (getEnrichmentStatuses
// + the PIM list). Auth gate runs in the parent /admin layout.
// ─────────────────────────────────────────────────────────────────

import { getEnrichmentStatuses, getPimAdapter, getVectorStore } from '@/lib/enrichment'
import { readProductOverrides } from '@/lib/enrichment/product-overrides'

import StudioClient from './StudioClient'
import type { StudioRow } from './lib'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Enrichment Studio — Intently admin' }

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ product?: string | string[] }> }) {
  const sp = await searchParams
  const initialProduct = typeof sp.product === 'string' ? sp.product : null
  const pim = getPimAdapter()
  const store = getVectorStore()
  const [statuses, products, vectorCount] = await Promise.all([
    getEnrichmentStatuses(),
    pim.list(),
    store.count(),
  ])
  const byId = new Map(products.map(p => [p.id, p]))
  const rows: StudioRow[] = statuses.map(s => ({ ...s, product: byId.get(s.productId) ?? null }))

  const summary = {
    source: pim.sourceName,
    total: rows.length,
    embedded: rows.filter(r => r.hasVector).length,
    vectorCount,
    storeKind: (process.env.ENRICHMENT_STORE ?? 'local').toLowerCase(),
    embedderKind: (process.env.ENRICHMENT_EMBEDDER ?? 'xenova').toLowerCase(),
    model: rows.find(r => r.model)?.model ?? '—',
  }

  const overriddenIds = Object.keys(readProductOverrides())
  const vision = process.env.NEXT_PUBLIC_CATALOG === 'vision'

  return <StudioClient rows={rows} summary={summary} overriddenIds={overriddenIds} initialProduct={initialProduct} vision={vision} />
}
