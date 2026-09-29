// ─────────────────────────────────────────────
// vision/store.ts  ·  SERVER ONLY
//
// Where vision-enrichment output lives. Same shape either side of the swap
// (INTENTLY_STORE): local JSON files in .enrichment/ — the dev/CI default and
// byte-compatible with the paths the Studio pages already read — or Supabase
// `vision_records` (migration 0016) for the cloud demo, where the filesystem
// is read-only.
//
// Records are addressed per-product so a chunked run can append incrementally
// without rewriting the whole batch; the aggregate VisionReport is DERIVED on
// read (buildReport) so it can never drift from the records it summarises.
//
// Run state rides doc-store (runtime_kv on cloud) — see readVisionRun below.
// ─────────────────────────────────────────────

import 'server-only'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'

import { supabaseConfigured, select, upsert, remove } from '@/lib/supabase/rest'
import { readDoc, writeDoc, deleteDoc } from '@/lib/store/doc-store'
import { RATE, RATE_NOTE, VISION_MODEL_DEFAULT } from './enrich'
import type { VisionRecord, VisionReport, VisionRun, VisionScope } from '@/types/vision'
import { EMPTY_RUN } from '@/types/vision'

export type { VisionScope } from '@/types/vision'

function supabaseActive(): boolean {
  return process.env.INTENTLY_STORE === 'supabase' && supabaseConfigured()
}

/** Local paths are the pre-cloud ones on purpose — the Studio pages and any
 *  existing .enrichment cache keep working untouched. INTENTLY_VISION_DIR
 *  exists so tests never write into the developer's real cache. */
function filePath(scope: VisionScope): string {
  const dir = process.env.INTENTLY_VISION_DIR ?? join(process.cwd(), '.enrichment')
  return join(dir, scope === 'sample' ? 'vision-v2.json' : 'vision-catalog.json')
}

interface StoredFile { records?: VisionRecord[] }

function readFileRecords(scope: VisionScope): VisionRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(filePath(scope), 'utf8')) as StoredFile
    return Array.isArray(parsed.records) ? parsed.records : []
  } catch {
    return []
  }
}

function writeFileRecords(scope: VisionScope, records: VisionRecord[]): void {
  const p = filePath(scope)
  mkdirSync(dirname(p), { recursive: true })
  // Persist the derived report alongside the records: the file IS the report,
  // which is what the existing Studio readers expect.
  writeFileSync(p, JSON.stringify(buildReport(records, scope), null, 2))
}

interface RecordRow { id: string; scope: string; record: VisionRecord }

/** All records for a scope. Supabase errors fall back to the local file so a
 *  transient outage degrades to "whatever was cached", never to a crash. */
export async function readVisionRecords(scope: VisionScope): Promise<VisionRecord[]> {
  if (supabaseActive()) {
    const rows = await select<RecordRow>('vision_records', `select=record&scope=eq.${scope}&order=id.asc`)
    if (rows === null) return readFileRecords(scope)
    return rows.map(r => r.record)
  }
  return readFileRecords(scope)
}

/** Upsert a chunk's worth of records. Idempotent per product id, so a retried
 *  or overlapping chunk cannot double-count. */
export async function appendVisionRecords(scope: VisionScope, recs: VisionRecord[]): Promise<void> {
  if (!recs.length) return
  if (supabaseActive()) {
    const ok = await upsert(
      'vision_records',
      recs.map(r => ({ id: r.id, scope, record: r, updated_at: new Date().toISOString() })),
    )
    if (ok) return
    // No local fallback on cloud: the FS is read-only and a silent local write
    // would strand data the next invocation can't see.
    throw new Error('could not persist vision records to Supabase')
  }
  const existing = readFileRecords(scope)
  const byId = new Map(existing.map(r => [r.id, r]))
  for (const r of recs) byId.set(r.id, r)
  writeFileRecords(scope, [...byId.values()])
}

/** Remove every enriched record for a scope. The destructive half of reset. */
export async function clearVisionRecords(scope: VisionScope): Promise<void> {
  if (supabaseActive()) {
    const ok = await remove('vision_records', `scope=eq.${scope}`)
    if (!ok) throw new Error('could not clear vision records in Supabase')
    return
  }
  try {
    rmSync(filePath(scope))
  } catch {
    /* already absent — clearing is idempotent */
  }
}

/** Derive the aggregate from the records. Never stored independently. */
export function buildReport(records: VisionRecord[], scope: VisionScope): VisionReport {
  const ok = records.filter(r => r.vision)
  const input = records.reduce((s, r) => s + (r.usage?.input ?? 0), 0)
  const output = records.reduce((s, r) => s + (r.usage?.output ?? 0), 0)
  const cost = input * RATE.in + output * RATE.out
  return {
    version: scope === 'sample' ? 'v2' : 'catalog',
    model: records.find(r => r.model)?.model ?? VISION_MODEL_DEFAULT,
    count: records.length,
    ok: ok.length,
    tokens: { input, output, total: input + output },
    avgPerProduct: ok.length ? Math.round((input + output) / ok.length) : 0,
    estCostUSD: Number(cost.toFixed(4)),
    estCostPerProductUSD: ok.length ? Number((cost / ok.length).toFixed(5)) : 0,
    rateNote: RATE_NOTE,
    durationMs: records.reduce((s, r) => s + (r.ms ?? 0), 0),
    records,
  }
}

/** The report the Studio renders, or null when nothing has been enriched. */
export async function readVisionReport(scope: VisionScope): Promise<VisionReport | null> {
  const records = await readVisionRecords(scope)
  return records.length ? buildReport(records, scope) : null
}

// ── run state ────────────────────────────────────────────────────
// Small and hot (written once per chunk), so it rides the same doc-store
// backend as the other PM-editable runtime documents.

export async function readVisionRun(): Promise<VisionRun> {
  return (await readDoc<VisionRun>('vision-run')) ?? EMPTY_RUN
}

export async function writeVisionRun(run: VisionRun): Promise<void> {
  await writeDoc('vision-run', { ...run, updatedAt: new Date().toISOString() })
}

export async function clearVisionRun(): Promise<void> {
  await deleteDoc('vision-run')
}
