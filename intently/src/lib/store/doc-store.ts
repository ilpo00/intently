// ─────────────────────────────────────────────
// store/doc-store.ts  ·  SERVER ONLY
//
// The PM-editable runtime documents (config, situations) as whole-JSON blobs.
// One key per document; the backend is either local files (.enrichment/*.json,
// the dev/CI default) or Supabase `runtime_kv` (cloud) — selected by
// INTENTLY_STORE. Symmetric on purpose: the same keys, the same shapes, so the
// swap is a backend change, not a data-model change (cloud-demo-plan.md #2/#3).
//
// Async because the cloud path is network I/O; the local path just wraps fs.
// Reads fail soft to null (caller applies its own default); the cloud read
// falls back to the local file on error so the demo never dead-ends.
// ─────────────────────────────────────────────

import 'server-only'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'

import { supabaseConfigured, select, upsert, remove } from '@/lib/supabase/rest'

export type DocKey =
  | 'runtime-config'
  | 'situation-custom'
  | 'situation-overrides'
  | 'situation-active'
  | 'vision-run'          // resumable vision-enrichment run status
  | 'product-overrides'   // curator attribute edits (was a raw .enrichment write)
  | 'attention-state'     // needs-attention queue (was a raw .enrichment write)

function supabaseActive(): boolean {
  return process.env.INTENTLY_STORE === 'supabase' && supabaseConfigured()
}

function filePath(key: DocKey): string {
  // Backward-compatible with the pre-cloud local paths so existing behavior +
  // tests are unchanged: runtime-config honors its explicit path override; the
  // situation docs live at <cwd>/.enrichment/<key>.json.
  if (key === 'runtime-config' && process.env.INTENTLY_RUNTIME_CONFIG_PATH) {
    return process.env.INTENTLY_RUNTIME_CONFIG_PATH
  }
  return join(process.cwd(), '.enrichment', `${key}.json`)
}

function readFile<T>(key: DocKey): T | null {
  try {
    return JSON.parse(readFileSync(filePath(key), 'utf8')) as T
  } catch {
    return null
  }
}

/** Read one document; null when absent. */
export async function readDoc<T>(key: DocKey): Promise<T | null> {
  if (supabaseActive()) {
    const rows = await select<{ value: T }>('runtime_kv', `select=value&key=eq.${key}`)
    if (rows === null) return readFile<T>(key)   // Supabase error → local fallback
    return rows[0]?.value ?? null
  }
  return readFile<T>(key)
}

/** Write one document (whole-value upsert). */
export async function writeDoc<T>(key: DocKey, value: T): Promise<void> {
  if (supabaseActive()) {
    const ok = await upsert('runtime_kv', { key, value, updated_at: new Date().toISOString() })
    if (ok) return
    // fall through to a local write only if the FS is writable (dev)
  }
  try {
    mkdirSync(dirname(filePath(key)), { recursive: true })
    writeFileSync(filePath(key), JSON.stringify(value, null, 2))
  } catch {
    /* read-only FS on serverless with Supabase unavailable — nothing else to do */
  }
}

/** Delete one document (revert-to-default). */
export async function deleteDoc(key: DocKey): Promise<void> {
  if (supabaseActive()) {
    await remove('runtime_kv', `key=eq.${key}`)
    return
  }
  try { rmSync(filePath(key), { force: true }) } catch { /* absent */ }
}

/** True when the document exists (used for "override active?" checks). */
export async function docExists(key: DocKey): Promise<boolean> {
  return (await readDoc(key)) !== null
}
