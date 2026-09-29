// ─────────────────────────────────────────────────────────────────
// enrichment/attention-state.ts  (server only — uses node:fs)
//
// Persists the merchandiser's triage of the needs-attention queue: which
// flagged products have been dismissed (not an issue) or resolved (handled).
// 'open' is the implicit default for any flagged product with no saved state,
// so we only store the exceptions — the file stays small and self-cleaning.
//
// A runtime layer like product-overrides.ts / situation-overrides.ts:
// .enrichment/attention-state.json is gitignored; the catalogue is untouched.
// ─────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

export const ATTENTION_STATE_PATH = join(process.cwd(), '.enrichment/attention-state.json')

export type AttentionStatus = 'open' | 'dismissed' | 'resolved'
export interface AttentionEntry {
  status: AttentionStatus
  note?: string
  updatedAt: string
}

export function readAttentionState(): Record<string, AttentionEntry> {
  try {
    return JSON.parse(readFileSync(ATTENTION_STATE_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function writeAttentionState(map: Record<string, AttentionEntry>) {
  mkdirSync(dirname(ATTENTION_STATE_PATH), { recursive: true })
  writeFileSync(ATTENTION_STATE_PATH, JSON.stringify(map, null, 2))
}

/** Set a product's triage state. Reopening (→ 'open') clears the entry, since
 *  'open' is the default — keeps the file to just the exceptions. */
export function setAttention(id: string, status: AttentionStatus, note?: string): Record<string, AttentionEntry> {
  const map = readAttentionState()
  if (status === 'open') {
    delete map[id]
  } else {
    map[id] = { status, note: note?.trim() || undefined, updatedAt: new Date().toISOString() }
  }
  writeAttentionState(map)
  return map
}
