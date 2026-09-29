// ─────────────────────────────────────────────────────────────────
// Intently · embed mode
//
// Intently runs in two modes:
//   - standalone (default): the full river, its own cart/checkout.
//   - embedded (plugin): served under a basePath (e.g. /discover) inside a
//     host storefront via Next.js Multi-Zones. The host owns the cart, so
//     Intently is purely a discovery surface that hands off to the host's
//     product pages.
//
// The single switch is NEXT_PUBLIC_BASE_PATH (set when embedded).
// ─────────────────────────────────────────────────────────────────

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || ''
export const EMBEDDED = BASE_PATH !== ''

/** Strip the river id prefix ("k15970" → "15970"). */
function articleId(productId: string): string {
  return productId.replace(/^k/, '')
}

/**
 * The host storefront's product page for a discovered product. Cross-zone, so
 * callers MUST use a raw <a> (not next/link, which would prefix the basePath).
 * Medusa product handle = `kaggle-{articleId}`; region from env (default gb).
 */
export function storefrontProductUrl(productId: string): string {
  const region = process.env.NEXT_PUBLIC_STOREFRONT_REGION || 'gb'
  return `/${region}/products/kaggle-${articleId(productId)}`
}
