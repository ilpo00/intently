// ─────────────────────────────────────────────────────────────────
// Enrichment Studio · pure helpers
//
// Quality scoring + raw-attribute reading + canned discovery probes.
// No I/O — safe to use server- or client-side. The quality model is a
// deliberately simple, explainable heuristic over the fields a PM can act
// on, NOT a claim about embedding quality (that's what the probes test).
// ─────────────────────────────────────────────────────────────────

import type { EnrichmentStatus, PimProduct } from '@/types/enrichment'

export interface StudioRow extends EnrichmentStatus {
  product: PimProduct | null
}

/** The enriched attributes the catalogue adapter stashes in PimProduct.raw. */
export interface RawEnrichment {
  brand: string
  occasionTags: string[]
  styleTags: string[]
  formalityLevel?: number
  pattern?: string
  // Full multi-value attributes (the single-value PimProduct.color/season carry
  // only [0]); the curator editor reads these so it can edit the whole set.
  colors: string[]
  seasons: string[]
  fabric: string[]
  silhouette?: string
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export function readRaw(p: PimProduct | null): RawEnrichment {
  const raw = (p?.raw ?? {}) as Record<string, unknown>
  return {
    brand: typeof raw.brand === 'string' ? raw.brand : '',
    occasionTags: asStringArray(raw.occasionTags),
    styleTags: asStringArray(raw.styleTags),
    formalityLevel: typeof raw.formalityLevel === 'number' ? raw.formalityLevel : undefined,
    pattern: typeof raw.pattern === 'string' ? raw.pattern : undefined,
    colors: asStringArray(raw.colors),
    seasons: asStringArray(raw.seasons),
    fabric: asStringArray(raw.fabric),
    silhouette: typeof raw.silhouette === 'string' && raw.silhouette ? raw.silhouette : undefined,
  }
}

export type QualityBand = 'strong' | 'fair' | 'thin'

export interface Signal {
  key: string
  label: string
  present: boolean
  weight: number
  hint: string
}

export interface Quality {
  score: number // 0..100
  band: QualityBand
  embedded: boolean
  signals: Signal[]
  missing: Signal[]
}

const FORMALITY_LABEL: Record<number, string> = {
  1: 'very casual', 2: 'casual', 3: 'smart casual', 4: 'formal', 5: 'black tie',
}
export function formalityLabel(n?: number): string {
  return n ? `${FORMALITY_LABEL[n] ?? 'level ' + n} (${n})` : '—'
}

/**
 * Score a product's enrichment from the signals a merchandiser can actually
 * improve. Each present signal adds its weight; score is the percentage of
 * total weight present. Bands: strong ≥ 80, fair ≥ 55, else thin. A product
 * with no vector is always "thin / needs attention" regardless of fields.
 */
export function assessQuality(row: StudioRow): Quality {
  const p = row.product
  const raw = readRaw(p)
  const embedText = row.embedText ?? ''

  const signals: Signal[] = [
    {
      key: 'colour', label: 'Base colour', weight: 12,
      present: !!(p?.color && p.color.trim()),
      hint: 'No colour — “navy”, “beige”, “black” situations can’t bias toward it.',
    },
    {
      key: 'season', label: 'Season', weight: 12,
      present: !!(p?.season && p.season.trim()),
      hint: 'No season — “summer wedding”, “winter layers” won’t pull this up.',
    },
    {
      key: 'usage', label: 'Occasion / usage', weight: 16,
      present: !!(p?.usage && p.usage.trim()),
      hint: 'No occasion — the situational queries the river emits have nothing to hook onto.',
    },
    {
      key: 'occasionTags', label: 'Occasion coverage (≥2)', weight: 16,
      present: raw.occasionTags.length >= 2,
      hint: 'Only one (or zero) occasion tag — add more so the product matches more situations.',
    },
    {
      key: 'styleTags', label: 'Style archetypes', weight: 14,
      present: raw.styleTags.length >= 1,
      hint: 'No style archetype — “minimalist”, “romantic”, “sporty” intents won’t match.',
    },
    {
      key: 'formality', label: 'Formality level', weight: 10,
      present: typeof raw.formalityLevel === 'number',
      hint: 'No formality level — can’t distinguish black-tie from everyday.',
    },
    {
      key: 'richText', label: 'Rich embed text', weight: 20,
      present: embedText.trim().length >= 90,
      hint: 'Embed text is thin — the model has little to read. This is the single biggest lever.',
    },
  ]

  const total = signals.reduce((s, x) => s + x.weight, 0)
  const got = signals.filter(s => s.present).reduce((s, x) => s + x.weight, 0)
  const score = Math.round((got / total) * 100)
  const band: QualityBand = !row.hasVector || score < 55 ? (score < 55 ? 'thin' : 'fair') : score >= 80 ? 'strong' : 'fair'

  return {
    score,
    band: !row.hasVector ? 'thin' : band,
    embedded: row.hasVector,
    signals,
    missing: signals.filter(s => !s.present),
  }
}

export function needsAttention(q: Quality): boolean {
  return !q.embedded || q.band === 'thin' || q.score < 70
}

export const BAND_META: Record<QualityBand, { label: string; dot: string; text: string }> = {
  strong: { label: 'Strong', dot: 'bg-intently-moss', text: 'text-intently-moss' },
  fair: { label: 'Fair', dot: 'bg-amber-500', text: 'text-amber-600' },
  thin: { label: 'Thin', dot: 'bg-red-500', text: 'text-red-600' },
}

// ─── Attribute provenance ──────────────────────────────────────────
// Answers "where did this attribute come from, and was the image used?"
// Every row is text/metadata-derived today — the photo is never read.

export type ProvenanceKind = 'field' | 'name' | 'rule' | 'embed' | 'vision' | 'photo'

export interface ProvenanceRow {
  attr: string
  value: string
  signal: string // the input the value was computed from
  method: string // how it was computed
  kind: ProvenanceKind
}

export const PROVENANCE_KIND: Record<ProvenanceKind, { label: string; dot: string; text: string }> = {
  field: { label: 'PIM text field', dot: 'bg-intently-slate', text: 'text-intently-slate' },
  name: { label: 'Product name (text)', dot: 'bg-amber-500', text: 'text-amber-600' },
  rule: { label: 'Rule / lookup', dot: 'bg-sky-500', text: 'text-sky-600' },
  embed: { label: 'Text embedding', dot: 'bg-intently-moss', text: 'text-intently-moss' },
  vision: { label: 'Would need the image (not done)', dot: 'bg-red-400', text: 'text-red-500' },
  photo: { label: 'Product photo (vision)', dot: 'bg-indigo-500', text: 'text-indigo-600' },
}

/**
 * Where each attribute comes from. Mode-aware: in the vision catalogue the
 * photo is read by a vision model (Claude Haiku) to derive the attributes; in
 * the text-only fallback catalogue they're computed from PIM text fields + the
 * product name, and fabric/silhouette are blank (would need the image).
 */
export function provenanceFor(row: StudioRow, vision: boolean): ProvenanceRow[] {
  const p = row.product
  const raw = readRaw(p)
  const j = (a: string[]) => (a.length ? a.join(', ') : '—')

  if (vision) {
    const photo = 'Product PHOTO'
    const reads = 'Vision model reads the image (Claude Haiku)'
    return [
      { attr: 'Colour', value: j(raw.colors) || p?.color || '—', signal: photo, method: reads, kind: 'photo' },
      { attr: 'Pattern', value: raw.pattern || '—', signal: photo, method: reads, kind: 'photo' },
      { attr: 'Material / fabric', value: j(raw.fabric), signal: photo, method: reads, kind: 'photo' },
      { attr: 'Silhouette', value: raw.silhouette || '—', signal: photo, method: reads, kind: 'photo' },
      { attr: 'Formality', value: formalityLabel(raw.formalityLevel), signal: photo, method: 'Vision model judges dressiness (1–5)', kind: 'photo' },
      { attr: 'Occasion tags', value: j(raw.occasionTags), signal: `${photo} + reasoning`, method: 'Vision model proposes the situations the piece suits', kind: 'photo' },
      { attr: 'Style archetypes', value: j(raw.styleTags), signal: photo, method: 'Vision model maps the look to archetypes', kind: 'photo' },
      { attr: 'Season', value: j(raw.seasons) || p?.season || '—', signal: photo, method: reads, kind: 'photo' },
      { attr: 'Category / type', value: p?.subcategory || '—', signal: 'Vision garmentType', method: 'Lookup table (garmentType → category)', kind: 'rule' },
      { attr: 'Brand', value: raw.brand || '—', signal: 'Product NAME (text)', method: 'First token of the name', kind: 'name' },
      { attr: 'Embedding', value: '384-dim vector', signal: 'The embed text (composed from the vision attributes)', method: 'MiniLM sentence embedding — the description is embedded, NOT the pixels', kind: 'embed' },
    ]
  }

  return [
    { attr: 'Colour', value: p?.color || '—', signal: 'PIM field · baseColour', method: 'Passthrough, lowercased', kind: 'field' },
    { attr: 'Season', value: p?.season || '—', signal: 'PIM field · season', method: 'Normalised (Summer → summer)', kind: 'field' },
    { attr: 'Category / type', value: p?.subcategory || '—', signal: 'PIM field · articleType', method: 'Lookup table (articleType → category)', kind: 'rule' },
    { attr: 'Pattern', value: raw.pattern || '—', signal: 'Product NAME (text)', method: 'Regex on the title: floral / stripe / print / check / dot', kind: 'name' },
    { attr: 'Style archetypes', value: j(raw.styleTags), signal: 'PIM field · usage', method: 'Lookup table (usage → styles)', kind: 'rule' },
    { attr: 'Formality', value: formalityLabel(raw.formalityLevel), signal: 'PIM field · usage', method: 'Lookup table (usage → level 1–5)', kind: 'rule' },
    { attr: 'Occasion tags', value: j(raw.occasionTags), signal: 'usage + category + season', method: 'Rule set combining text fields', kind: 'rule' },
    { attr: 'Brand', value: raw.brand || '—', signal: 'Product NAME (text)', method: 'First token of the name', kind: 'name' },
    { attr: 'Fabric', value: '—', signal: 'Would need the image', method: 'Vision-only — not derived yet (left blank)', kind: 'vision' },
    { attr: 'Silhouette', value: '—', signal: 'Would need the image', method: 'Vision-only — not derived yet (left blank)', kind: 'vision' },
    { attr: 'Embedding', value: '384-dim vector', signal: 'The embed text (composed above)', method: 'MiniLM sentence embedding — text only; the image is NOT embedded', kind: 'embed' },
  ]
}

/** Representative situations the discovery river emits — used to probe
 *  whether a product is actually reachable. */
export const PROBES: string[] = [
  'a dress for an outdoor summer wedding',
  'something warm for a cold evening hike',
  'a relaxed everyday casual outfit',
  'a smart jacket for the office',
  'lightweight layers for a city break',
  'a black dress for a party',
]
