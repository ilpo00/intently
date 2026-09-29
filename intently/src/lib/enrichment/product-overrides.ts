// ─────────────────────────────────────────────
// enrichment/product-overrides.ts  (server only — uses node:fs)
//
// Curator edits to product attributes, as a NON-DESTRUCTIVE runtime layer over
// the committed catalogue — mirrors discovery/situation-overrides.ts. A PM edits
// an attribute in the Studio; it's saved here, the product is re-embedded, and
// both discovery ranking (the embed text) and the displayed attributes reflect it.
//
// Imported only by server code (the catalogue PIM adapter, retrieve.ts, the edit
// API) — NEVER by the client (src/lib/data.ts stays client-safe).
// ─────────────────────────────────────────────

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Product } from '@/types'

export const OVERRIDES_PATH = join(process.cwd(), '.enrichment/product-overrides.json')

// Only these attributes are curator-editable (the discovery-relevant ones).
export type ProductOverride = Partial<
  Pick<Product, 'color' | 'pattern' | 'occasionTags' | 'styleTags' | 'formalityLevel' | 'season' | 'fabric'>
>

export function readProductOverrides(): Record<string, ProductOverride> {
  try {
    return JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8'))
  } catch {
    return {}
  }
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

export function hasOverride(id: string): boolean {
  const o = readProductOverrides()[id]
  return !!o && Object.keys(o).length > 0
}
