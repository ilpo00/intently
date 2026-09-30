// ─────────────────────────────────────────────────────────────────
// Intently · /admin/enrichment/studio/models — Model bench
//
// PM surface for testing and validating discovery models per use case:
// pick a query, run it through up to two provider/model configurations
// side by side, and compare the parsed context, the spoken prose, latency,
// and the faithfulness/grounding verdicts. The shopper path stays on the
// env-configured default; the bench probes explicit overrides via
// POST /api/discover/probe.
// ─────────────────────────────────────────────────────────────────

import ModelsClient from './ModelsClient'
import { isPublicDemo } from '@/lib/public-demo'
import { PROBE_SAMPLE_QUERIES } from '@/lib/discovery/probe-fixtures'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Model bench — Intently admin' }

export default function ModelsPage() {
  // Which providers have a key on this deployment — the client greys out the rest.
  // Public demo: the bench serves recordings for every provider (no live
  // calls), so all three are selectable regardless of which keys exist.
  const publicDemo = isPublicDemo()
  const available = {
    deepseek: publicDemo || !!process.env.DEEPSEEK_API_KEY,
    haiku: publicDemo || !!process.env.ANTHROPIC_API_KEY,
    openai: publicDemo || !!process.env.OPENAI_API_KEY,
  }
  const activeDefaults = {
    parser: process.env.DISCOVERY_PARSER || 'off — keyword parsing',
    generation: process.env.DISCOVERY_GENERATION || 'off — built-in templates',
  }
  return (
    <ModelsClient
      available={available}
      activeDefaults={activeDefaults}
      publicSamples={publicDemo ? [...PROBE_SAMPLE_QUERIES] : null}
    />
  )
}
