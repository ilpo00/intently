// ─────────────────────────────────────────────────────────────────
// Intently · Enrichment — PimAdapter over the discovery catalogue
//
// Makes the discovery river's own catalogue (src/lib/catalog/*.json, served
// via @/lib/data) the PIM source-of-truth for the enrichment layer. This is
// the alignment that lets the inspector (/admin/enrichment) and the river show
// the SAME products with the SAME ids — so a vector search result maps straight
// back to getProductById, and "Sync from PIM" embeds exactly what the river
// retrieves over.
//
// Server-only: it merges the curator override layer (product-overrides.ts) onto
// each product before projecting, so an edited attribute re-embeds with the new
// text and the inspector shows the edit.
// ─────────────────────────────────────────────────────────────────

import type { PimAdapter, PimProduct } from '@/types/enrichment'
import type { Product } from '@/types'
import { getAllProducts, getProductById } from '@/lib/data'
import { mergeProduct, readProductOverrides } from './product-overrides'

function toPim(p: Product): PimProduct {
  return {
    id: p.id,
    title: p.name,
    category: p.catalog,           // 'fashion' | 'outdoor' — the catalog axis
    subcategory: p.category,       // 'dress' | 'jacket' | 'backpack' | ...
    articleType: p.category,
    gender: '',
    color: p.color[0] ?? '',
    season: p.season[0] ?? '',
    usage: p.occasionTags[0] ?? '',
    imageUrl: p.imageUrl,
    source: 'intently-catalog',
    raw: {
      embedText: p.embeddingText,
      brand: p.brand,
      occasionTags: p.occasionTags,
      styleTags: p.styleTags,
      formalityLevel: p.formalityLevel,
      pattern: p.pattern,
      fabric: p.fabric,
      silhouette: p.silhouette,
      colors: p.color,
      seasons: p.season,
    },
  }
}

export class IntentlyCatalogPimAdapter implements PimAdapter {
  readonly sourceName = 'intently-catalog'

  async list(): Promise<PimProduct[]> {
    const ovr = await readProductOverrides()
    return getAllProducts().map(p => toPim(mergeProduct(p, ovr[p.id])))
  }

  async get(id: string): Promise<PimProduct | null> {
    const p = getProductById(id)
    return p ? toPim(mergeProduct(p, (await readProductOverrides())[id])) : null
  }
}
