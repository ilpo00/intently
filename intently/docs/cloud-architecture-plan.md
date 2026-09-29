# ADR-012: Cloud implementation plan — from local-first to multi-replica

**Status:** Proposed · **Date:** 2026-07-16 · **Deciders:** Ilmari
**Note 2026-07-17:** the near-term deployment is the zero-fixed-cost standalone demo
(`cloud-demo-plan.md`) — it implements C1/C2's store swaps on free tiers and defers Medusa
hosting. This ADR remains the long-run target the demo plan is a subset of.
**Scope:** what must change for the current system to run correctly on cloud infrastructure
(Vercel `fra1` + Supabase, per the existing deploy story), and in what order.

---

## Context — honest review of the work so far

The Phase-1 architecture is deliberately local-first: every stateful concern lives in process
memory or gitignored files under `.enrichment/`. That was the right call for demo velocity — and
each store was built behind a seam so the swap is contained. The inventory of what breaks on
cloud (multi-replica serverless, read-only filesystem):

| Concern | Today (local) | Breaks on cloud because | Seam quality |
|---|---|---|---|
| Analytics events | JSONL append (`events.ts`) | read-only FS; per-replica files diverge | ✅ EventSink seam; migration **0012 written** |
| Runtime config (models, limits) | `.enrichment/runtime-config.json` | writes lost per replica; drift between replicas | ✅ read-per-request already; needs a table |
| Situations (custom / overrides / active) | 3 JSON files | same | ✅ same read/write pattern, one table swap |
| Rate limit + LLM daily budget | in-memory Maps (`guardrails.ts`) | each replica has its own counter → cap × N replicas | ⚠ header comment admits it; needs shared store |
| Vector store | `vector-store-local.ts` (file) | read-only FS; per-replica indexes | ✅ factory seam; **pgvector migration 0010 ready** |
| Embedder | Xenova/onnx in-process | native binary won't run on Vercel serverless | ✅ `OpenAIEmbedder` exists (`ENRICHMENT_EMBEDDER=openai`) |
| Vision enrichment runner | `spawn(node script)` from a route | no long-lived child processes on serverless; status file on read-only FS | ⚠ built for local; needs a job pattern |
| Vision cache | `.enrichment/vision-*.json` | read-only FS | ⚠ needs blob/table |
| Admin auth | permissive stub (`admin-guard.ts`) + Basic-Auth at the proxy | stub is fine ONLY behind the proxy; any direct route exposure is open | ⚠ deliberate, documented; must harden |
| Site privacy | Basic-Auth at the proxy over `/:path*` | shared password, no throttling, non-constant-time compare | ✅ whole deployment gated 2026-07-27 (`SITE_BASIC_AUTH_PASSWORD`); residue in `prodprep.md` |
| Session state (shopper) | client-held `SessionContext` round-tripped per request | ✅ stateless by design — cloud-ready as-is | ✅ |
| Discovery engine | pure functions over in-memory catalogue | ✅ stateless — cloud-ready as-is | ✅ |

**The good news the review surfaced:** the request path itself (engine, prefilter, situations
scoring, LLM clients with null-fallbacks, per-request config reads) is already stateless and
replica-safe. Cloud work is almost entirely *moving the stores*, not redesigning the system.

## Decision

Adopt a three-tier target: **Vercel** (compute, `fra1`) + **Supabase** (Postgres: config,
situations, events, pgvector) + **Upstash Redis** (counters: rate limit, LLM budget), migrated in
the phases below — each phase shippable alone, each store swapped behind its existing seam.

## Target architecture

```
                         ┌─ Vercel (fra1, N replicas) ─────────────┐
 shopper ── /discovery ──▶ next app: engine (pure) + LLM clients   │
 PM ────── /admin ───────▶ Studio + Analytics (server components)  │
                         └───┬───────────┬──────────────┬──────────┘
                             │           │              │
                   Upstash Redis     Supabase        Provider APIs
                   rate-limit ctr    postgres:       (openai/deepseek/
                   llm-budget ctr    · runtime_config anthropic)
                   (atomic INCR,     · situations_*   
                    TTL per day)     · analytics_*  (0012)
                                     · vectors (pgvector, 0010)
                                     · vision_enrichment
                                     storage: product images
                             │
                   Vision job: Vercel Cron (or QStash) → batch route with
                   `maxDuration`, writing status+results to Supabase —
                   replaces spawn(); same script logic, invoked as a module
```

## Phased plan

**Phase C1 — correctness under replicas (must precede any real traffic)**
1. Rate limit + LLM budget → Upstash Redis (`INCR` + daily-key TTL). The only *silent-corruption*
   risk in the table: today's cap is effectively `cap × replicas`.
2. Runtime config + situations (custom/overrides/active) → one `runtime_kv` table (key/JSON/updated_at)
   or three narrow tables. Keep the local-file impl behind an env switch for dev (`STORE=local`).
3. Harden admin: enforce the Basic-Auth proxy in front of ALL `/admin` + `/api/admin/*` +
   mutating enrichment routes; replace the guard stub's always-allow with a shared-secret check so
   direct route access fails even if proxy config regresses.
   *(Proxy half done 2026-07-27 — the matcher is now `/:path*`, so `/api/admin/*` is covered and the
   whole deployment can be made private with `SITE_BASIC_AUTH_PASSWORD`. The guard-stub half — a
   defence-in-depth check inside the routes themselves — is still open.)*

**Phase C2 — durable analytics + vectors**
4. Apply migrations 0010 (pgvector) + 0012 (analytics); flip `ENRICHMENT_STORE=supabase`; add the
   Supabase EventSink impl (emit sites unchanged); analytics page reads via SQL aggregates instead
   of a file scan (the `aggregate.ts` shapes become one query each).
5. Embedder default → `openai` on cloud (`text-embedding-3-small@384` fits the same schema);
   xenova stays the local-dev default. **One-time full re-sync required** (stored + query vectors
   must come from the same embedder — documented constraint).

**Phase C3 — jobs, not processes**
6. Vision enrichment: extract the script's core into an importable module; run via Vercel Cron /
   QStash-triggered route with `maxDuration: 300`, chunked (N products per invocation, cursor in
   Supabase); status table replaces the status file — the Studio's Run button and log tail keep
   working, pointed at the table.
7. PIM sync webhook (brainstorm #2) naturally lands here — same job pattern.

**Phase C4 — observability & cost safety**
8. Provider-console spend caps (the only hard backstop) + a budget alert when Redis daily count
   crosses 80% of cap; surface replica-aware counters in the Configuration page.
9. Structured request logging (the `log.ts` seam) → Vercel drains; keep events as the product
   analytics, logs as ops.

## Trade-offs & alternatives considered

- **Upstash vs Postgres for counters:** a Postgres `UPDATE … RETURNING` would avoid a second
  service, but a per-request hot counter on Postgres is the wrong tool (connection pressure,
  latency on every turn). Redis INCR is O(1) and idiomatic. *Chosen: Upstash.*
- **One `runtime_kv` JSON table vs typed tables:** typed tables give SQL-queryable situations, but
  the tuner always reads/writes whole documents; KV keeps the local/cloud impls symmetric and the
  swap trivial. *Chosen: KV now, typed later if querying emerges.*
- **Rewrite vision runner on a worker platform (Trigger.dev etc.):** more robust, but a third
  vendor for one batch job at this scale is overkill; Vercel Cron + chunking suffices. *Revisit at
  1k+ products.*
- **Keep JSONL events + periodic upload:** rejected — two sources of truth and a lossy window;
  the sink seam makes the direct swap equally cheap.

## Consequences

- **Easier:** multi-replica correctness, real deploys from `main`, analytics survive deploys,
  PM edits shared across replicas instantly.
- **Harder:** two more provisioned services (Supabase already exists; Upstash is new); local dev
  must keep working keyless — every store keeps its `local` impl and CI stays on it.
- **Revisit later:** typed situation tables, learned emphasis (needs C2 data), online A/B
  (brainstorm #5 — trivially enabled by C1's shared config), per-tenant isolation if Intently
  becomes multi-store SaaS (schema-per-tenant vs RLS — a future ADR).

## Action items

1. [ ] Provision Upstash; `guardrails.ts` gets a Redis impl behind `GUARDRAILS_STORE=redis` (C1)
2. [ ] `runtime_kv` migration + store swap for config/situations (C1)
3. [~] Admin hardening: proxy enforcement ✅ 2026-07-27 (gate widened to `/:path*`, two-password scheme); guard secret still open (C1)
4. [ ] Apply 0010 + 0012; Supabase EventSink; SQL aggregates (C2)
5. [ ] Embedder flip + full re-sync runbook (C2)
6. [ ] Vision job: module extraction + cron route + status table (C3)
7. [ ] Budget alerting + spend caps in provider consoles (C4)
