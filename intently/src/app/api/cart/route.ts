// ─────────────────────────────────────────────────────────────────
// POST /api/cart   — add a variant to the SHARED Medusa cart
// GET  /api/cart   — current shared-cart item count
//
// Intently runs embedded in the storefront (same origin). The storefront keeps
// its cart id in the httpOnly `_medusa_cart_id` cookie; we read/write that SAME
// cookie and talk to the SAME Medusa Store cart API, so an item added from the
// discovery plugin lands in the storefront's cart. Intently shows NO cart of
// its own — the host storefront owns it.
// ─────────────────────────────────────────────────────────────────

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const BACKEND = process.env.MEDUSA_BACKEND_URL || 'http://localhost:9000'
const KEY = process.env.MEDUSA_PUBLISHABLE_KEY
const CART_COOKIE = '_medusa_cart_id'

interface CartItem {
  quantity?: number
  title?: string
  product_title?: string
  thumbnail?: string | null
  unit_price?: number
}
interface Cart { id?: string; items?: CartItem[] }

// The compact line-item shape the discovery overlay's cart summary renders.
function summariseItems(items: CartItem[] | undefined) {
  return (items ?? []).map(it => ({
    name: it.product_title || it.title || 'Item',
    // Medusa stores an ABSOLUTE thumbnail (http://localhost:3000/catalog/x.webp)
    // which 404s in the embed zone (basePath). Strip the host so it's the same
    // relative /catalog/x.webp the discovery cards use (served by the host origin).
    image: (it.thumbnail || '').replace(/^https?:\/\/[^/]+/, ''),
    quantity: it.quantity ?? 1,
    // Medusa v2 prices are decimal currency units; the overlay formats cents.
    price: typeof it.unit_price === 'number' ? Math.round(it.unit_price * 100) : 0,
  }))
}

function medusaHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' }
  if (KEY) h['x-publishable-api-key'] = KEY
  return h
}

function medusa(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BACKEND}${path}`, {
    ...init,
    headers: { ...medusaHeaders(), ...(init?.headers as Record<string, string>) },
    cache: 'no-store',
  })
}

function countItems(items: CartItem[] | undefined): number {
  return (items ?? []).reduce((n, it) => n + (it.quantity ?? 0), 0)
}

async function regionId(): Promise<string | undefined> {
  const res = await medusa('/store/regions')
  if (!res.ok) return undefined
  const body = (await res.json()) as { regions?: { id: string }[] }
  return body.regions?.[0]?.id
}

export async function GET(): Promise<NextResponse> {
  const cartId = (await cookies()).get(CART_COOKIE)?.value
  if (!cartId) return NextResponse.json({ count: 0, items: [] })
  const res = await medusa(`/store/carts/${cartId}?fields=*items`)
  if (!res.ok) return NextResponse.json({ count: 0, items: [] })
  const body = (await res.json()) as { cart?: Cart }
  return NextResponse.json({
    count: countItems(body.cart?.items),
    items: summariseItems(body.cart?.items),
  })
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: { variantId?: string; quantity?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  const variantId = body.variantId
  const quantity = body.quantity ?? 1
  if (!variantId) {
    return NextResponse.json({ error: 'variantId is required' }, { status: 400 })
  }

  let cartId = (await cookies()).get(CART_COOKIE)?.value

  // Create a cart (shared with the storefront) if none exists yet.
  if (!cartId) {
    const region = await regionId()
    const createRes = await medusa('/store/carts', {
      method: 'POST',
      body: JSON.stringify(region ? { region_id: region } : {}),
    })
    if (!createRes.ok) {
      return NextResponse.json({ error: `cart create failed: ${createRes.status}` }, { status: 502 })
    }
    cartId = ((await createRes.json()) as { cart?: Cart }).cart?.id
    if (!cartId) return NextResponse.json({ error: 'no cart id returned' }, { status: 502 })
  }

  const addRes = await medusa(`/store/carts/${cartId}/line-items`, {
    method: 'POST',
    body: JSON.stringify({ variant_id: variantId, quantity }),
  })
  if (!addRes.ok) {
    return NextResponse.json(
      { error: `add line item failed: ${addRes.status} ${await addRes.text()}` },
      { status: 502 },
    )
  }
  const addBody = (await addRes.json()) as { cart?: Cart }

  const res = NextResponse.json({ count: countItems(addBody.cart?.items), cartId })
  // Share the cart with the storefront (same origin, same cookie name).
  res.cookies.set(CART_COOKIE, cartId, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 7,
  })
  return res
}
