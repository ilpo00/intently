// ─────────────────────────────────────────────────────────────────
// enrichment/attention-state.ts  ·  SERVER ONLY
//
// Persists the merchandiser's triage of the needs-attention queue: which
// flagged products have been dismissed (not an issue) or resolved (handled).
// 'open' is the implicit default for any flagged product with no saved state,
// so we only store the exceptions — the document stays small and self-cleaning.
//
// A runtime layer like product-overrides.ts / situation-overrides.ts, persisted
// through the doc-store (local .enrichment/attention-state.json in dev/CI,
// Supabase runtime_kv on cloud, a per-visitor sandbox in the public demo).
// ─────────────────────────────────────────────────────────────────

import { readDoc, writeDoc } from '@/lib/store/doc-store'

export type AttentionStatus = 'open' | 'dismissed' | 'resolved'
export interface AttentionEntry {
  status: AttentionStatus
  note?: string
  updatedAt: string
}

export type AttentionMap = Record<string, AttentionEntry>

export async function readAttentionState(): Promise<AttentionMap> {
  return (await readDoc<AttentionMap>('attention-state')) ?? {}
}

/** Set a product's triage state. Reopening (→ 'open') clears the entry, since
 *  'open' is the default — keeps the document to just the exceptions. */
export async function setAttention(id: string, status: AttentionStatus, note?: string): Promise<AttentionMap> {
  const map = await readAttentionState()
  if (status === 'open') {
    delete map[id]
  } else {
    map[id] = { status, note: note?.trim() || undefined, updatedAt: new Date().toISOString() }
  }
  await writeDoc('attention-state', map)
  return map
}
