// ─────────────────────────────────────────────
// POST /api/analytics/track — client-side analytics events (cart adds).
//
// The add-to-cart signal fires here in BOTH modes (embedded → Medusa cart,
// standalone → local cart), because the Medusa /api/cart POST only happens
// when embedded. Turn events are emitted server-side by /api/discover — this
// route only carries what the server can't see. Fire-and-forget on the
// client; deliberately tolerant here (analytics must never error a shopper).
// ─────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { emitEvent } from '@/lib/analytics/events'
import { checkRateLimitShared } from '@/lib/discovery/guardrails-shared'
import { readRuntimeConfig } from '@/lib/discovery/runtime-config'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim()
  // Replica-safe (Upstash when configured): this endpoint writes to the shared
  // analytics store and is reachable by anyone on an open deployment.
  const { limits } = await readRuntimeConfig()
  const rate = await checkRateLimitShared(`track:${ip}`, { perMin: limits.ratePerMin, perDay: limits.ratePerDay })
  if (!rate.ok) return NextResponse.json({ ok: false }, { status: 429 })

  let body: { type?: string; sessionId?: string; productId?: string; title?: string; surface?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  if (body.type !== 'cart' || typeof body.productId !== 'string') {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  emitEvent({
    type: 'cart',
    ts: new Date().toISOString(),
    sessionId: typeof body.sessionId === 'string' ? body.sessionId.slice(0, 64) : 'anon',
    productId: body.productId.slice(0, 128),
    title: typeof body.title === 'string' ? body.title.slice(0, 160) : '',
    surface: body.surface === 'companion' ? 'companion' : body.surface === 'reveal' ? 'reveal' : 'unknown',
  })
  return NextResponse.json({ ok: true })
}
