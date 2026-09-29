// ─────────────────────────────────────────────────────────────────
// PUT    /api/enrichment/products/[id]  — save a curator attribute override
// DELETE /api/enrichment/products/[id]  — clear it
//
// Both persist to .enrichment/product-overrides.json and immediately re-embed
// the product (pipeline.syncOne) so discovery ranking + the shown attributes
// reflect the edit. Admin-gated. The committed catalogue is never mutated.
// ─────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { NextResponse } from 'next/server'

import { assertAdminApi } from '@/lib/auth/admin-guard'
import { getProductById } from '@/lib/data'
import { syncOne } from '@/lib/enrichment'
import {
  OVERRIDES_PATH, readProductOverrides, mergeProduct, type ProductOverride,
} from '@/lib/enrichment/product-overrides'
import type { StyleArchetype } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ARCHES: StyleArchetype[] = ['classic', 'minimalist', 'romantic', 'bohemian', 'sporty', 'edgy', 'preppy', 'relaxed', 'elegant']
const SEASONS = ['spring', 'summer', 'autumn', 'winter']
const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(s => s.trim().toLowerCase()).filter(Boolean) : [])

// Keep only curatable fields, coerced to the contract the discovery layer reads.
function sanitize(body: Record<string, unknown>): ProductOverride {
  const o: ProductOverride = {}
  if ('color' in body) o.color = strArr(body.color)
  if ('pattern' in body) o.pattern = String(body.pattern ?? 'solid').trim().toLowerCase() || 'solid'
  if ('occasionTags' in body) o.occasionTags = strArr(body.occasionTags)
  if ('styleTags' in body) o.styleTags = strArr(body.styleTags).filter((s): s is StyleArchetype => (ARCHES as string[]).includes(s))
  if ('formalityLevel' in body) o.formalityLevel = Math.min(5, Math.max(1, Math.round(Number(body.formalityLevel) || 2)))
  if ('season' in body) o.season = strArr(body.season).filter(s => SEASONS.includes(s))
  if ('fabric' in body) o.fabric = strArr(body.fabric)
  return o
}

function writeOverrides(map: Record<string, ProductOverride>) {
  mkdirSync(dirname(OVERRIDES_PATH), { recursive: true })
  writeFileSync(OVERRIDES_PATH, JSON.stringify(map, null, 2))
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const deny = await assertAdminApi(); if (deny) return deny
  const { id } = await params
  const base = getProductById(id)
  if (!base) return NextResponse.json({ error: 'unknown product' }, { status: 404 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const ovr = readProductOverrides()
  ovr[id] = sanitize(body)
  writeOverrides(ovr)
  const report = await syncOne(id) // re-embed with the edit
  return NextResponse.json({ ok: report.failed === 0, product: mergeProduct(base, ovr[id]) })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const deny = await assertAdminApi(); if (deny) return deny
  const { id } = await params
  const base = getProductById(id)
  const ovr = readProductOverrides()
  delete ovr[id]
  writeOverrides(ovr)
  await syncOne(id)
  return NextResponse.json({ ok: true, product: base ?? null })
}
