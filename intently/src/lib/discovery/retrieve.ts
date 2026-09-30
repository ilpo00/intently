// ─────────────────────────────────────────────
// discovery/retrieve.ts
//
// The bridge between the discovery layer (L3) and the enrichment layer (L1/L2).
// Opt-in vector retrieval: embeds the shopper's situation with the same
// Embedder the enrichment pipeline uses, queries the VectorStore (LocalJSON or
// Supabase pgvector), and maps the ranked ids back to our enriched Products.
//
// Seeding is lazy + idempotent: the first vector query embeds the catalogue
// into the store (keyed by OUR product ids, so search results map straight back
// to getProductById). The deterministic prefilter then runs over the retrieved
// candidates — exactly the Phase-2 architecture in docs/data-architecture.md
// ("pre-filter runs AFTER vector retrieval").
//
// Enabled by DISCOVERY_RETRIEVAL=vector. Default is the deterministic engine
// (better + instant at this catalogue size; the vector path proves scale).
// ─────────────────────────────────────────────

import type { Product, Catalog } from '@/types'
import type { PimProduct } from '@/types/enrichment'
import { getProductById, getProductsByCatalog, getProductByArticleNo } from '@/lib/data'
import { getVectorStore, searchByText, syncAll } from '@/lib/enrichment'
import { pimProductToProduct } from '@/lib/enrichment/pim-to-product'
import { mergeProduct, readProductOverrides } from '@/lib/enrichment/product-overrides'

export function isVectorRetrievalEnabled(): boolean {
  return (process.env.DISCOVERY_RETRIEVAL ?? 'deterministic').toLowerCase() === 'vector'
}

let seeding: Promise<void> | null = null

// Ensure the vector store is populated, via the SAME pipeline the inspector's
// "Sync from PIM" uses (syncAll → PIM=catalogue adapter → embed → upsert). One
// seeding path means the inspector and the river share identical vectors + ids;
// records are keyed by our product ids so search maps back via getProductById.
async function ensureSeeded(): Promise<void> {
  if (seeding) return seeding
  seeding = (async () => {
    if ((await getVectorStore().count()) > 0) return
    await syncAll()
  })().catch((err) => {
    // Never cache a REJECTED seed promise. A transient failure (model load,
    // store I/O) would otherwise be memoised forever, silently disabling
    // vector retrieval for the life of the process. Reset so the next query
    // retries; rethrow so the caller falls back to the deterministic engine
    // for THIS query.
    seeding = null
    throw err
  })
  return seeding
}

/**
 * Vector-retrieve candidates for a situation, scoped to one catalog. Returns
 * enriched Products (ours) ranked by semantic similarity, or null on any
 * failure so the caller can fall back to the deterministic engine.
 */
export async function vectorRetrieve(
  query: string,
  catalog: Catalog,
  k = 60,
): Promise<Product[] | null> {
  try {
    await ensureSeeded()
    // Resolve a record to a renderable Product. Prefer OUR catalogue: an exact
    // id hit, else a match by article number (so a Medusa-sourced `k<n>` finds
    // the vision-enriched `cat-<n>` — same H&M article, richer attributes). When
    // we have that rich local product, overlay only the PIM's COMMERCE fields
    // (the Medusa variant + exact region price) so add-to-cart on the shared
    // storefront cart and exact pricing survive the swap. Only when nothing in
    // our catalogue matches do we fall back to projecting the thin PIM metadata.
    // Curator overrides apply last so an edited attribute shows in live
    // discovery, keyed by the resolved product's own id (with the raw record id
    // as a fallback).
    const ovr = await readProductOverrides()
    const resolve = (id: string, meta: PimProduct): Product => {
      const local = getProductById(id) ?? getProductByArticleNo(id)
      const base: Product = local
        ? (meta.source === 'medusa'
            ? {
                ...local,
                variantId: meta.variantId ?? local.variantId,
                price: typeof meta.priceAmount === 'number'
                  ? Math.round(meta.priceAmount * 100)
                  : local.price,
              }
            : local)
        : pimProductToProduct(meta)
      return mergeProduct(base, ovr[base.id] ?? ovr[id])
    }
    const { results } = await searchByText(query, k, {
      filter: rec => resolve(rec.id, rec.metadata).catalog === catalog,
    })
    const products = results
      .map(r => resolve(r.id, r.metadata))
      .filter((p): p is Product => p != null)
    // Guard: if the catalog filter starved the result (e.g. empty store), let
    // the caller fall back rather than render nothing.
    return products.length > 0 ? products : getProductsByCatalog(catalog)
  } catch {
    return null
  }
}
