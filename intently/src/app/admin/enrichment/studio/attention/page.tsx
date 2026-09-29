// ─────────────────────────────────────────────────────────────────
// Intently · /admin/enrichment/studio/attention — needs-attention work queue
//
// The persistent counterpart to the catalogue dashboard's transient "needs
// attention" filter: every flagged product as a worklist item a PM can act on
// (Fix → the curate editor, Dismiss, Resolve). Reasons are recomputed each load
// over the override-merged catalogue, so a fix that clears a reason drops the
// product from the open list automatically. Read-only compute; no model calls.
// ─────────────────────────────────────────────────────────────────

import { readAttentionState } from '@/lib/enrichment/attention-state'

import { buildAttention } from '../catalog/insights'
import { loadVisionItems } from '../catalog/load'
import AttentionClient, { type QueueRow } from './AttentionClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Needs attention — Intently admin' }

export default function AttentionPage() {
  const v = loadVisionItems()
  if (!v) return <AttentionClient rows={[]} reasonMeta={[]} state={{}} hasCatalog={false} />

  const defs = buildAttention(v.items)
  const rows: QueueRow[] = v.items
    .map(it => ({
      id: it.id, image: it.image, garmentType: it.garmentType,
      primaryColour: it.primaryColour, pattern: it.pattern, formality: it.formality,
      situationFit: Number(it.situationFit.toFixed(2)),
      reasons: defs.filter(d => d.test(it)).map(d => ({ id: d.id, label: d.label, hint: d.hint, outcome: d.outcome })),
    }))
    .filter(r => r.reasons.length > 0)

  const present = new Set(rows.flatMap(r => r.reasons.map(x => x.id)))
  const reasonMeta = defs.filter(d => present.has(d.id)).map(d => ({ id: d.id, label: d.label }))

  return <AttentionClient rows={rows} reasonMeta={reasonMeta} state={readAttentionState()} hasCatalog />
}
