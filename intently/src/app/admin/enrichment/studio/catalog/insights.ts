// ─────────────────────────────────────────────────────────────────
// Catalogue insights — pure, client+server-safe.
//
// One definition of "what needs a merchandiser's attention", shared by the
// catalogue dashboard (CatalogClient) and the needs-attention work queue
// (attention/). No I/O — safe on either side. Lifting these out of the client
// means the dashboard's transient filter and the persistent queue can never
// drift apart.
// ─────────────────────────────────────────────────────────────────

/** The fields the attention rules read. CatItem (dashboard) is a superset. */
export interface AttnItem {
  id: string
  garmentType: string
  pattern: string
  materials: string[]
  occasions: string[]
  styleArchetypes: string[]
  confidence: number
  flags: string[]
  situationFit: number // best match across the situation profiles (0..1)
}

export function coarseCategory(g: string): string {
  const t = (g || '').toLowerCase()
  if (/dress|gown/.test(t)) return 'dress'
  if (/skirt/.test(t)) return 'skirt'
  if (/jacket|coat|blazer|parka|gilet|anorak|shell|bomber/.test(t)) return 'outerwear'
  if (/jumper|sweater|sweatshirt|hoodie|knit|cardigan|pullover|fleece/.test(t)) return 'knitwear'
  if (/t-?shirt|tee|tank|vest|cami\b|^top| top/.test(t)) return 'top'
  if (/shirt|blouse/.test(t)) return 'shirt'
  if (/trouser|pant|jean|jogger|chino|legging|sweatpant/.test(t)) return 'trousers'
  if (/short/.test(t)) return 'shorts'
  if (/shoe|boot|trainer|sneaker|sandal|heel|loafer|footwear/.test(t)) return 'footwear'
  if (/bag|backpack|tote|purse|rucksack/.test(t)) return 'bag'
  if (/beanie|hat|cap|scarf|glove|sock|belt|sunglass|accessor/.test(t)) return 'accessory'
  return 'other'
}

// Reasons a product needs a merchandiser's attention. Built per call so the
// lead "weakest situation fit" lane can use a RELATIVE threshold — it always
// surfaces the hardest-to-discover products even when enrichment is clean.
export interface AttnDef {
  id: string
  label: string
  hint: string
  outcome: string
  test: (it: AttnItem) => boolean
}

export function buildAttention(items: AttnItem[]): AttnDef[] {
  const fits = items.map(i => i.situationFit).sort((a, b) => a - b)
  const wf = fits.length ? fits[Math.min(fits.length - 1, Math.max(0, Math.round(0.12 * fits.length) - 1))] : 0
  return [
    { id: 'weakfit', label: 'Weakest situation fit (hardest to discover)', hint: `Bottom ~12% by best situation match (≤ ${wf.toFixed(2)}).`, outcome: 'These rely on category browsing — situation searches rarely surface them.', test: it => it.situationFit <= wf },
    { id: 'narrow', label: 'Narrow discoverability (<2 occasions)', hint: 'Tagged for ≤1 situation.', outcome: 'Surfaces for very few searches — limited demand capture.', test: it => it.occasions.length < 2 },
    { id: 'lowconf', label: 'Low vision confidence (<70%)', hint: 'The model wasn’t sure.', outcome: 'Attributes may be wrong → mismatched or missed in results.', test: it => it.confidence < 0.7 },
    { id: 'nostyle', label: 'No style archetype', hint: 'Style not detected.', outcome: 'Style intents (minimalist, elegant…) can’t match it.', test: it => !it.styleArchetypes.length },
    { id: 'unclassified', label: 'Pattern unclassified ("other")', hint: 'Pattern fell outside the vocabulary.', outcome: 'Pattern-led queries won’t reach it.', test: it => it.pattern === 'other' },
    { id: 'nomaterial', label: 'No material detected', hint: 'Fabric not detected.', outcome: 'Fabric-led queries (“linen”, “wool”) won’t reach it.', test: it => !it.materials.length },
    { id: 'flagged', label: 'Validator corrected the model', hint: 'Out-of-vocab values were dropped/clamped.', outcome: 'Worth a glance to confirm the correction is right.', test: it => it.flags.length > 0 },
  ]
}
