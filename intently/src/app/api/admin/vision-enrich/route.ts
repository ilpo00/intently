// ─────────────────────────────────────────────
// /api/admin/vision-enrich  ·  ADMIN — run the vision enrichment
//
//   POST   → analyse ONE CHUNK of products, persist them, return progress.
//            Body: { scope?: 'sample'|'catalog', restart?: boolean }
//   GET    → current run status.
//   DELETE → clear the enriched records for a scope (the reset path).
//
// Chunked on purpose. A full catalogue run is ~292 products and the Anthropic
// low-tier org limit forces ~2.6s between calls, so the batch takes ~15
// minutes — far past any serverless function ceiling. Each POST does as much
// as fits in a time budget, writes what it finished, and returns a cursor;
// the client calls again until the run reports it is no longer running. That
// is what makes this work identically on a laptop and on Vercel.
//
// Replaces the old spawn-a-child-process design (retired 2026-07-18), which
// could not run on serverless at all: no process model, read-only filesystem.
// The work now happens in-process and output goes through the vision store
// (local JSON files, or Supabase on cloud), so nothing writes to disk there.
// ─────────────────────────────────────────────

import { NextResponse } from 'next/server'

import { assertAdminApi } from '@/lib/auth/admin-guard'
import { blockInPublicDemo } from '@/lib/public-demo-guard'
import { analyzeOne, visionClient, sleep, THROTTLE_MS } from '@/lib/enrichment/vision/enrich'
import {
  readVisionRun, writeVisionRun, clearVisionRun,
  appendVisionRecords, clearVisionRecords, readVisionRecords,
  type VisionScope,
} from '@/lib/enrichment/vision/store'
import type { VisionInput, VisionRecord, VisionRun } from '@/types/vision'
import { EMPTY_RUN } from '@/types/vision'
import visionCatalog from '@/lib/catalog/vision-catalog.json'
import sampleInputs from '@/lib/enrichment/vision/products.json'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** Vercel Hobby ceiling; the chunk budget below stays well inside it. */
export const maxDuration = 60

/** Stop starting new products past this point so the in-flight call and the
 *  persist step still finish within maxDuration. */
const CHUNK_BUDGET_MS = 42_000
const TAIL_LINES = 40

function inputsFor(scope: VisionScope): VisionInput[] {
  if (scope === 'sample') return sampleInputs as VisionInput[]
  // Derived from the committed catalogue rather than readdir(public/catalog):
  // a static import is always in the bundle, a directory listing on serverless
  // is not guaranteed.
  return (visionCatalog as { id: string; imageUrl?: string }[])
    .filter((p): p is { id: string; imageUrl: string } => Boolean(p.imageUrl))
    .map(p => ({ id: p.id, image: p.imageUrl }))
}

/** The sample is small enough to run unthrottled (as the old CLI did); a full
 *  catalogue run must respect the org rate limit. */
function throttleFor(scope: VisionScope): number {
  return scope === 'catalog' ? THROTTLE_MS : 0
}

function pushTail(run: VisionRun, line: string): void {
  run.tail.push(line)
  if (run.tail.length > TAIL_LINES) run.tail.shift()
}

export async function GET() {
  const deny = await assertAdminApi(); if (deny) return deny
  return NextResponse.json(await readVisionRun())
}

export async function POST(req: Request) {
  const deny = await assertAdminApi(); if (deny) return deny
  const blocked = blockInPublicDemo('Vision enrichment'); if (blocked) return blocked

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not set — the vision model needs it. Add it to the environment and redeploy.' },
      { status: 400 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { scope?: VisionScope; restart?: boolean }
  const scope: VisionScope = body.scope === 'catalog' ? 'catalog' : 'sample'

  let run = await readVisionRun()
  const inputs = inputsFor(scope)

  // Start a fresh run when asked, when nothing is in flight, or when the scope
  // changed under us (the previous cursor would be meaningless).
  const stale = run.state !== 'running' || run.scope !== scope
  if (body.restart || stale) {
    if (body.restart) await clearVisionRecords(scope)
    run = {
      ...EMPTY_RUN,
      state: 'running',
      scope,
      total: inputs.length,
      // Resume over what is already enriched unless this is an explicit
      // restart — re-running a finished catalogue shouldn't re-bill 292 calls.
      cursor: body.restart ? 0 : (await readVisionRecords(scope)).length,
      tokens: { input: 0, output: 0 },
      startedAt: new Date().toISOString(),
      tail: [`run started · scope ${scope} · ${inputs.length} products`],
    }
  }

  if (run.cursor >= inputs.length) {
    run.state = 'done'
    run.finishedAt = new Date().toISOString()
    await writeVisionRun(run)
    return NextResponse.json(run)
  }

  const client = visionClient()
  const throttle = throttleFor(scope)
  const started = Date.now()
  const batch: VisionRecord[] = []

  while (run.cursor < inputs.length && Date.now() - started < CHUNK_BUDGET_MS) {
    const product = inputs[run.cursor]
    try {
      const rec = await analyzeOne(client, product)
      batch.push(rec)
      run.ok += 1
      run.tokens.input += rec.usage?.input ?? 0
      run.tokens.output += rec.usage?.output ?? 0
      pushTail(run, `✓ ${product.id} · ${rec.vision?.primaryColour} ${rec.vision?.pattern}${rec.flags?.length ? ` · flags: ${rec.flags.join('; ')}` : ''}`)
    } catch (err) {
      // A product that fails is recorded and skipped — one bad image must not
      // abort a 15-minute batch.
      const message = err instanceof Error ? err.message : String(err)
      batch.push({ id: product.id, image: product.image, error: message })
      run.failed += 1
      run.lastError = message
      pushTail(run, `✗ ${product.id} · ${message}`)
    }
    run.cursor += 1
    if (throttle && run.cursor < inputs.length) await sleep(throttle)
  }

  try {
    await appendVisionRecords(scope, batch)
  } catch (err) {
    // Persist failed: roll the cursor back over this chunk so the next call
    // retries it instead of leaving a silent hole in the catalogue.
    run.cursor -= batch.length
    run.ok -= batch.filter(r => r.vision).length
    run.failed -= batch.filter(r => r.error).length
    run.state = 'failed'
    run.lastError = err instanceof Error ? err.message : String(err)
    run.finishedAt = new Date().toISOString()
    pushTail(run, `✗ could not persist chunk: ${run.lastError}`)
    await writeVisionRun(run)
    return NextResponse.json(run, { status: 500 })
  }

  if (run.cursor >= inputs.length) {
    run.state = 'done'
    run.finishedAt = new Date().toISOString()
    pushTail(run, `run complete · ${run.ok} ok · ${run.failed} failed`)
  }
  await writeVisionRun(run)
  return NextResponse.json(run)
}

export async function DELETE(req: Request) {
  const deny = await assertAdminApi(); if (deny) return deny
  const blocked = blockInPublicDemo('Clearing vision enrichment'); if (blocked) return blocked
  const { searchParams } = new URL(req.url)
  const scope: VisionScope = searchParams.get('scope') === 'catalog' ? 'catalog' : 'sample'
  await clearVisionRecords(scope)
  await clearVisionRun()
  return NextResponse.json({ ok: true, scope })
}
