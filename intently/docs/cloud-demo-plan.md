# Cloud demo plan — Intently standalone, zero fixed cost

**Date:** 2026-07-17 · **Status:** the plan of record for the cloud deployment
**Supersedes:** the Medusa-hosting parts of `medusa-cloud-plan.md` (deferred — monthly cost not
justified for the demo phase) and narrows `cloud-architecture-plan.md` (ADR-012) to what the
**wow demo** needs. ADR-012 remains the long-run architecture.

---

## The decision

Put **Intently itself** on the cloud, fully functional, with **no Medusa dependency** and no
fixed monthly spend. Everything a demo receiver touches — situational discovery, the tailor
conversation, the Studio (pipeline, situations, model bench, configuration), and live analytics —
works standalone. Commerce integration stays *demonstrable* (webhook built + seeded orders in
analytics) without a running storefront.

**Cost profile:**

| Service | Tier | Monthly |
|---|---|---|
| Vercel (fra1) | Hobby | $0 |
| Supabase (intently-demo, eu-central) | Free (migrations 0010–0014 already applied) | $0 |
| Upstash Redis | Free (10k commands/day ≫ demo traffic) | $0 |
| LLM usage | pay-per-token (gpt-5.4-nano ≈ $0.0006/escalated turn; daily cap enforced) | ~pennies |

## What changes vs. the Medusa-era assumptions

| Concern | With Medusa | Standalone demo |
|---|---|---|
| Product source | `PIM_SOURCE=medusa` | `PIM_SOURCE=catalog` (the committed 292-photo vision catalogue) — already the default |
| Cart | shared Medusa cart via `/api/cart` | NextExperience's standalone cart (already built — the non-embedded path) |
| Orders / funnel | `order.placed` webhook | webhook stays built + tested; demo funnel runs on the labeled seeded orders. Optional wow: a "simulate order" admin action (see backlog) |
| Product images | Supabase Storage S3 for Medusa | vision catalogue images ship with the app — nothing to do |

## The real work: cloud-proofing the stateful features (the wow depends on it)

Vercel's filesystem is read-only per invocation — every `.enrichment/*` file store silently
stops persisting there. **These swaps are what makes the demo genuinely live rather than a
static screenshot.** The tables already exist (applied 2026-07-16); this is the store-swap work,
each behind its existing seam, local files staying the dev default:

| # | Swap | Seam | Cloud target | Status |
|---|---|---|---|---|
| 1 | Analytics events | `EventSink` (`events.ts`) | `analytics_*` tables (0012/0014/0015) | ✅ **DONE** 2026-07-17 — verified round-trip |
| 2 | Runtime config + experiment | `doc-store.ts` (`runtime-config` key) | `runtime_kv` (0013) | ✅ **DONE** — PM edits persist on cloud |
| 3 | Situations (custom/overrides/active) | `doc-store.ts` (3 keys) | `runtime_kv` (0013) | ✅ **DONE** — the "create a situation, it sticks" wow |
| 6 | Guardrail counters | `guardrails-shared.ts` | Upstash | ✅ **DONE** — verified live (PONG + INCR) |
| 4 | Vector store + embedder | factories (`ENRICHMENT_STORE` / `ENRICHMENT_EMBEDDER`) | `supabase` + `openai` (0010; xenova's native binary can't run on Vercel) | ⏳ remaining — needs a one-time re-sync after flipping |
| 5 | Vision cache | `.enrichment/vision-*.json` readers | commit a `demo-fixtures/` copy read as fallback | ⏳ remaining — else Enrichment/Catalogue say "not run" on stage |

**All swaps are behind `INTENTLY_STORE=supabase`** — unset (dev/CI) keeps the local files, so
nothing changed for local work. Every cloud read falls back to the local file on a Supabase error;
every write is fail-soft. The four doc stores + the analytics read path are now async.

Deliberately **not** needed for the demo: the vision batch *runner* on cloud (enrich locally,
ship the cache — the Run button stays a local/Studio capability until ADR-012 C3), auth beyond
the Basic-Auth proxy, and any queue infrastructure.

**Update 2026-07-27 — the demo is now private end to end.** The proxy gate was widened from
`/admin/*` to `/:path*`, so the shopper river, `/api/discover` and every static asset need a
password too. Two independent variables: `SITE_BASIC_AUTH_PASSWORD` (everything) and
`ADMIN_BASIC_AUTH_PASSWORD` (admin only), so the password you hand a prospect does not also open
the Studio. Only `POST /api/analytics/order` stays reachable — it carries
`INTENTLY_WEBHOOK_SECRET` and a webhook caller cannot answer a Basic challenge.

## Demo-mode posture (honesty by design)

- Seeded analytics stay, **labeled** (the page already marks "local events"; keep the seed's
  `demo-` session prefix so real traffic is distinguishable).
- The funnel's Purchased step runs on seeded webhook-shaped orders — exactly the payload a real
  storefront would send, which *is* the pitch ("this is one subscriber away from your store").
- LLM defaults for the demo: `DISCOVERY_PARSER=openai`, `DISCOVERY_GENERATION=openai`
  (gpt-5.4-nano), daily cap low (e.g. 500), Upstash counters on.

## Execution order (each step shippable, local behavior unchanged)

1. **Supabase store layer** — one small `supabase-rest.ts` helper (service-role, raw fetch), then
   swaps #1–#3 behind `INTENTLY_STORE=supabase` (unset = local files, CI untouched).
2. **Vision cache shipping** (#5) + embedder/vector flip (#4) + a re-sync runbook step.
3. **Vercel project env**: the table below; deploy; smoke the Studio + a discovery turn.
4. **Wow-polish backlog** (post-deploy, optional): "simulate order" button on the analytics page
   (fires the real webhook path with the secret), a `?demo=reset` seed refresher.

**Vercel env checklist:** `PIM_SOURCE=catalog` · `NEXT_PUBLIC_CATALOG=vision` ·
`INTENTLY_STORE=supabase` · `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` ·
`ENRICHMENT_STORE=supabase` · `ENRICHMENT_EMBEDDER=openai` · `OPENAI_API_KEY` ·
`DISCOVERY_PARSER/GENERATION=openai` · `UPSTASH_REDIS_REST_URL/TOKEN` ·
`INTENTLY_WEBHOOK_SECRET` · `SITE_BASIC_AUTH_PASSWORD` · `ADMIN_BASIC_AUTH_PASSWORD` · `LOG_FILE_ENABLED=false`

## What Ilmari provides (all free-tier signups)
1. Upstash account → Redis DB (eu) → two REST env values.
2. Supabase service-role key for the Vercel project (from intently-demo settings — never client-side).
3. `INTENTLY_WEBHOOK_SECRET` + `SITE_BASIC_AUTH_PASSWORD` + `ADMIN_BASIC_AUTH_PASSWORD` values.
