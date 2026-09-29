// ─────────────────────────────────────────────
// Intently · Catalogue
//
// In-memory product catalogue for Phase 1. The data is generated from the
// Kaggle Fashion Product Images dataset by scripts/import-kaggle.mjs (the
// deterministic stand-in for the Phase-2 enrichment pipeline — see
// docs/roadmap.md). These loaders are the stable seam: in Phase 2 the bodies
// swap to pgvector/Supabase reads without changing call sites.
// ─────────────────────────────────────────────

import type { Product, Catalog, StyleArchetype } from '@/types'
import fashionCatalog from './catalog/fashion-catalog.json'
import outdoorCatalog from './catalog/outdoor-catalog.json'
import visionCatalog from './catalog/vision-catalog.json'

// JSON is generated to the Product shape; cast at this single boundary so the
// rest of the app sees a clean Product[] (styleTags etc. are validated by the
// import/build script, not the type system).
//
// NEXT_PUBLIC_CATALOG=vision swaps in the real, image-backed, vision-enriched
// catalogue (built by scripts/build-vision-catalog.mjs from the vision run);
// default is the Kaggle-derived demo set. One switch flips the whole app
// (river, discovery, enrichment, studio) onto the real photos.
const USE_VISION = process.env.NEXT_PUBLIC_CATALOG === 'vision'
const PRODUCTS: Product[] = USE_VISION
  ? (visionCatalog as unknown as Product[])
  : [
      ...(fashionCatalog as unknown as Product[]),
      ...(outdoorCatalog as unknown as Product[]),
    ]

export function getAllProducts(): Product[] {
  return PRODUCTS
}

export function getProductById(id: string): Product | undefined {
  return PRODUCTS.find(p => p.id === id)
}

// Article-number index. Our id conventions carry a PREFIX (the vision catalogue
// keys by `cat-<n>`, the Medusa seed by `k<n>`) but the digits are the same
// real-world H&M article number <n>. This index lets the enrichment bridge map a
// PIM record (e.g. a Medusa-sourced `k108775015`) back to OUR rich product
// (`cat-108775015`) so discovery reasons over the vision attributes regardless
// of which source the vector came from. Built lazily, once.
function articleNo(id: string): number {
  const m = id.match(/\d+/)
  return m ? Number(m[0]) : 0
}
let byArticleNo: Map<number, Product> | null = null
export function getProductByArticleNo(id: string): Product | undefined {
  if (!byArticleNo) {
    byArticleNo = new Map()
    for (const p of PRODUCTS) byArticleNo.set(articleNo(p.id), p)
  }
  return byArticleNo.get(articleNo(id))
}

export function getProductsByCatalog(catalog: Catalog): Product[] {
  return PRODUCTS.filter(p => p.catalog === catalog)
}

// Naïve keyword search over the enriched text — sufficient for the in-memory
// Phase-1 catalogue. Phase 2 replaces this with vector retrieval.
export function searchProducts(query: string): Product[] {
  const q = query.toLowerCase().trim()
  if (!q) return []
  const terms = q.split(/\s+/)
  return PRODUCTS.filter(p =>
    terms.some(t => p.embeddingText.includes(t)),
  )
}

// ─── Style archetypes (style picker — repurposed taste grid) ──
export interface StyleArchetypeMeta {
  id: StyleArchetype
  label: string
  description: string
}

export const STYLE_ARCHETYPES: StyleArchetypeMeta[] = [
  { id: 'classic',    label: 'Classic',    description: 'Timeless, tailored, never trying too hard.' },
  { id: 'minimalist', label: 'Minimalist', description: 'Clean lines, neutral palette, quiet confidence.' },
  { id: 'romantic',   label: 'Romantic',   description: 'Soft, feminine, a little dreamy.' },
  { id: 'bohemian',   label: 'Bohemian',   description: 'Relaxed, eclectic, earthy.' },
  { id: 'sporty',     label: 'Sporty',     description: 'Active, functional, ready to move.' },
  { id: 'edgy',       label: 'Edgy',       description: 'Bold, dark, with an attitude.' },
  { id: 'preppy',     label: 'Preppy',     description: 'Crisp, collegiate, put-together.' },
  { id: 'relaxed',    label: 'Relaxed',    description: 'Easy, comfortable, everyday.' },
  { id: 'elegant',    label: 'Elegant',    description: 'Refined, polished, dressed-up.' },
]

// ─── Formatting helpers ───────────────────────

// Exact, never rounded — a PIM price of 49.99 must display as €49.99.
export function formatPrice(cents: number): string {
  const euros = cents / 100
  return `€${Number.isInteger(euros) ? euros.toFixed(0) : euros.toFixed(2)}`
}

// Attribute rows for the product-detail surface.
export function specRows(product: Product): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['Brand', product.brand],
    ['Category', product.category],
  ]
  if (product.color.length) rows.push(['Colour', product.color.join(', ')])
  if (product.season.length) rows.push(['Season', product.season.join(', ')])
  if (product.pattern && product.pattern !== 'solid') rows.push(['Pattern', product.pattern])
  if (product.occasionTags.length) rows.push(['Good for', product.occasionTags.slice(0, 3).join(', ')])
  if (product.sizesAvailable.length) rows.push(['Sizes', product.sizesAvailable.join(', ')])
  return rows
}
