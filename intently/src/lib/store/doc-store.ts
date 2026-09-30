// ─────────────────────────────────────────────
// store/doc-store.ts  ·  SERVER ONLY
//
// The PM-editable runtime documents (config, situations) as whole-JSON blobs.
// One key per document; the backend is either local files (.enrichment/*.json,
// the dev/CI default) or Supabase `runtime_kv` (cloud) — selected by
// INTENTLY_STORE. Symmetric on purpose: the same keys, the same shapes, so the
// swap is a backend change, not a data-model change (cloud-demo-plan.md #2/#3).
//
// PUBLIC DEMO (INTENTLY_PUBLIC_DEMO=1, see lib/public-demo.ts): every read is
// "this visitor's copy, else the shared base", and every write or delete goes
// to the visitor's sandbox ONLY. The shared base is never written in public
// mode — not even when no session can be resolved (the write is dropped). A
// delete is recorded as a tombstone, so "revert to default" means the built-in
// default for that visitor, not whatever the shared base holds.
//
// Async because the cloud path is network I/O; the local path just wraps fs.
// Reads fail soft to null (caller applies its own default); the cloud read
// falls back to the local file on error so the demo never dead-ends.
// ─────────────────────────────────────────────

import 'server-only'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'

import { supabaseConfigured, select, upsert, remove } from '@/lib/supabase/rest'
import { isPublicDemo, currentSandboxId } from '@/lib/public-demo'
import { sandboxGet, sandboxSet, sandboxClear } from './sandbox'

export type DocKey =
  | 'runtime-config'
  | 'situation-custom'
  | 'situation-overrides'
  | 'situation-active'
  | 'vision-run'          // resumable vision-enrichment run status
  | 'product-overrides'   // curator attribute edits (was a raw .enrichment write)
  | 'attention-state'     // needs-attention queue (was a raw .enrichment write)

export const DOC_KEYS: readonly DocKey[] = [
  'runtime-config', 'situation-custom', 'situation-overrides', 'situation-active',
  'vision-run', 'product-overrides', 'attention-state',
]

// What a visitor's sandbox stores per document: the value, or a tombstone.
type SandboxEntry<T> = { v: T } | { deleted: true }

/** The visitor's own copy: `{ hit: true, value }` (value null = tombstoned),
 *  or `{ hit: false }` when they have not touched this document. */
async function readSandbox<T>(key: DocKey): Promise<{ hit: true; value: T | null } | { hit: false }> {
  const sid = await currentSandboxId()
  if (!sid) return { hit: false }
  const raw = await sandboxGet(sid, key)
  if (raw === null) return { hit: false }
  try {
    const entry = JSON.parse(raw) as SandboxEntry<T>
    return { hit: true, value: 'deleted' in entry ? null : entry.v }
  } catch {
    return { hit: false }
  }
}

async function writeSandbox<T>(key: DocKey, entry: SandboxEntry<T>): Promise<void> {
  const sid = await currentSandboxId()
  if (!sid) return // no session to own the change — never fall through to the shared base
  await sandboxSet(sid, key, JSON.stringify(entry))
}

/** Public demo only: drop every change this visitor made ("reset my session"). */
export async function clearSandboxDocs(): Promise<boolean> {
  const sid = await currentSandboxId()
  if (!sid) return false
  await sandboxClear(sid, DOC_KEYS)
  return true
}

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
  if (isPublicDemo()) {
    const own = await readSandbox<T>(key)
    if (own.hit) return own.value
  }
  return readBaseDoc<T>(key)
}

/** The shared document, ignoring any visitor sandbox. */
export async function readBaseDoc<T>(key: DocKey): Promise<T | null> {
  if (supabaseActive()) {
    const rows = await select<{ value: T }>('runtime_kv', `select=value&key=eq.${key}`)
    if (rows === null) return readFile<T>(key)   // Supabase error → local fallback
    return rows[0]?.value ?? null
  }
  return readFile<T>(key)
}

/** Write one document (whole-value upsert). */
export async function writeDoc<T>(key: DocKey, value: T): Promise<void> {
  if (isPublicDemo()) return writeSandbox(key, { v: value })
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
  if (isPublicDemo()) return writeSandbox(key, { deleted: true })
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
