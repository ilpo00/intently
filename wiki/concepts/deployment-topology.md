---
type: concept
status: stable
updated: 2026-06-12
sources: []
tags: [topology, endpoints, multi-zones, storefront, admin, cleanup]
---

# deployment-topology

> **Scope: this page describes the LOCAL topology** (Medusa + storefront + Intently, three processes). The **cloud demo is a different shape** — Intently standalone on Vercel, no Medusa, no storefront: see [[cloud-demo-deployment]].

**The Intently app has exactly two faces, served on one port; the Medusa storefront is the only customer-facing entry.** Established 2026-06-12 (the "streamline the landscape" cleanup): the standalone single-page "river" was retired so there is no longer a separate Intently surface on its own endpoint.

## The three URLs

| URL | What | Served by |
|---|---|---|
| `localhost:8000` | **The store** — browse / filter / cart / checkout. The customer entry point. | Medusa **storefront** (Next.js) |
| `localhost:8000/discovery` | **Shop by situation** — the Intently discovery plugin, one domain with the store, shared cart. | storefront **proxies** → Intently `:3017/discovery` |
| `localhost:3017/discovery/admin` | **The Studio** — catalogue management, situation tuner, vision, the PM action loop. Ops-facing, reached directly (not through the store). | Intently app, direct |

Medusa backend (the PIM) runs on `:9000`. One canonical launcher: `intently/scripts/run-demo.sh` (Medusa `:9000` + storefront `:8000` + Intently `:3017`). It boots the stack with the **tiered AI on** (`DISCOVERY_PARSER=DISCOVERY_GENERATION=deepseek`), refreshes deps + clears `.next` + re-seeds the vector store every run (so you always run the latest source), and warns if `DEEPSEEK_API_KEY` is missing. The earlier two-script split (a standalone `run-demo.sh` over `:3017/next` + a separate `run-plugin-demo.sh`) was retired 2026-06-15 — the standalone "own endpoint" surface is gone; there is one launcher and one topology.

**Catalogue: rich discovery + a working shared cart.** The plugin runs `PIM_SOURCE=medusa` (so discovery products map to real storefront variants → one shared cart) *and* `NEXT_PUBLIC_CATALOG=vision` (so discovery reasons + renders over the vision-enriched attributes). The two are reconciled by **article number**: the vision catalogue keys by `cat-<n>`, the Medusa seed by `k<n>`, but both share the H&M article number `<n>`. `getProductByArticleNo` ([src/lib/data.ts](intently/src/lib/data.ts)) maps a Medusa vector hit back to the rich vision product; `retrieve.ts` then overlays only the Medusa **commerce** fields (variant id + exact region price) so add-to-cart + pricing survive. Without the vision flag (bare `npm run dev`) the bridge is dormant and behaviour is unchanged. Decided 2026-06-15 — fixes the prior tradeoff where the storefront topology meant a thinner (Medusa-only) discovery catalogue.

## How the bolt-in works (Next Multi-Zones)

The Intently app runs with `NEXT_PUBLIC_BASE_PATH=/discovery`, so **every** route is prefixed `/discovery` and its assets namespace under `/discovery/_next`. The storefront `rewrites()` ([storefront/next.config.js](storefront/next.config.js)) proxy `/discovery` and `/discovery/:path*` → `http://localhost:3017/discovery/...`; the asset namespacing is what lets that proxy forward the plugin's JS/CSS without colliding with the storefront's own `/_next`. The storefront middleware excludes `discovery` from its region (country-code) redirects so the rewrite isn't hijacked.

**Why admin sits under `/discovery/admin`, not bare `/admin`:** Next's `basePath` is global — it prefixes *every* route in the app, admin included. The discovery plugin *requires* the basePath for the proxy to work, so admin inherits the `/discovery` prefix. Decided 2026-06-12 (the conventional, robust multi-zones shape) over a basePath-less variant that would have given bare `:3017/admin` at the cost of an off-convention absolute `assetPrefix`.

Cross-zone seams the rename touched: the storefront nav link (`/discovery`), the middleware matcher, and the image-URL strippers in `storefront/src/lib/data/{products,cart}.ts` (they map Medusa-stored Intently-origin thumbnails to the storefront's own `/catalog`; the regex now alternates `:3000|:3017` and `/discover|/discovery` to also strip legacy-seeded URLs).

## What was retired (the cleanup)

- **The standalone "river"** — `page.tsx` rendered Entry → Conversation → StyleGrid → Discovery → Checkout sections when run without a basePath (the old `:3000` surface). `page.tsx` now always renders `NextExperience` (the self-contained discovery surface: its own header, cart, thread, results canvas — shared Medusa cart when embedded, a local demo cart standalone). The five section components plus their orphaned overlays (CartButton, CartDrawer, SessionReset, ProductCard, ProductSkeleton, AddToCartButton) were first moved to `src/_parked/`, then deleted with that whole tree in the 2026-06-15 pivot cleanup (recoverable from git history). `ClientShell` shrank to just the embedded back-to-store nav.
- **Port/path:** the plugin moved `:3000 → :3017` and `/discover → /discovery` everywhere (run script, storefront proxy/middleware/strippers/nav).
- **MISE references** were swept from the live `src` (comments neutralised). Remaining mentions are intentional: the `mise-tiered-ai` skill name, the cooking term "mise-en-place" in the roadmap, and `docs/mise_to_intently_migration.md` (the history record). The cooking-era content still in `docs/roadmap.md` is a separate stale-doc cleanup, not a code reference.

## Related

- [[tiered-conversation]] — the LLM conversation layer that runs inside the discovery plugin, with its guardrails.
- [[next-overlay-ux]] — the design of `NextExperience` (the surface that is now the *only* discovery face).
- [[enrichment-studio]] — what lives under `/discovery/admin`.
- `intently/scripts/run-demo.sh` — the one launcher for the full topology.
