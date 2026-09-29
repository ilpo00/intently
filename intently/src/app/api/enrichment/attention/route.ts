// ─────────────────────────────────────────────────────────────────
// GET /api/enrichment/attention      — the saved triage state (id → entry)
// PUT /api/enrichment/attention      — set one product's state
//                                      body: { id, status: open|dismissed|resolved, note? }
//
// Backs the needs-attention work queue. Admin-gated. Runtime layer only —
// .enrichment/attention-state.json, never the committed catalogue.
// ─────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'

import { assertAdminApi } from '@/lib/auth/admin-guard'
import { readAttentionState, setAttention, type AttentionStatus } from '@/lib/enrichment/attention-state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES: AttentionStatus[] = ['open', 'dismissed', 'resolved']

export async function GET() {
  const deny = await assertAdminApi(); if (deny) return deny
  return NextResponse.json({ state: readAttentionState() })
}

export async function PUT(req: Request) {
  const deny = await assertAdminApi(); if (deny) return deny
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  const status = STATUSES.includes(body.status as AttentionStatus) ? (body.status as AttentionStatus) : null
  if (!id || !status) return NextResponse.json({ error: 'id and valid status required' }, { status: 400 })

  const note = typeof body.note === 'string' ? body.note : undefined
  const state = setAttention(id, status, note)
  return NextResponse.json({ ok: true, state })
}
