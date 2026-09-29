// ─────────────────────────────────────────────
// Intently · Asset adapters and lookups
//
// Sits between Product and every surface that thinks in terms of "things you
// can put in a cart" (cart drawer, checkout, product cards). The Asset union
// collapsed to a single 'product' kind when recipes were removed; these
// helpers keep the composite-id convention in one place.
// ─────────────────────────────────────────────

import type { Asset, AssetKind } from '@/types/asset'
import type { CartItem, Product } from '@/types'
import { getProductById } from './data'

// ── Composite id helpers ────────────────────
export function productAssetId(productId: string): string { return `product:${productId}` }

export function parseAssetId(id: string): { kind: AssetKind; innerId: string } | null {
  const idx = id.indexOf(':')
  if (idx <= 0) return null
  const kindStr = id.slice(0, idx)
  const innerId = id.slice(idx + 1)
  if (!innerId || kindStr !== 'product') return null
  return { kind: 'product', innerId }
}

// ── Adapter ─────────────────────────────────
export function productToAsset(product: Product): Asset {
  return {
    kind: 'product',
    id: productAssetId(product.id),
    name: product.name,
    imageUrl: product.imageUrl,
    imageAlt: product.name,
    price: product.price,
    fulfillment: 'physical',
    product,
  }
}

// ── Composite-id lookup ─────────────────────
export function getAssetById(id: string): Asset | undefined {
  const parsed = parseAssetId(id)
  if (!parsed) return undefined
  const p = getProductById(parsed.innerId)
  return p ? productToAsset(p) : undefined
}

// ── Cart projection ─────────────────────────
export function cartProductIds(items: CartItem[]): string[] {
  return items.map(i => i.asset.product.id)
}
