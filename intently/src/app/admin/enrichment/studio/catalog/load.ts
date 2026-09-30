// ─────────────────────────────────────────────────────────────────
// Vision-catalogue loader (server-only — reads .enrichment + the committed
// vision Product catalogue). Shared by the catalogue dashboard and the
// needs-attention queue so the per-product situation fit is computed in ONE
// place and the two surfaces can't disagree about what's hard to discover.
// ─────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Product } from '@/types'
import { DEFAULT_PROFILES, scoreSituation } from '@/lib/discovery/situation-match'
import { mergeProduct, readProductOverrides } from '@/lib/enrichment/product-overrides'
import visionProducts from '@/lib/catalog/vision-catalog.json'

export const VISION_PRODUCTS = visionProducts as unknown as Product[]

/** The committed vision catalogue with curator overrides applied — the single
 *  source of truth for both catalogue views, so an edit moves the readiness
 *  score and clears attention reasons everywhere (empty overrides = identity). */
export async function mergedVisionProducts(): Promise<Product[]> {
  const ovr = await readProductOverrides()
  return VISION_PRODUCTS.map(p => mergeProduct(p, ovr[p.id]))
}

export interface VisionItem {
  id: string; image: string; flags: string[]
  garmentType: string; primaryColour: string; colours: string[]; pattern: string; materials: string[]
  formality: number; seasons: string[]; occasions: string[]; styleArchetypes: string[]; confidence: number
  situationFit: number // best match across the situation profiles (0..1)
}
export interface VisionLoad {
  items: VisionItem[]
  summary: { total: number; ok: number; model: string; cost: number; tokens: number }
}

interface VisionRec {
  id: string; image: string; flags?: string[]
  vision?: {
    garmentType: string; primaryColour: string; colours: string[]; pattern: string; materials: string[]
    formality: number; seasons: string[]; occasions: string[]; styleArchetypes: string[]; confidence: number
  }
}

// Per-product best situation fit (max over the situation profiles) — links each
// product to the situation model (powers the "doesn't fit any situation" lane).
function fitById(products: Product[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of products) {
    let top = 0
    for (const prof of DEFAULT_PROFILES) top = Math.max(top, scoreSituation(p, prof).score)
    m.set(p.id, top)
  }
  return m
}

export async function loadVisionItems(): Promise<VisionLoad | null> {
  try {
    const r = JSON.parse(readFileSync(join(process.cwd(), '.enrichment/vision-catalog.json'), 'utf8')) as {
      count: number; ok: number; model: string; estCostUSD: number; tokens: { input: number; output: number }; records: VisionRec[]
    }
    // Overlay curator overrides so an edit moves these views (occasions/style/
    // pattern/material/fit) the same way it moves live discovery. confidence and
    // validator flags stay from the model — those aren't curator-editable.
    const ovr = await readProductOverrides()
    const fits = fitById(VISION_PRODUCTS.map(p => mergeProduct(p, ovr[p.id])))
    const items: VisionItem[] = r.records.filter(x => x.vision).map(x => {
      const o = ovr[x.id]
      return {
        id: x.id, image: x.image, flags: x.flags ?? [],
        garmentType: x.vision!.garmentType,
        primaryColour: o?.color?.[0] ?? x.vision!.primaryColour,
        colours: o?.color ?? x.vision!.colours,
        pattern: o?.pattern ?? x.vision!.pattern,
        materials: o?.fabric ?? x.vision!.materials ?? [],
        formality: o?.formalityLevel ?? x.vision!.formality,
        seasons: o?.season ?? x.vision!.seasons,
        occasions: o?.occasionTags ?? x.vision!.occasions,
        styleArchetypes: o?.styleTags ?? x.vision!.styleArchetypes,
        confidence: x.vision!.confidence,
        situationFit: fits.get(x.id) ?? 0,
      }
    })
    return {
      items,
      summary: { total: r.count, ok: r.ok, model: r.model, cost: r.estCostUSD, tokens: r.tokens.input + r.tokens.output },
    }
  } catch {
    return null
  }
}
