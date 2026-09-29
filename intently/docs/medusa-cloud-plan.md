# Medusa on the cloud — preparation plan

**Date:** 2026-07-16 · **Status:** DEFERRED 2026-07-17 — the monthly hosting cost isn't
justified for the demo phase. The cloud demo runs Intently standalone (see
`cloud-demo-plan.md`, the plan of record); this document stays ready for the day a real
storefront customer needs the shared-cart/webhook integration live.
**Scope:** take the existing `pim/` (Medusa 2.4, Dockerized, currently a local PIM mock) to a
hosted deployment that the cloud Intently app and the storefront can share — including the
order webhook that closes the analytics commerce loop.

---

## Where to host — recommendation

**Recommendation: Railway (eu-west), with Medusa Cloud as the graduation path.**

| Option | Fit | Why / why not |
|---|---|---|
| **Railway** ✅ | demo→pilot | The existing `pim/Dockerfile` deploys as-is; managed Postgres + Redis in the same project (one click, private networking); eu-west region pairs with Vercel `fra1` and Supabase `eu-central-1`; ~$10–20/mo at demo traffic; logs/rollbacks good enough. The least new-concepts path from today's docker-compose. |
| **Medusa Cloud** (official) | production ops | Managed by the Medusa team (upgrades, workers, event bus handled). More $$; less control over the container; adopt when a real customer runs on it and ops burden matters more than flexibility. |
| Fly.io | alternative to Railway | Fine too (fra region literally in Frankfurt); more moving parts (volumes, machines API) for no demo-scale gain. |
| Supabase-hosted Postgres for Medusa | ❌ | Technically possible, architecturally wrong: Medusa owns dozens of migration-churning tables; mixing them into Intently's Supabase project couples two lifecycles and pollutes the analytics/vector schema. Keep domains separate. |

**Redis note:** Medusa v2 requires Redis (event bus, workflows) over a **TCP connection** —
that's Railway's bundled Redis, colocated. This is deliberately **separate** from Intently's
Upstash: Upstash-REST serves Intently's serverless per-request counters (stateless HTTP, no
pooling); Medusa is a long-lived Node process where a normal TCP Redis is simpler and faster.
Two Redis roles, two right answers — don't merge them.

## Preparation steps (in order)

**1. Container readiness (repo work — done/verify)**
- `pim/Dockerfile` exists; confirm it runs `medusa migrations run && medusa start` on boot
  (or split: a release phase for migrations, per Railway best practice).
- Externalize every secret already read by `medusa-config.ts` into env (no compose-only values):
  `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `COOKIE_SECRET`, `STORE_CORS`, `ADMIN_CORS`, `AUTH_CORS`.

**2. Railway project layout**
- One project, three services: `medusa` (from `pim/` Dockerfile), `postgres` (plugin),
  `redis` (plugin). Private networking between them; only `medusa` gets a public domain.
- Region: eu-west. Health check on `/health`.

**3. Data + assets**
- Seed: run the existing `setup.sh` seed path once against the Railway DB (products +
  publishable key). Export the printed **publishable key** → Vercel env `MEDUSA_PUBLISHABLE_KEY`.
- Product images: local files won't survive container redeploys → S3-compatible storage.
  Use **Supabase Storage's S3 endpoint** (already in the stack, eu-central) with Medusa's
  `@medusajs/file-s3` provider — no new vendor.

**4. Wire Intently → Medusa (cloud)**
- Vercel env: `MEDUSA_BACKEND_URL=https://<railway-domain>`, `MEDUSA_PUBLISHABLE_KEY=pk_…`,
  `PIM_SOURCE=medusa`.
- CORS: add the Vercel domains to `STORE_CORS`.
- The shared-cart cookie flow (`/api/cart`) works unchanged — it proxies server-side.

**5. Wire Medusa → Intently (the order webhook — closes the commerce loop)**
- Medusa v2 subscriber on `order.placed` (a ~20-line subscriber in `pim/src/subscribers/`)
  that POSTs to `https://<intently>/api/analytics/order` with header
  `x-intently-webhook-secret: $INTENTLY_WEBHOOK_SECRET` and body
  `{ orderId, totalUsd, items: [{productId, title, quantity, unitUsd}], sessionId? }`.
- `sessionId` attribution: the storefront sets cart metadata `intently_session_id` when the
  cart was touched by Intently; the subscriber forwards it if present. Without it, the order
  still lands (unattributed) — item-level product match remains the fallback signal.
- Intently side is **already built** (`/api/analytics/order`, migration 0014 applied).
- Env on both sides: `INTENTLY_WEBHOOK_SECRET` (generate once, set in Railway + Vercel).

**6. Smoke checklist**
- [ ] `GET /health` 200 on Railway domain
- [ ] Storefront lists products via the publishable key
- [ ] Intently `PIM_SOURCE=medusa` sync pulls the catalogue (Studio pipeline PIM stage shows it)
- [ ] Test order in Medusa admin → order event appears in Intently analytics funnel
- [ ] Images load from Supabase Storage after a forced redeploy

## What Ilmari needs to create (accounts/keys)
1. Railway account + project (or Medusa Cloud, if chosen) — then I take over service config.
2. Upstash account → one Redis DB (eu) → paste `UPSTASH_REDIS_REST_URL` + `_TOKEN` into
   Vercel/`.env.local` (Intently's counters — code already shipped, activates on env presence).
3. Generate `INTENTLY_WEBHOOK_SECRET` (any long random string) → Railway + Vercel.
4. Supabase Storage: create a public `product-images` bucket + S3 access keys for Medusa.
