// ─────────────────────────────────────────────────────────────────
// Intently · Enrichment — product → embed string
//
// This is the single most tweakable knob in the matching pipeline.
// Iterate here when search results start ranking the wrong product
// at the top.
//
// Principles applied:
//
//   1. Display name first — gives the embedding model the strongest
//      semantic signal.
//   2. Audience + usage as a clause — captures intent ("for men",
//      "casual").
//   3. Category hierarchy explicit ("Apparel > Topwear > Shirts") —
//      lets the model lean on taxonomy when copy is thin.
//   4. Attributes as comma-separated tail — colour / season / year
//      get small weight, present but not dominant.
//   5. No raw IDs, no timestamps — those are noise.
//
// Output is a single line. The model handles internal punctuation
// fine; multi-line text wouldn't add anything for short product copy.
// ─────────────────────────────────────────────────────────────────

import type { PimProduct } from '@/types/enrichment'

export function buildEmbedText(p: PimProduct): string {
  // Prefer a pre-composed embed text when the adapter supplies one (the
  // Intently catalogue adapter stashes the river's richer `embeddingText` in
  // raw.embedText). Thin PIM sources fall through to field composition below.
  const pre = (p.raw as { embedText?: unknown } | undefined)?.embedText
  if (typeof pre === 'string' && pre.trim()) return pre.trim()

  const parts: string[] = []

  // 1. Display name — primary signal.
  parts.push(p.title.trim())

  // 2. Audience + usage clause.
  const audience: string[] = []
  if (p.gender) audience.push(p.gender)
  if (p.usage) audience.push(p.usage)
  if (p.articleType) audience.push(p.articleType)
  if (audience.length > 0) parts.push(audience.join(' ') + '.')

  // 3. Category hierarchy.
  const taxonomy: string[] = []
  if (p.category) taxonomy.push(p.category)
  if (p.subcategory) taxonomy.push(p.subcategory)
  if (taxonomy.length > 0) parts.push('Category: ' + taxonomy.join(' > ') + '.')

  // 4. Attribute tail.
  const attrs: string[] = []
  if (p.color) attrs.push(`Colour: ${p.color}`)
  if (p.season) attrs.push(`Season: ${p.season}`)
  if (p.year) attrs.push(`${p.year}`)
  if (attrs.length > 0) parts.push(attrs.join('. ') + '.')

  // 5. Description, when present — kept last so it doesn't dominate.
  if (p.description) parts.push(p.description.trim())

  return parts.join(' ').replace(/\s+/g, ' ').trim()
}
