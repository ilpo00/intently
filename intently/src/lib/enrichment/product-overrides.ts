// ─────────────────────────────────────────────
// enrichment/product-overrides.ts  ·  SERVER ONLY
//
// Curator edits to product attributes, as a NON-DESTRUCTIVE runtime layer over
// the committed catalogue — mirrors discovery/situation-overrides.ts. A PM edits
// an attribute in the Studio; it's saved here, the product is re-embedded, and
// both discovery ranking and the displayed attributes reflect it.
//
// Persisted through the doc-store (local .enrichment/product-overrides.json in
// dev/CI, Supabase runtime_kv on cloud, a per-visitor sandbox in the public
// demo) — so the same read seam serves every mode.
//
// Imported only by server code (the catalogue PIM adapter, retrieve.ts, the
// discover route, the edit API) — NEVER by the client (src/lib/data.ts stays
// client-safe).
// ─────────────────────────────────────────────

import { readDoc, writeDoc } from '@/lib/store/doc-store'
import type { Product } from '@/types'

// Only these attributes are curator-editable (the discovery-relevant ones).
export type ProductOverride = Partial<
  Pick<Product, 'color' | 'pattern' | 'occasionTags' | 'styleTags' | 'formalityLevel' | 'season' | 'fabric'>
>

export type ProductOverrideMap = Record<string, ProductOverride>

export async function readProductOverrides(): Promise<ProductOverrideMap> {
  return (await readDoc<ProductOverrideMap>('product-overrides')) ?? {}
}

export async function writeProductOverrides(map: ProductOverrideMap): Promise<void> {
  await writeDoc('product-overrides', map)
}

/** Apply the override map across a product list (no-op when the map is empty). */
export function mergeProducts(products: Product[], ovr: ProductOverrideMap): Product[] {
  if (Object.keys(ovr).length === 0) return products
  return products.map(p => mergeProduct(p, ovr[p.id]))
}

// Recompose the embed text from the merged fields so the vector reflects the edit
// (keeps the rich editorial `whyItMatters` description; mirrors the composition in
// scripts/build-vision-catalog.mjs minus the few discoveryQuery phrases).
function recomposeEmbedText(p: Product): string {
  return [
    p.name, ...(p.color ?? []), p.pattern, ...(p.fabric ?? []), p.silhouette,
    ...(p.season ?? []), ...(p.occasionTags ?? []), ...(p.styleTags ?? []), p.whyItMatters,
  ].filter(Boolean).join(' ').toLowerCase()
}

/** Apply a curator override onto a base product (+ regenerate the embed text). */
export function mergeProduct(base: Product, ovr?: ProductOverride): Product {
  if (!ovr || Object.keys(ovr).length === 0) return base
  const merged: Product = { ...base, ...ovr }
  merged.embeddingText = recomposeEmbedText(merged)
  return merged
}

export async function hasOverride(id: string): Promise<boolean> {
  const o = (await readProductOverrides())[id]
  return !!o && Object.keys(o).length > 0
}
