---
type: concept
status: stable
updated: 2026-07-18
sources: []
tags: [cloud, vercel, serverless, supabase, upstash, deployment, demo, degradation]
---

# cloud-demo-deployment

**The cloud demo is Intently standalone on Vercel — no Medusa, no storefront.** Live at `intently-red.vercel.app` (region `fra1`), behind a Basic-Auth gate. This is a *different topology* from [[deployment-topology]], which describes the local three-process stack (Medusa `:9000` + storefront `:8000` + Intently `:3017`). Both are current; they serve different jobs.

## Why standalone, not the full stack

Hosting Medusa in the cloud was **planned and then dropped on cost** (2026-07-17) — a managed Medusa + Postgres + storefront runs a monthly bill Ilmari wasn't willing to carry for a demo. The decision: put *Intently's own* capabilities in front of demo audiences and drop the commerce shell. Consequence — the cloud demo has no shared Medusa cart and no storefront wrapper; it runs the self-contained discovery surface plus the full Studio. Plan of record: `intently/docs/cloud-demo-plan.md`; the deferred Medusa work survives in `intently/docs/medusa-cloud-plan.md`.

## What swaps for the cloud

Everything file-backed locally has a cloud twin behind one flag, `INTENTLY_STORE=supabase`:

| Concern | Local (default) | Cloud |
|---|---|---|
| Runtime config, situations, overrides | JSON files in `.enrichment/` | Supabase `runtime_kv` (migration `0013`) |
| Analytics events | JSONL sink on disk | Supabase `turn/cart/order` tables (`0012`) |
| Rate-limit + LLM-budget counters | in-memory per process | Upstash Redis (`INCR` + self-expiring keys) |
| Vector store | file-backed JSON, `.enrichment/` | **still local JSON** — see residue below |

The counters matter more than they look: in-memory caps multiply by replica count (a cap of N becomes N×replicas), so a shared atomic counter is the only honest cap on serverless. Keys and their handling: [[security-key-management]].

## The serverless constraint — and the two honest answers to it

**The rule: anything that spawns a child process or writes to disk cannot run on Vercel.** Serverless functions have no process model to hand off to and a read-only filesystem. Two Studio affordances hit this:

- **Vision enrichment** (`/api/admin/vision-enrich`) — `spawn()`ed the batch script and wrote run status to `.enrichment/`. Both fail. **Since 2026-07-18 this one was rebuilt rather than degraded — see below.**
- **Enrichment sync** — writes the local vector store. Still local-only.

There are only two honest responses to the constraint, and which one is right depends on whether the capability is load-bearing for the demo:

1. **Degrade legibly** (cheap) — when the capability genuinely belongs on a laptop.
2. **Rebuild it to fit the platform** (real work) — when a demo audience needs to see it run.

### Answer 1 — degrade legibly

The first vision-enrich crash was an opaque **500** on a button press, which is the worst outcome: it reads as "broken product" to a demo audience. The pattern for every local-only affordance:

1. **The route answers `501` with a sentence a human can act on**, not a stack trace — *"Vision enrichment runs from a local checkout, not on serverless. This cloud demo ships a prebuilt cache — re-run locally, then redeploy."* Gated on `process.env.VERCEL`.
2. **The control disables itself before it can fail.** The server page passes `enrichable={!process.env.VERCEL}` to `RunEnrichmentButton`, which renders a disabled label — *"Enrichment: prebuilt cache (runs locally)"*. The user never fires the failing request.

Defense in depth on purpose: (1) alone still lets a demo viewer click a button and get an error; (2) alone breaks if a route is called directly. **Never let a cloud-unavailable capability present as a live control.** The environment check belongs in a *server* component so the flag is never shipped to the browser.

> Implementation gotcha: an `available === false` early return in a component must sit **after** every hook, or rules-of-hooks fails the build.

### Answer 2 — rebuild to fit the platform (what vision enrichment became)

Degrading was the right *first* move but the wrong *final* one: "watch the catalogue enrich itself" is the demo. So enrichment was rebuilt (2026-07-18) to run on serverless honestly. Three constraints, three decisions:

| Constraint | Decision |
|---|---|
| No child process | The batch core moved from `scripts/vision-enrich.mjs` into `src/lib/enrichment/vision/enrich.ts` and runs **in-process**. The script was **retired**, not kept — two implementations of one batch is the same divergence trap that killed scripted mode. |
| 60s function ceiling vs a ~15-minute batch | **Chunking with a server-side cursor.** Each POST analyses as much as fits a 42s budget, persists it, returns progress; the browser loops. Closing the tab *pauses* a run rather than losing it, and resume never re-bills enriched products. |
| Read-only filesystem | Output goes to Supabase `vision_records` (migration `0016`), one row per product so a chunk appends incrementally instead of rewriting a ~500KB document every 60 seconds. The aggregate report is **derived on read**, so it cannot drift from the records. |

**The non-obvious trap: `public/` is not in the function bundle.** The batch reads product photos at a path built at runtime (`public/<image>`), which Next's tracing cannot statically see — so the read works locally and `ENOENT`s in production *only*. `outputFileTracingIncludes` in `next.config.js` declares the webp bank explicitly. Any future runtime file read needs the same treatment.

Verified live on 2026-07-18: 10/10 products enriched in 26s from the deployed function, rows landed in Supabase, reset cleared them, re-run repopulated.

**What a cloud run does *not* regenerate:** the committed `vision-catalog.json` and the vector index are still build-time artifacts, so a cloud re-run repopulates the *enrichment surfaces* without changing what shopper-facing discovery returns. Closing that loop needs pgvector + re-index (step #4). Operator guide: `intently/docs/running-enrichment.md`.

## Resetting the demo — tiered, because undo costs differ

"Clear everything" would be a footgun: on cloud, wiping enrichment used to mean the demo could never recover. `/api/admin/reset` is therefore **tiered by cost-to-undo**, nothing preselected, behind a typed `RESET` token (a misclick guard, not security — the admin guard is that):

- **PM tuning** — situations, config, curated attributes, attention queue. Reverts to shipped defaults; cheap.
- **Vision enrichment output** — undo means re-running the batch (~15 min, real spend).
- **Analytics history** — unrecoverable. Opt-in only.

Partial failure is reported per-tier rather than swallowed: a reset that half-worked is worse to discover mid-demo than one that says so.

## Verifying cloud UI without leaking the gate password

The Studio sits behind Basic-Auth (`proxy.ts`), and an agent driving a browser against it would put that password in the transcript and tool history. That is a worse trade than skipping the check, so the verification splits by *where the difference actually lives*:

- **UI layout / interaction** → verify on **localhost**. The rendered Studio is the same code; only env-gated behaviour differs.
- **Cloud-only behaviour** → verify with an **unauthenticated API probe** (`POST /api/admin/vision-enrich` → 501 needs no login).
- **Cloud-only visual state** → a human opens a **preview deployment** in their own browser.

Corollary: prefer a scoped, disposable admin token over the gate password if an authenticated cloud probe is ever genuinely unavoidable. See [[security-key-management]].

## Studio pipeline navigation (2026-07-18)

The Studio nav lost its **pipeline row** (Cockpit · Catalogue · Enrichment · Situations · Needs attention). It duplicated the `PipelineStatus` **stage stepper** (PIM → Enrich → Index → Situations → Discovery) that renders on every Studio page and links to the same surfaces, in a *different order* — two orderings of one pipeline is worse than one. The nav keeps only **Studio · Analytics** plus a **Tools** row (Models · Configuration), since those aren't pipeline stages. Needs-attention stays reachable from the Cockpit's catalogue-health link. Principle: **the pipeline navigates in pipeline order, once.**

## Known residue

The vector store is still local JSON in the cloud build, so the Enrichment and Catalogue Studio pages read a **prebuilt committed cache** rather than live vectors. Closing it is two tracked steps in `cloud-demo-plan.md`: (#4) vector store → Supabase pgvector + OpenAI embedder + a one-time re-sync, and (#5) ship the vision cache as a committed fixture. Non-blocking for the demo — discovery itself runs live.

## Related

- [[deployment-topology]] — the *local* three-process topology (Medusa + storefront + Intently); this page is its cloud counterpart
- [[security-key-management]] — the secrets contract every cloud key follows
- [[analytics]] — the event stream whose Supabase tables land here
- [[vision-enrichment]] — the batch that cannot run on serverless
- [[enrichment-studio]] — the workspace whose nav and controls this page changes
