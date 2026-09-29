---
type: index
updated: 2026-06-16
---

# Intently wiki — index

Read this first when answering a query. Find the page whose summary matches; drill into it; only re-read source if the wiki page sends you there.

**This index is organised by customer experience** — first what the shopper meets, then what makes it possible, then what the business user controls. Pages describing the *retired MISE "river"* and *parked Phase-2 layers* are quarantined under **Historical** at the bottom; they preserve rationale but do **not** describe today's system.

Schema and workflows: [[AGENTS]]. Chronological history: [[log]].

## ★ Start here

- [[customer-experience]] — **the map.** Every live component explained in the order a person meets it (shopper, then business user) with *why each layer must exist*. Read this first.
- [[value-proposition]] — what Intently is worth + what the AI costs to run + a worked ROI (top-line uplift + returns reduction) for a mid-size fashion retailer.
- [[use-cases-personas]] — who uses it, by role (shopper profiles + product manager / merchandiser / e-commerce / returns / buyer / data lead), and the surface each one touches.

## What the shopper experiences

- [[next-overlay-ux]] — the discovery surface (`/discovery`): invitation → understood chips → explained shortlist → in-place re-rank → handoff. Self-contained header/cart/thread/canvas. `intently/src/app/next/`.
- [[landing-living-preview]] — the redesigned pre-search **landing** (Concept B, 2026-06-16): editorial invitation + a dimmed, cross-fading *example of the payoff* in place of the empty canvas. `NextExperience.tsx` (`Landing`/`LivingPreview`); mockups saved at `wiki/assets/landing-mockups/`.
- [[tiered-conversation]] — the LLM-driven conversation: **Tier-1 comprehension** (free text → validated context, regex fail-safe) + **Tier-1 generation** (re-voice the prose, deterministic faithfulness gate + template fallback). **The engine decides; the LLM phrases.** Flags `DISCOVERY_PARSER`/`DISCOVERY_GENERATION`; `src/lib/discovery/{parse-llm,parse-context,generate-llm,llm-client,vocabulary}.ts`.
- [[tailor-consultation]] — ask-before-offer (≤2 info-gain-gated questions), A/B options that converge with typed text, the honesty beat for absent garments, and **outfit completion** ("complete the look" rails — never pushy, cart-aware). `src/lib/discovery/{consult,voice,attributes,companions}.ts`.
- [[blind-tailor-consultation]] — the **audience + build questions with visual sketch tiles** (2026-07-06): vague brief → "who will be wearing it?" → "how should the cut sit?" → confident reveal. Fit-language labels on person-sketches; 'for him' hard-excludes womenswear categories (requested garment overrides); build biases via `silhouette`, never excludes.

## What makes it possible (under the hood)

- [[enrichment-layer]] — rich context on top of standard PIM data, made semantically searchable: PIM → buildEmbedText → embedder (Xenova MiniLM, 384-dim, no key) → vector store (LocalJSON/pgvector) → search. The seam discovery can't work without. `src/lib/enrichment/`.
- [[vision-enrichment]] — Claude Haiku reads each product photo → colour/pattern/materials/silhouette/**occasions**/styleArchetypes + **discoveryQueries**, behind a deterministic validator; cached offline batch. ~930 tok (~$0.0018)/product. This is where the shortlist's richness comes from.
- [[situation-match]] — soft, world-knowledge model of how people dress for an occasion: a per-dimension weighted scorer that **biases** ranking but never hard-excludes. Editable profiles (data, not rules), behind `DISCOVERY_SITUATION`. `src/lib/discovery/situation-match.ts`.
- [[persistence-restores-data]] — codebase invariant: hydration restores DATA, never navigates (gate auto-advance on a session interaction flag, not on persisted data). The live instance is the style slice's `hasInteractedWithStyle`.
- [[intently-store]] — the single Zustand store; every section reads/writes here. `src/store/intently-store.ts`.

## What the business user experiences (the Studio)

- [[enrichment-studio]] — the merchandiser workspace (`/discovery/admin`): pipeline ribbon + catalogue-health, per-product raw→enriched→embedText→vector, quality score, discovery preview, embed-text what-if, **mode-aware provenance** (photo-read vs text-derived), the **Curate attributes** editor, and the needs-attention queue.
- [[product-overrides]] — the **PM action loop**: curate an attribute → re-embed → see discovery change, plus the persistent needs-attention work queue (Fix/Resolve/Dismiss). Non-destructive runtime overlays merged at every read seam, reaching live `/api/discover`. `src/lib/enrichment/{product-overrides,attention-state}.ts`.
- [[analytics]] — the analytics surface (`/admin/analytics`, 2026-07-16): TurnEvent/CartEvent stream → local JSONL sink → three lenses (commerce funnel + exit points, conversation/LLM health, budget + burn projection). Every metric self-documented (what/how/why). `src/lib/analytics/`; migrations `0012`/`0013` applied — the cloud build writes events to Supabase ([[cloud-demo-deployment]]).

## Security

- [[security-key-management]] — **the secrets contract**: every key server-side + env-supplied, never in the repo; why `NEXT_PUBLIC_` must never touch a service-role/LLM key; `server-only` as the second line of defence; RLS-on as blast-radius limiting; per-environment key locations (zshenv → .env.local → Vercel env); rotation + incident response.

## How it's deployed

- [[cloud-demo-deployment]] — **the cloud demo** (`intently-red.vercel.app`, 2026-07-18): Intently standalone on Vercel (Medusa dropped on cost), the `INTENTLY_STORE=supabase` swap + Upstash counters, the **serverless constraint** (no child process, no disk writes) and the two honest answers to it — degrade legibly, or rebuild to fit (chunked resumable enrichment, verified live); the tiered reset; how to verify cloud UI without leaking the gate password.
- [[deployment-topology]] — the **local** endpoint landscape: store `:8000` → discovery `:8000/discovery` (Multi-Zones proxy → `:3017/discovery`) → Studio `:3017/discovery/admin`. One launcher `run-demo.sh` (tiered AI on, self-wiring, fresh build), the vision↔Medusa article-number bridge, `/admin`→Studio redirect.
- [[demo-solution-overview]] — the end-to-end demo for a customer pitch: vision catalogue + semantic discovery + the Studio. Charts, screenshots, a 5-minute walkthrough, the runbook.

## Decisions (ADRs)

- [[dependency-pinning]] — `next`/`react`/`react-dom` + react `@types/*` pinned exactly. CVE patches + `@testing-library/react` peer-dep stability.
- [[pim-strategy]] — products → Medusa (no Intently product editor); read-only PIM viewer carries visibility. (Recipe half is MISE-era — historical.)
- [[supabase-over-medusa]] — Supabase chosen as the account backbone; Medusa deferred. *(Phase-2; accounts parked.)*
- [[supabase-auth-over-clerk]] — magic-link auth locked in; RLS on for user-scoped tables. *(Phase-2; parked.)*
- [[rivers-spike-rejected]] — multi-river/branches spike rolled back. *(MISE-era; retained for rationale.)*
- [[private-demo-two-passwords]] — the cloud demo went **private end to end** 2026-07-27: `proxy.ts` gates `/:path*` behind `SITE_BASIC_AUTH_PASSWORD` + `ADMIN_BASIC_AUTH_PASSWORD`, so the demo credential doesn't open the Studio. The non-obvious rule (*what activates a gate ≠ what opens it*), the order-webhook exemption, and the `vercel deploy`-from-the-wrong-directory trap.

## Sources

- [[claude-md]] — root project guidance for Claude Code: layout, commands, architecture, conventions, dependency pins, env vars, DeepSeek delegation rules.

## Meta / process

- [[agent-skill-system]] — Claude skills as the structural enforcement layer for hard rules. (Skill names are `mise-*`; the *mechanism* is current, the river-specific skills are historical.)

---

## Historical / superseded

> **These pages describe the pre-pivot MISE "river" or deferred Phase-2 (accounts/chat) subsystems.** They are kept for rationale and history. They do **not** describe the system a customer meets today — see [[customer-experience]] for what's live. Do not re-introduce the code they reference — it was removed with `src/_parked/` in the 2026-06-15 pivot cleanup and is recoverable from git history (see CLAUDE.md § Phase-1 stance).

- [[river-architecture]] — RETIRED. The single-page scrolling river; `page.tsx` now renders `NextExperience` ([[next-overlay-ux]]).
- [[tiered-ai-architecture]] — SUPERSEDED by [[tiered-conversation]]. The old `/api/chat` DeepSeek+Claude design (`localhost:3000`).
- [[deterministic-ranker]] — SUPERSEDED. The MISE recipe/dish ranker (`dishMatch`); today's ranking is `prefilter.ts` + [[situation-match]].
- [[ai-mode-toggle]] — REMOVED 2026-07-15. `NEXT_PUBLIC_AI_MODE` is gone; discovery is live-only (`/api/discover`), with the complexity gate + grounding verifier replacing the toggle's cost/safety jobs.
- [[use-chat]] — REMOVED. The old scripted/live chat contract (deleted with `src/_parked` 2026-06-15; in git history); the live contract is `useDiscover`.
- [[chat-persistence]] — REMOVED. `/api/chat` turn persistence to Supabase (deleted with `src/_parked`; accounts deferred to Phase-2).
- [[chip-entry-strategy]] — the retired river's entry-hero chip cascade.
- [[waypoints-slice]] — the retired river's breadcrumb history.
- [[campaigns]] — Supabase editorial/AI-bias campaigns (Phase-2/parked).
- [[admin-zones]] — partition of the *old* admin panel; today's admin is the Studio ([[enrichment-studio]]).
- [[admin-panel-guide]] — how-to for the *old* admin (banners, conversions, user sessions); superseded by [[enrichment-studio]].
- [[account-store-auth-aware-client]] — parked accounts layer (Supabase RLS + browser client gotcha).

### Pending / dead stubs

Mostly retired-river internals; not worth pages. `account-store`, `intent-scoring`, `scripted-ai-engine`, `live-chat-route` (`/api/chat`), `dual-stream-layout`, `client-shell`, `session-reset`, `taste-grid-section` — all MISE-era or parked. Promote only if a *live* need reappears.
