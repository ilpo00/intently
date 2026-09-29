// ─────────────────────────────────────────────
// Intently · Asset
//
// Thin wrapper the cart / checkout / detail surfaces consume instead of a
// raw Product. It carries a composite id and a fulfillment kind so those
// surfaces never reach into the underlying type.
//
// This was a Product | Recipe discriminated union in an earlier version.
// Recipes were dropped, so the union collapsed to a single 'product' member.
// It's kept as a (one-member) tagged shape rather than aliased to Product so
// the cart's composite-id convention and a future second kind both stay cheap
// to reintroduce.
//
// Composite id format: `product:${productId}` (e.g. 'product:1163').
// ─────────────────────────────────────────────

import type { Product } from './index'

// What happens after checkout for an item of this kind.
//   physical → ship it; collect address; returns apply.
export type FulfillmentKind = 'physical'

interface AssetCommon {
  id: string                 // composite — see header
  name: string
  tagline?: string
  imageUrl: string
  imageAlt: string
  price: number              // cents
  fulfillment: FulfillmentKind
}

export type Asset = AssetCommon & { kind: 'product'; product: Product }

export type AssetKind = Asset['kind']
