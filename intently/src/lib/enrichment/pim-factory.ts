// ─────────────────────────────────────────────────────────────────
// Intently · Enrichment — PimAdapter factory
//
// Picks impl from env. Memoised; see vector-store-factory.ts for the
// rationale.
//
//   PIM_SOURCE=catalog   (default — the discovery river's own 82-product
//                         catalogue, so inspector + river share one product set)
//   PIM_SOURCE=kaggle    (curated 10 Kaggle products read from styles.csv)
//   PIM_SOURCE=medusa    (Medusa REST; requires MEDUSA_* env)
// ─────────────────────────────────────────────────────────────────

import type { PimAdapter } from '@/types/enrichment'

import { IntentlyCatalogPimAdapter } from './pim-intently-catalog'
import { KaggleCsvPimAdapter } from './pim-kaggle-csv'
import { MedusaPimAdapter } from './pim-medusa'

let cached: PimAdapter | null = null

export function getPimAdapter(): PimAdapter {
  if (cached) return cached
  const mode = (process.env.PIM_SOURCE ?? 'catalog').toLowerCase()
  if (mode === 'medusa') {
    cached = new MedusaPimAdapter()
  } else if (mode === 'kaggle') {
    cached = new KaggleCsvPimAdapter()
  } else {
    cached = new IntentlyCatalogPimAdapter()
  }
  return cached
}

/** Test helper — never call from app code. */
export function __resetPimAdapterForTests(): void {
  cached = null
}
