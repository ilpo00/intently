// ─────────────────────────────────────────────────────────────────
// Intently · Enrichment — PimProduct → Product projection
//
// Closes the PIM→discovery seam. The vector store caches the full PimProduct
// in each record's metadata; when a search hit's id is NOT in the local
// fallback catalogue (i.e. it originates from an external PIM like Medusa),
// the discovery layer projects that cached metadata into the river's enriched
// Product shape so it renders — instead of being dropped and falling back to
// the 82-product catalogue.
//
// Raw master-data → semantic attributes happens via derive-attributes.ts (the
// same rules that built the committed catalogue). Vision-only fields
// (fabric / silhouette) stay light defaults, exactly as in the catalogue.
// ─────────────────────────────────────────────────────────────────

import type { Product, Catalog, StyleArchetype } from '@/types'
import type { PimProduct } from '@/types/enrichment'

import {
  deriveCategory,
  deriveStyleTags,
  deriveFormality,
  derivePattern,
  deriveSeason,
  deriveOccasionTags,
  derivePrice,
  deriveSizes,
  deriveBrand,
  deriveCatalog,
  buildEmbeddingText,
  numericId,
} from './derive-attributes'

function asStringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined
}

export function pimProductToProduct(p: PimProduct): Product {
  const raw = p.raw ?? {}
  const fromCatalog = p.source === 'intently-catalog'

  const articleType = p.articleType ?? p.subcategory ?? ''
  const usage = p.usage ?? ''
  const seasonRaw = p.season ?? ''

  // category: the river's product category ('dress' | 'jacket' | ...).
  const category = fromCatalog
    ? (p.subcategory ?? deriveCategory(articleType))
    : deriveCategory(articleType)

  // catalog axis: the catalogue adapter already carries it; otherwise derive.
  const catalog: Catalog = fromCatalog
    ? (p.category === 'outdoor' ? 'outdoor' : 'fashion')
    : deriveCatalog({ articleType, usage })

  // Prefer attributes the catalogue adapter stashed in raw; else derive.
  const occasionTags = asStringArray(raw.occasionTags)
    ?? deriveOccasionTags({ usage, articleType, season: seasonRaw })
  const styleTags = (asStringArray(raw.styleTags) as StyleArchetype[] | undefined)
    ?? deriveStyleTags(usage)
  const formalityLevel = typeof raw.formalityLevel === 'number'
    ? raw.formalityLevel
    : deriveFormality(usage)
  const pattern = typeof raw.pattern === 'string'
    ? raw.pattern
    : derivePattern(p.title)

  // season: catalogue stores it already-normalised ('summer'); Medusa gives the
  // raw Kaggle value ('Summer') — normalise the latter.
  const season = fromCatalog
    ? (seasonRaw ? [seasonRaw] : [])
    : deriveSeason(seasonRaw)

  const color = p.color ? [p.color.toLowerCase()] : []
  const brand = typeof raw.brand === 'string' ? raw.brand : deriveBrand(p.title)

  const embeddingText = typeof raw.embedText === 'string'
    ? raw.embedText
    : buildEmbeddingText({ name: p.title, category, occasionTags, color, season, styleTags, pattern })

  return {
    id: p.id,
    name: p.title,
    brand,
    // Prefer the real Medusa region price (decimal euros → cents); fall back to
    // the deterministic derivation when the PIM didn't supply one.
    price: typeof p.priceAmount === 'number'
      ? Math.round(p.priceAmount * 100)
      : derivePrice(category, numericId(p.id)),
    currency: 'EUR',
    // Relative path so next/image works same-origin standalone AND gets
    // basePath-prefixed under the embed zone. (PIM thumbnails are absolute
    // localhost URLs, which next/image would reject / mis-route.)
    imageUrl: fromCatalog ? (p.imageUrl ?? '') : `/catalog/${numericId(p.id)}.webp`,
    category,
    catalog,
    color,
    sizesAvailable: deriveSizes(category),
    occasionTags,
    formalityLevel,
    season,
    fabric: [],        // vision-only — light default, as in the catalogue
    silhouette: '',    // vision-only — light default, as in the catalogue
    pattern,
    styleTags,
    embeddingText,
    variantId: p.variantId,
  }
}
