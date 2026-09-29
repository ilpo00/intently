// ─────────────────────────────────────────────────────────────────
// Intently · Enrichment — Kaggle CSV PIM adapter
//
// The "PIM" stand-in when Medusa isn't running. Returns the 10
// curated Kaggle products. Lets anyone demo the enrichment layer
// without standing up Postgres / Medusa.
//
// The shape on the wire is identical to MedusaPimAdapter — the
// pipeline can't tell which one it's talking to.
// ─────────────────────────────────────────────────────────────────

import type { PimAdapter, PimProduct } from '@/types/enrichment'

import { CURATED_PRODUCTS } from './pim-kaggle-curated'

export class KaggleCsvPimAdapter implements PimAdapter {
  readonly sourceName = 'kaggle'

  async list(): Promise<PimProduct[]> {
    // Returns a defensive copy so consumers can mutate freely.
    return CURATED_PRODUCTS.map((p) => ({ ...p, raw: { ...p.raw } }))
  }

  async get(id: string): Promise<PimProduct | null> {
    const match = CURATED_PRODUCTS.find((p) => p.id === id)
    return match ? { ...match, raw: { ...match.raw } } : null
  }
}
