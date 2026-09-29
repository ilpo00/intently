// ─────────────────────────────────────────────
// POST /api/analytics/order — the order webhook (closes the commerce loop).
//
// Called by the host storefront's backend on order completion (Medusa v2
// `order.placed` subscriber — see docs/medusa-cloud-plan.md §5). Requires a
// shared secret: this endpoint is a write path reachable from the internet,
// so unlike the shopper-side track endpoint it is NOT open. If the secret
// env is unset the endpoint reports 501 — an unconfigured webhook must fail
// loudly at integration time, never accept silently.
//
// Emits an OrderEvent; the analytics funnel's "Purchased" step goes live
// when order events exist in range. sessionId attribution is optional and
// honest — an order without it still counts, unattributed.
// ─────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { emitEvent, type OrderItem } from '@/lib/analytics/events'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const secret = process.env.INTENTLY_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'webhook not configured (INTENTLY_WEBHOOK_SECRET unset)' }, { status: 501 })
  }
  if (req.headers.get('x-intently-webhook-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: {
    orderId?: string
    sessionId?: string | null
    totalUsd?: number
    items?: { productId?: string; title?: string; quantity?: number; unitUsd?: number }[]
    source?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (typeof body.orderId !== 'string' || !body.orderId.trim()) {
    return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
  }

  const items: OrderItem[] = (body.items ?? [])
    .filter(i => typeof i.productId === 'string')
    .slice(0, 100)
    .map(i => ({
      productId: String(i.productId).slice(0, 128),
      title: typeof i.title === 'string' ? i.title.slice(0, 160) : '',
      quantity: typeof i.quantity === 'number' && i.quantity > 0 ? Math.floor(i.quantity) : 1,
      unitUsd: typeof i.unitUsd === 'number' && i.unitUsd >= 0 ? i.unitUsd : 0,
    }))

  emitEvent({
    type: 'order',
    ts: new Date().toISOString(),
    orderId: body.orderId.slice(0, 128),
    sessionId: typeof body.sessionId === 'string' && body.sessionId ? body.sessionId.slice(0, 64) : null,
    totalUsd: typeof body.totalUsd === 'number' && body.totalUsd >= 0 ? body.totalUsd : null,
    items,
    source: typeof body.source === 'string' ? body.source.slice(0, 32) : 'medusa',
  })
  return NextResponse.json({ ok: true })
}
