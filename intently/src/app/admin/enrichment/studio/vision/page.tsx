// ─────────────────────────────────────────────────────────────────
// Intently · /admin/enrichment/studio/vision — Vision enrichment
//
// Renders the enriched cache (local .enrichment/vision-*.json, or Supabase on
// cloud — the vision store decides) and shows, per product, PIM-sourced
// context vs vision-enriched context: the answer to "what does the image add
// that the PIM never had?". No model call happens on render; the batch runs
// through /api/admin/vision-enrich, which the client drives in chunks.
// ─────────────────────────────────────────────────────────────────

import { readVisionReport } from '@/lib/enrichment/vision/store'

import VisionClient from './VisionClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Vision enrichment — Intently admin' }

export default async function VisionPage() {
  // Enrichment now runs in-process and persists through the store, so it works
  // on serverless too — no environment gate here any more. The run control
  // fetches its own live status.
  return <VisionClient report={await readVisionReport('sample')} />
}
