// ─────────────────────────────────────────────────────────────────
// Vision enrichment contracts — shared by the enrichment core (server), the
// vision store, the API route, and the Studio client. Kept here rather than
// colocated in VisionClient.tsx because they now cross the client/server
// boundary in both directions.
// ─────────────────────────────────────────────────────────────────

/** Tier-0 validated attributes read from a product photo. */
export interface VisionAttrs {
  garmentType: string
  primaryColour: string
  colours: string[]
  pattern: string
  materials: string[]
  silhouette: string
  formality: number
  seasons: string[]
  occasions: string[]
  styleArchetypes: string[]
  discoveryQueries?: string[]
  description: string
  confidence: number
}

/** Thin PIM master data — what a real PIM reliably holds. */
export interface VisionPim {
  title?: string
  articleType?: string
  gender?: string
  baseColour?: string | null
}

/** 'sample' = the 10 curated PIM-stub products (the PIM-vs-vision teaching
 *  view). 'catalog' = the full product catalogue. Lives here, not in the
 *  store, because the client run control needs it and the store is
 *  server-only. */
export type VisionScope = 'sample' | 'catalog'

/** What the batch is asked to analyse. */
export interface VisionInput {
  id: string
  image: string
  pim?: VisionPim
}

/** One analysed product. `vision` absent + `error` present = this product
 *  failed; the run continues (per-product failure is not run failure). */
export interface VisionRecord {
  id: string
  image: string
  pim?: VisionPim
  vision?: VisionAttrs
  flags?: string[]
  usage?: { input: number; output: number }
  model?: string
  ms?: number
  error?: string
}

/** The aggregate the Studio renders. Derived from the records on read, so it
 *  can never disagree with them. */
export interface VisionReport {
  version: string
  model: string
  count: number
  ok: number
  tokens: { input: number; output: number; total: number }
  avgPerProduct: number
  estCostUSD: number
  estCostPerProductUSD: number
  rateNote: string
  durationMs: number
  records: VisionRecord[]
}

export type VisionRunState = 'idle' | 'running' | 'done' | 'failed' | 'cancelled'

/** Resumable run status. `cursor` is the number of inputs already attempted —
 *  the chunk loop resumes from there, which is what makes a 13-minute batch
 *  survivable across 60-second serverless invocations. */
export interface VisionRun {
  state: VisionRunState
  total: number
  cursor: number
  ok: number
  failed: number
  tokens: { input: number; output: number }
  startedAt?: string
  updatedAt?: string
  finishedAt?: string
  scope: 'sample' | 'catalog'
  lastError?: string
  tail: string[]
}

export const EMPTY_RUN: VisionRun = {
  state: 'idle', total: 0, cursor: 0, ok: 0, failed: 0,
  tokens: { input: 0, output: 0 }, scope: 'catalog', tail: [],
}
