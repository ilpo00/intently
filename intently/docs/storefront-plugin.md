# Intently as a storefront discovery plugin ("old vs new" demo)

This demo runs a **vanilla Medusa store** (the *old way* — browse / filter / cart)
with **Intently added as a discovery plugin** (the *new way* — describe a situation,
get a curated shortlist) over the **same catalog**. The thesis: Intently is a
pluggable discovery layer that drops into an existing ecommerce stack, not a
replacement storefront. Only *finding* the product changes; cart and checkout stay
the host store's.

## Topology

| Service | Port | Role |
|---|---|---|
| Medusa (Docker, `pim/`) | 9000 | Products **+ cart** + the shared catalogue (292 H&M products) |
| Storefront (`storefront/`, Medusa Next.js starter) | 8000 | **Host** — browse/filter/cart, **owns the cart** |
| Intently (`intently/`) | 3000, served under **`/discover`** | Embedded discovery plugin (no cart of its own) |

**Integration = Next.js Multi-Zones.** The storefront `next.config.js` rewrites
`/discover[/*]` → `http://localhost:3000/discover/*`; Intently runs with
`basePath=/discover` (set via `NEXT_PUBLIC_BASE_PATH`). The storefront `middleware.ts`
excludes `/discover` so its region (country-code) redirects don't hijack the rewrite.
A **"Shop by situation ✨"** link in the storefront nav enters the plugin.

## The shared cart (no duplicate cart)

Both apps are **same-origin** (`localhost:8000`). The storefront stores the cart id
in the **httpOnly `_medusa_cart_id` cookie**. Intently reuses it:

- `intently/src/app/api/cart/route.ts` (server) reads/writes that **same cookie** and
  calls the **same Medusa Store cart API** (`POST /store/carts` with `region_id` to
  create, `POST /store/carts/{id}/line-items` to add by `variant_id`).
- So **Add-to-cart on a discovery card lands in the storefront's cart.** Intently shows
  **no cart UI** — just an Add button and a "Cart (n)" link to the storefront cart.
- The storefront's cart fetch (`lib/data/cart.ts → retrieveCart`) is `no-store`, so an
  item added from Intently is reflected immediately (not served stale).

## Prices (fetched from the PIM, not re-derived)

Discovery cards show the **real Medusa region price**:
- `MedusaPimAdapter` fetches `*variants.calculated_price` (with `region_id`) + the
  variant id; `medusaToPim` puts them on `PimProduct.priceAmount` / `.variantId`.
- `pimProductToProduct` maps `priceAmount` → `Product.price` (cents) and carries
  `variantId`. (Standalone, non-Medusa Intently falls back to a derived price.)

> Note the field syntax: `*variants.calculated_price` populates the computed price;
> `+variants.calculated_price` does **not**.

## Session-aware navigation

- **Store → Intently:** nav "Shop by situation ✨" → `/discover`.
- **Intently → store:** a thin top bar (`EmbeddedNav`) with **"← Back to store"** (→ `/`)
  and **"Cart (n)"** (→ `/cart`), the count read live from the shared cart and updated
  on each add (via an `intently-cart-updated` event). Cross-zone links are raw `<a>`
  (not `next/link`, which would prefix the basePath).
- Because the cart cookie is shared, the basket **persists** as the shopper moves
  between discovery and the storefront.

## Key files

**Intently**
- `src/lib/embed.ts` — `EMBEDDED` / `BASE_PATH` flags, `storefrontProductUrl()`
- `next.config.js` — env-driven `basePath`/`assetPrefix`
- `src/app/api/cart/route.ts` — shared Medusa cart (GET count / POST add)
- `src/components/ui/AddToCartButton.tsx`, `EmbeddedNav.tsx`, `ProductCard.tsx` (embedded variant), `ClientShell.tsx`
- `src/hooks/useDiscover.ts` — basePath-prefixed `/api/discover`
- `src/lib/enrichment/pim-medusa.ts`, `pim-to-product.ts`; `src/types/{index,enrichment}.ts` (`variantId`, `priceAmount`)

**Storefront**
- `next.config.js` (rewrites), `src/middleware.ts` (`/discover` excluded), nav link
- `src/lib/data/cart.ts` (`no-store`), `src/lib/data/products.ts` (local image URLs), `products/[handle]/page.tsx` (image guard)
- `public/catalog/*.webp` (its own copy of the product images)

## How to run

```bash
# 1. Medusa (needs the Docker VM at ≥8 GB)
cd pim && npm run docker:up                       # :9000  (admin /app, API /store)

# 2. Storefront — the "old way"
cd storefront && npm install && npm run dev       # :8000

# 3. Intently — embedded plugin
cd intently && NEXT_PUBLIC_BASE_PATH=/discover NEXT_PUBLIC_STOREFRONT_REGION=gb npm run dev   # :3000

# open http://localhost:8000  →  "Shop by situation ✨"
```

Env: `intently/.env.local` (`PIM_SOURCE=medusa`, `MEDUSA_BACKEND_URL`,
`MEDUSA_PUBLISHABLE_KEY` from the seed logs, `DISCOVERY_RETRIEVAL=vector`);
`storefront/.env.local` (`MEDUSA_BACKEND_URL`, `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`,
`NEXT_PUBLIC_DEFAULT_REGION=gb`). The publishable key **regenerates on
`docker compose down -v`** — update both `.env.local` files and clear
`intently/.enrichment/vectors.json` (forces a re-sync) when that happens.

## Limitations / follow-ups (demo scope)

- **No checkout** — shipping/payment aren't configured; the "old way" stops at the cart.
- **next/image optimizer 400s** on basePath assets across the zone proxy → embedded
  discovery cards use a plain `<img>`.
- Standalone (non-embedded) Intently shows a *derived* price; only the embedded /
  Medusa path shows the real price.

## Verified (browser, 2026-06-04)

Storefront grid renders products + images; nav has "Shop by situation ✨". On
`/discover`: a query returns cards with real H&M images, prices, and Add buttons;
clicking **Add** updates the nav to **Cart (1)**; the storefront `/gb/cart` then shows
the same item (Cora Dress, €49.99) with its thumbnail — i.e. the discovery plugin and
the storefront share one cart.
