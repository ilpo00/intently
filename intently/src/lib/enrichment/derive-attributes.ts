// ─────────────────────────────────────────────────────────────────
// Intently · Enrichment — deterministic attribute derivers
//
// The semantic enrichment that turns RAW PIM master-data (gender /
// articleType / baseColour / season / usage) into the river's enriched
// Product attributes (category, occasionTags, formalityLevel, styleTags,
// pattern, price, sizes, catalog axis).
//
// This is the typed runtime twin of the logic in scripts/import-kaggle.mjs
// (which bakes the same derivation into catalog/*.json at build time). The
// build script remains the source for the committed 82-product fallback
// catalogue; THIS module enriches PIM products (e.g. from Medusa) at runtime
// so they render in the river without round-tripping through a JSON build.
//
// Keep the two in sync if the derivation rules change. (Reconciling them into
// one shared source is a follow-up — see the Medusa-PIM plan.)
// ─────────────────────────────────────────────────────────────────

import type { Catalog, StyleArchetype } from '@/types'

const STYLE_BY_USAGE: Record<string, StyleArchetype[]> = {
  Formal: ['elegant', 'classic'],
  'Smart Casual': ['classic'],
  Party: ['romantic'],
  Casual: ['relaxed'],
  Sports: ['sporty'],
  Ethnic: ['bohemian'],
  Travel: ['relaxed'],
}
export function deriveStyleTags(usage: string): StyleArchetype[] {
  return STYLE_BY_USAGE[usage] ?? ['classic']
}

const FORMALITY_BY_USAGE: Record<string, number> = {
  Sports: 1, Casual: 2, Travel: 2, 'Smart Casual': 3, Party: 3, Ethnic: 3, Formal: 4,
}
export function deriveFormality(usage: string): number {
  return FORMALITY_BY_USAGE[usage] ?? 2
}

const CATEGORY_BY_TYPE: Record<string, string> = {
  Dresses: 'dress', Tops: 'top', Tshirts: 'top', Shirts: 'shirt', Heels: 'heels',
  Jackets: 'jacket', Backpacks: 'backpack', Sunglasses: 'sunglasses',
  'Sports Shoes': 'shoes', Sweatshirts: 'sweatshirt', 'Track Pants': 'trousers',
  Shorts: 'shorts', Caps: 'cap', Trousers: 'trousers',
}
export function deriveCategory(articleType: string): string {
  return CATEGORY_BY_TYPE[articleType] ?? articleType.toLowerCase()
}

export function derivePattern(name: string): string {
  const n = name.toLowerCase()
  if (/floral|flower/.test(n)) return 'floral'
  if (/strip/.test(n)) return 'stripe'
  if (/print/.test(n)) return 'print'
  if (/check|checked|plaid/.test(n)) return 'check'
  if (/polka|dot/.test(n)) return 'polka dot'
  if (/solid/.test(n)) return 'solid'
  return 'solid'
}

export function deriveSeason(season: string): string[] {
  const m: Record<string, string> = { Summer: 'summer', Winter: 'winter', Fall: 'autumn', Spring: 'spring' }
  return m[season] ? [m[season]] : []
}

export function deriveOccasionTags(args: {
  usage: string
  articleType: string
  season: string
}): string[] {
  const tags = new Set<string>()
  const u = args.usage
  if (u === 'Formal') tags.add('formal event')
  if (u === 'Party') { tags.add('party'); tags.add('evening') }
  if (u === 'Smart Casual') tags.add('smart casual')
  if (u === 'Casual') tags.add('everyday')
  if (u === 'Sports') { tags.add('sport'); tags.add('outdoor activity') }
  if (u === 'Ethnic') tags.add('ethnic occasion')
  const cat = deriveCategory(args.articleType)
  if (cat === 'dress' && (u === 'Party' || u === 'Smart Casual' || u === 'Formal' || u === 'Casual')) {
    tags.add('wedding guest')
    tags.add('summer party')
    if (args.season === 'Summer' || args.season === 'Spring') tags.add('outdoor event')
  }
  if (['jacket', 'backpack', 'sunglasses', 'shoes', 'cap'].includes(cat)) {
    tags.add('day hiking'); tags.add('outdoors'); tags.add('travel')
  }
  if (cat === 'top' && u === 'Sports') tags.add('base layer')
  return [...tags]
}

const PRICE_RANGES: Record<string, [number, number]> = {
  dress: [5900, 17900], jacket: [7900, 19900], backpack: [3900, 8900],
  sunglasses: [2900, 11900], top: [1900, 5900], shirt: [2900, 6900],
  heels: [4900, 12900], shoes: [4900, 13900], shorts: [1900, 4900],
  trousers: [2900, 7900], sweatshirt: [3900, 7900], cap: [1500, 3500],
}
// Deterministic price from the numeric id so reruns are stable.
export function derivePrice(category: string, idNum: number): number {
  const [lo, hi] = PRICE_RANGES[category] ?? [2900, 9900]
  const span = hi - lo
  return lo + (idNum % span) - ((lo + (idNum % span)) % 500) // round to nearest €5
}

export function deriveSizes(category: string): string[] {
  if (['sunglasses', 'backpack', 'cap'].includes(category)) return ['One Size']
  if (['shoes', 'heels'].includes(category)) return ['37', '38', '39', '40', '41']
  return ['XS', 'S', 'M', 'L', 'XL']
}

// First token of the display name is usually the brand in this dataset.
export function deriveBrand(name: string): string {
  const t = name.trim().split(/\s+/)[0]
  return t && t.length > 1 ? t : 'Intently'
}

// The catalog axis. import-kaggle.mjs splits by selection (women's dresses →
// fashion; the day-hiker basket → outdoor); here we express that as a rule so
// any PIM product lands on the right axis.
const OUTDOOR_CATEGORIES = new Set(['jacket', 'backpack', 'sunglasses', 'cap', 'sweatshirt'])
export function deriveCatalog(args: { articleType: string; usage: string }): Catalog {
  const cat = deriveCategory(args.articleType)
  if (OUTDOOR_CATEGORIES.has(cat)) return 'outdoor'
  if ((cat === 'top' || cat === 'shoes') && args.usage === 'Sports') return 'outdoor'
  return 'fashion'
}

export function buildEmbeddingText(args: {
  name: string
  category: string
  occasionTags: string[]
  color: string[]
  season: string[]
  styleTags: string[]
  pattern: string
}): string {
  return [
    args.name, deriveBrand(args.name), args.category,
    ...args.occasionTags, ...args.color, ...args.season, ...args.styleTags, args.pattern,
  ].join(' ').toLowerCase()
}

/** Extract the numeric Kaggle id from a river id like "k15970". */
export function numericId(id: string): number {
  const m = id.match(/\d+/)
  return m ? Number(m[0]) : 0
}
