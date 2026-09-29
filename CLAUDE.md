# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Don't flatter me. Use radical candor when you communicate with me. Tell me something I need to know even if I don't want to hear it

## Repository layout

The Next.js app lives in the `intently/` subdirectory — **all commands below must be run from `intently/`**, not the repo root. The root only contains `.cursorrules`, `.mise.toml`, the wiki, and CI config; there is no root `package.json`.

(Historical note: this folder was named `mise/` until 2026-05-30, and the product codename was "MISE" — a Japanese-kitchen commerce river. It pivoted to **Intently** (contextual fashion / outdoor discovery) in the v0.2 branch: a rebrand of every `mise` identifier → `intently` *plus* a scope change — cooking data models dropped, fashion/outdoor + vector-enrichment models added. Full record: [intently/docs/mise_to_intently_migration.md](intently/docs/mise_to_intently_migration.md). The `.mise.toml` at the repo root is unrelated — that's config for the `mise` version manager and was left alone.)

## Phase-1 stance

Two things shape everything below:

- **Phase-1 is deliberately no-infra / local-first.** The running app uses in-memory catalogue JSON, a file-backed vector store, and an in-memory Zustand store. Supabase (accounts + pgvector) and any LLM in the request path are **Phase-2** — wired behind interfaces and env flags but off by default so CI and the no-key demo always work.
- **The old MISE river is gone, not parked.** The pre-pivot food/recipe app — `useChat`, the tiered-AI orchestrator + `scripted-ai`, recipes/kits, intent-score, dual-stream, waypoints, the account/AccountStore layer, `middleware.ts`, and its tests — lived in `src/_parked/` after the pivot and was **deleted 2026-06-15** (§7 of the migration doc). **Do not re-introduce MISE concepts.** If a Phase-2 feature genuinely needs one of those areas (the tiered-AI orchestrator, the account/auth layer, the admin analytics), recover it from git history at the pre-deletion commit and re-wire it deliberately — don't rebuild from memory.

## Common commands (run from `intently/`)

```bash
npm install           # install deps
npm run dev           # start dev server at http://localhost:3000
npm run build         # production build
npm run typecheck     # tsc --noEmit
npm run lint          # eslint .
npm test              # jest
npm run test:watch    # jest in watch mode
npm run test:ci       # jest --ci --coverage (what CI runs)
npm run env:init      # scaffold .env.local from .env.example
```

Operational helpers (Phase-2 / Supabase-mode tooling, not needed for the local demo): `npm run logs` / `logs:raw` / `logs:clear` (tail the AI/event log), `npm run ai:budget` / `ai:budget:reset` (daily spend caps), `npm run check:service-role`, `npm run admin:login-link`, `npm run dev:localsetup`.

Run a single test file: `npx jest src/tests/discovery.test.ts`
Run a single test by name: `npx jest -t "routes a hiking situation to outdoor"`

Tests use `jest-environment-jsdom` and only match `src/tests/**/*.test.ts{,x}`. Path alias `@/*` → `src/*` works in both code and tests.

## CI

Two equivalent pipelines run `typecheck`, `lint`, `test` (`npm run test:ci`), and `build` against `intently/`: `.gitlab-ci.yml` (the `origin` remote; also runs GitLab SAST + Secret Detection) and `.github/workflows/ci.yml` (for a GitHub mirror). Keep them in sync when adding a gate. CI is keyless: the LLM flags are unset, so tests exercise `/api/discover`'s deterministic default directly (route tests import the handler; hook tests stub `fetch` with the engine). Deploys are manual (`vercel deploy --prod` from `intently/`), not CI-triggered.

## Architecture

The shopper surface is one self-contained client component, `NextExperience` ([intently/src/app/next/NextExperience.tsx](intently/src/app/next/NextExperience.tsx)), rendered by `src/app/page.tsx`: landing → conversation thread → consultation questions → explained shortlist + outfit-completion rails → cart. There is no router navigation between these; store state transitions drive what renders. (The older multi-section "river" — `src/components/sections/` — was retired in the pivot; see wiki Historical.) The merchandiser **Studio** lives under `src/app/admin/`.

The product turns a shopper's **situation** ("blue casual shirt for a summer evening", "sturdy track pants for the gym") into an **explained shortlist**. The shopper-facing product has **one catalogue** — never reintroduce fashion/outdoor selectors in UI or APIs. The demo runs the photo-enriched vision catalogue (`NEXT_PUBLIC_CATALOG=vision`); the engine's internal outdoor route is a known residual (see `prodprep.md`).

### Single source of truth: Zustand store

`src/store/intently-store.ts` is the one store; every section reads from and writes to it. The rule from `.cursorrules`: **never prop-drill through more than 2 levels** — if you need deeper state, add it to the store. It's split into slices — **conversation/session, style picker, cart, flow, session-reset** — exposed as one `useIntentlyStore` hook. Phase-1 store is in-memory only (no persist; the account/Supabase layer is deferred to Phase-2).

### Persistence restores DATA, never navigates

Codebase-wide invariant: anything that auto-advances `activeSection` or the discovered results (or any "where am I" state) MUST gate on a session-scoped interaction flag — NOT on the persisted data itself. The `hasInteractedWithStyle` flag on the style slice is the live instance (renamed from MISE's `hasInteractedWithTaste`). See [wiki/concepts/persistence-restores-data](wiki/concepts/persistence-restores-data.md) for the full rule, the trap it prevents, and how to extend it for future slices. (The invariant matters most once persistence returns in Phase-2 — keep new auto-advance logic compliant now so it doesn't bite later.)

### Auto-scrolls only fire on direct user clicks

Submitting a prompt (entry hero / conversation reply) and auto-advancing on style signals MUST NOT scroll the viewport past the assistant's answer. The only allowed auto-scrolls are responses to explicit button clicks — "see your results", "adjust style", cart-drawer `checkout`, etc. Prompt submissions keep the new reply in view; never auto-scroll DOWN to discovery on a submit. Motion/scroll rules live in [intently/docs/design.md](intently/docs/design.md) and are enforced by the `mise-motion-polish` skill.

### Discovery: deterministic engine, vector retrieval opt-in

The shopper-facing AI path is **discovery**, not chat. `src/hooks/useDiscover.ts` is the single contract the UI calls (`discover(query)`); it folds the query into a running `SessionContext`, retrieves + ranks, and writes the outcome to the store. It is **live-only** (scripted mode removed 2026-07-15): every turn `POST`s `/api/discover`; on any error it falls back to the client-side deterministic engine so the demo never dead-ends. One `{ message, results, updatedSession }` shape either way.

The engine itself lives in `src/lib/discovery/`:
- `engine.ts` — `discover()` / `composeFromCandidates()`: parse turn → `prefilter` (hard exclusions + scoring) → category-diversify → templated "why this fits" explanations. Deterministic and instant.
- `session.ts` — folds each turn into `SessionContext` (occasion, formality, season, constraints, exclusions, preferences, turnCount).
- `prefilter.ts` — scoring over a candidate set.
- `retrieve.ts` — the **opt-in** bridge to the enrichment layer. When `DISCOVERY_RETRIEVAL=vector`, candidates come from Xenova-embedding + the vector store (lazy idempotent seed of the catalogue), then the **same** deterministic prefilter/explanation runs over them ("vector narrows the catalogue; the deterministic engine reasons over candidates"). Default is `deterministic` — better and instant at this catalogue size; the vector path exists to prove scale.

`inferCatalog()` (`src/lib/discovery/infer-catalog.ts`) picks the internal fashion vs outdoor route per turn (a locked activity wins, then explicit garment/occasion words, then outdoor-activity signals; default fashion).

> **The LLM tiers are opt-in and per-turn gated.** `/api/discover` is deterministic by default; `DISCOVERY_PARSER` / `DISCOVERY_GENERATION` (deepseek | haiku | openai) enable Tier-1, the complexity gate (`escalate.ts`) keeps simple turns off the LLM entirely, and the grounding verifier (`verify.ts`) rejects prose naming unshown products or promising actions Intently can't perform. Standing preference (the `mise-tiered-ai` skill): deterministic code first, cheap models for bulk, escalate only on proven need. Keep the `useDiscover` single-contract rule — the keyless deterministic path must stay complete. Full target design: [intently/docs/data-architecture.md](intently/docs/data-architecture.md).

### Enrichment layer: PIM → embeddings → vector store → semantic search

`src/lib/enrichment/` is the semantic-search bridge between a product source (PIM) and discovery. Every box is swappable behind a typed interface (contracts in [intently/src/types/enrichment.ts](intently/src/types/enrichment.ts)):

```
PimAdapter → Enricher (enrich-text.ts) → Embedder → VectorStore → search(queryVec, k)
```

- **PimAdapter** (`pim-factory.ts` picks via `PIM_SOURCE`): `pim-intently-catalog.ts` (the in-app fashion/outdoor catalogue, default), `pim-kaggle-csv.ts` / `pim-kaggle-curated.ts`, `pim-medusa.ts` (Medusa v2 REST, requires a running `pim/` sibling).
- **Embedder** (`embedder.ts`, picked via `ENRICHMENT_EMBEDDER`): `XenovaEmbedder` running `all-MiniLM-L6-v2` (384-dim) in-process — no API call, no key, the local default — or `OpenAIEmbedder` (`text-embedding-3-small` at `dimensions:384`), used on the cloud deployment because Xenova's native binary can't run on serverless. Stored and query vectors must come from the same embedder; switching = clear + full re-sync.
- **VectorStore** (`vector-store-factory.ts` picks via `ENRICHMENT_STORE`): `vector-store-local.ts` (file-backed JSON at `.enrichment/`, gitignored, cosine in-process — default) or `vector-store-supabase.ts` (pgvector behind RLS; live on the cloud demo). `vector-math.ts` holds the pure cosine/normalise helpers.
- **Vision enrichment** (`enrichment/vision/`): Claude Haiku reads each product photo → validated attributes (occasions, silhouette, materials, discovery queries); chunked + resumable so it runs on serverless.
- **The embed text matters more than the model** — `enrich-text.ts` composes the per-product string. It's the single most tweakable knob for match quality.

Surfaces: `/api/enrichment/{sync,search,products,vectors/[id],situations,attention}` and the Studio at `/admin/enrichment/studio` (catalogue health, vision enrichment, curation → re-embed, situation tuner, needs-attention queue, model bench, runtime config) plus `/admin/analytics` — the "honest internals" view. Sync is explicit (a button), not webhook-driven, in Phase-1. Full rationale + non-goals: [intently/docs/enrichment-layer.md](intently/docs/enrichment-layer.md) and [wiki/concepts/enrichment-layer](wiki/concepts/enrichment-layer.md).

### Data layer — catalogue vs accounts

Two layers, deliberately split:

- **Catalogue** (`src/lib/data.ts`) — hardcoded product JSON: `src/lib/catalog/vision-catalog.json` (the demo catalogue, `NEXT_PUBLIC_CATALOG=vision`) or `fashion-catalog.json` + `outdoor-catalog.json` (the Kaggle-derived default set). Exports stable signatures (`getAllProducts()`, `getProductById()`, `getProductsByCatalog(catalog)`, `searchProducts()`). Truth is in-memory; bodies swap to the eventual catalogue source without touching call sites — don't leak the in-memory shape into callers. `Product`, `Catalog`, `SessionContext`, `DiscoveryResult` types live in `src/types/index.ts`.
- **Accounts** (the `AccountStore` interface + localStorage/Supabase impls, formerly under `src/lib/account/`) — **deferred to Phase-2**. The MISE-era impls were removed with `src/_parked/` (2026-06-15) and live in git history. The Postgres schema (`intently/supabase/migrations/`, 0001–0011, RLS on per `0005`) is applied and verified against the live Supabase project but the running app does not use it (`NEXT_PUBLIC_DATA_MODE` defaults to local; the demo user is anonymous). When the account layer comes back, recover it from git history, route every user-scoped read/write through `AccountStore`, and read the active user id from the auth module — never reference `DEMO_USER_ID` directly outside it.

> Medusa was considered as the commerce backbone and deferred — see [wiki/decisions/supabase-over-medusa](wiki/decisions/supabase-over-medusa.md) and [wiki/decisions/pim-strategy](wiki/decisions/pim-strategy.md). It survives as the optional `pim-medusa.ts` enrichment source. Account-layer reference (Phase-2): [intently/docs/account-backbone.md](intently/docs/account-backbone.md). Auth (magic-link via Supabase, parked with accounts): [wiki/decisions/supabase-auth-over-clerk](wiki/decisions/supabase-auth-over-clerk.md).

### `src/` at a glance

```
src/app/                   App Router. page.tsx renders NextExperience. next/ holds the shopper surface
                           (NextExperience.tsx, live.ts API client, scripted.ts = response-contract types).
                           api/discover (+ /probe for the model bench), api/enrichment/*, api/analytics/*,
                           api/cart, api/admin/*. admin/ = the Studio + analytics pages.
src/components/ui/         ClientShell (client overlays inside the server layout), EmbeddedNav.
src/components/admin/      Admin-only UI (RangePicker, ResetPanel, RunEnrichmentButton).
src/hooks/                 useDiscover (the one UI → discovery contract), useFlyToCart, useRiverReveal.
src/lib/                   data, asset, ids, log, motion + discovery/ + enrichment/ + analytics/ + store/
                           (doc-store: local JSON ↔ Supabase runtime_kv) + supabase/ + catalog/ + auth/.
src/proxy.ts               Two-password Basic-Auth edge gate (Next 16 `proxy` convention).
src/store/                 intently-store.ts — the single Zustand store.
src/tests/                 Jest tests + setup.ts (the only path Jest matches). Evals: scripts/*.eval.ts.
src/types/                 index.ts (shared) + enrichment.ts + asset.ts + vision.ts.
```

## Conventions

- Files: kebab-case. Components: PascalCase (`.cursorrules`).
- Strict TypeScript, no `any`.
- Types live in `src/types/index.ts` (shared) — extend there rather than defining component-local types that cross boundaries. Enrichment contracts live in `src/types/enrichment.ts`.
- Client overlays are mounted via `src/components/ui/ClientShell.tsx` inside the server `src/app/layout.tsx`; the shopper surface's own header/cart/thread live inside `NextExperience`.
- ESLint v9 flat config (`eslint.config.mjs`) uses `eslint-config-next`'s native flat exports — do not reintroduce `FlatCompat`.
- Next 16: Turbopack is the default dev bundler.
- Deploys target Vercel region `fra1` (`intently/vercel.json`), standalone at the deployment root (no basePath) — see `intently/README.md` § Deploying to Vercel.

> Design and interaction conventions (button styles, motion, scroll behavior) live in @docs/design.md. Update that file when you add a new pattern; reference it when in doubt about how something should feel.

## Dependency pinning — do not float

`next`, `react`, `react-dom` are pinned (no `^`) as the minimum patched versions for CVE-2025-66478 and CVE-2025-55182 (Next.js + React security advisories; see `securityNotes` in `package.json` and `README.md`). `@types/react` and `@types/react-dom` are pinned exactly to avoid `@testing-library/react` peer-dep conflicts that resolve `@types/react@18` against React 19. When upgrading, update `next`, `react`, `react-dom`, `@types/react`, `@types/react-dom`, and `eslint-config-next` together. See `package.json` `securityNotes`, `README.md`, and [wiki/decisions/dependency-pinning](wiki/decisions/dependency-pinning.md).

## Environment

`npm run env:init` (or `cp .env.example .env.local`) inside `intently/`. The local demo needs **no keys**. Relevant vars:

- ~~`NEXT_PUBLIC_AI_MODE`~~ — **removed 2026-07-15**; discovery is live-only (`POST /api/discover`, deterministic default, client-side engine fallback on error).
- `DISCOVERY_RETRIEVAL` — `deterministic` (default) or `vector` (use the enrichment layer to select candidates).
- `DISCOVERY_PARSER` — `deepseek` / `haiku` / `openai` enables the **Tier-1 comprehension** LLM (free text → validated context, regex-first merge); unset = the regex parser. Per-turn gated by `escalate.ts` — simple turns never call an LLM. See [wiki/concepts/tiered-conversation](wiki/concepts/tiered-conversation.md).
- `DISCOVERY_GENERATION` — `deepseek` / `haiku` / `openai` enables the **Tier-1 generation** LLM (re-voice the tailor's spoken prose; faithfulness gate + grounding verifier (`verify.ts`) + template fallback); unset = templates. Both flags fail safe; both off = the CI/no-key deterministic path. Models: `DISCOVERY_DEEPSEEK_MODEL` (default `deepseek-v4-flash`, thinking disabled), `DISCOVERY_HAIKU_MODEL`, `DISCOVERY_OPENAI_MODEL` (default `gpt-5.4-nano`).
- `PIM_SOURCE` — enrichment product source: in-app catalog (default), kaggle, or medusa.
- `ENRICHMENT_STORE` — `local` (file-backed JSON, default) or `supabase` (pgvector; apply migration `0010` first). `ENRICHMENT_EMBEDDER`, `ENRICHMENT_LOCAL_DIR` tune the embedder/store.
- `NEXT_PUBLIC_DATA_MODE` — `local` (default; anonymous demo user) or `supabase` (Phase-2 account layer).
- `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` — consumed by the live path when `DISCOVERY_PARSER` / `DISCOVERY_GENERATION` are set (Tier-1 comprehension + generation, both server-side, both with a deterministic fallback). Still off by default. See `.env.example` for Supabase keys, daily-budget caps, and logging knobs. The Studio model bench (`/admin/enrichment/studio/models`) probes explicit provider/model overrides via `POST /api/discover/probe` without touching the env defaults.

## Roadmap

See @docs/roadmap.md for long-term product direction and planned features.

## Pre-production checklist

[prodprep.md](prodprep.md) at the repo root catalogs items that are **dev-acceptable but prod-risky** — concurrency races, naïve regexes, PII in logs, brittle `process.cwd()` paths, etc. Not a roadmap; specifically the residue from code reviews where the right call was "fine for dev, must address before prod."

When reviewing code: if something is fine now but would break under multiple replicas, public exposure, or real user data, **add it to prodprep.md** instead of fixing inline. Don't pollute it with planned roadmap work (that lives in @docs/roadmap.md and the wiki). The file should shrink over time, not grow.

## Project wiki (LLM-maintained)

There is a structured, interlinked wiki at `wiki/` (Obsidian vault root). It exists to save tokens and preserve rationale across sessions.

- `wiki/AGENTS.md` — schema, conventions, and ingest/query/lint workflows. Read once per wiki session.
- `wiki/index.md` — catalog of every page. Read this first for "why" / rationale questions.
- `wiki/log.md` — chronological record of ingests and updates.

### When to USE the wiki

Use the wiki for "why" and "rationale" questions and for orientation on entities/concepts that have a page in `wiki/index.md`. For "what does the code do" questions where index.md has no clear match, go straight to source — do not waste a turn searching the wiki for things that aren't there yet. The wiki is incomplete by design and will grow.

### When to UPDATE the wiki

Update the wiki ONLY when one of these is true:

- A non-obvious decision was made (why X over Y, what was rejected and why)
- A gotcha was discovered that future-you would forget
- A new architectural pattern was introduced (new section, new slice, new contract)
- A new source was ingested per `wiki/AGENTS.md`

DO NOT update the wiki for:

- Code-only changes that don't add new claims (renames, refactors, simple bug fixes)
- Routine UI / motion / typography tweaks
- Additions that fit existing pages without changing the synthesis

If a session produces a substantial answer (a comparison, an analysis, a connection) that would be valuable next session, file it as a wiki page even if no other rule triggered.

The wiki is **not** a paraphrase of the code — the code is canonical for what code does. The wiki captures rationale, conventions, decisions, and cross-cutting patterns.

Slash commands: `/wiki-ingest <path>`, `/wiki-lint`, `/wiki-status`.

## Delegation to DeepSeek worker

When in doubt, do the work yourself. Delegate ONLY when criteria match.

DELEGATE:
- Reading 3+ files OR one file >400 lines just to answer a question:
  `deepseek-read --paths <files> --question "<q>"`
  Use the returned summary as notes; re-read only the lines you'll edit.
- Boilerplate generation (jest tests, JSDoc, repetitive markdown, simple
  config variants):
  `deepseek-write --spec "<what>" [--context <ref>] --target <path>`
  Then read the file, sanity-check it, and edit surgically. Never trust
  the output blind.

NEVER DELEGATE:
- Architectural decisions, debugging, anything safety-sensitive
- Edits that need exact line numbers
- Tasks under ~2000 tokens — overhead exceeds savings
- Work that touches the discovery surface's state machine, the Zustand store
  (`src/store/intently-store.ts`), the discovery engine, or the enrichment
  pipeline — keep that on Claude
- UI/UX iteration, motion tuning, copy in discovery explanations —
  anything that requires seeing the rendered page. The worker has no eyes.
- Reads where `wiki/index.md` already has a relevant page — read the wiki
  page (much cheaper, better signal) instead of paying DeepSeek to read source.

The helpers live in `~/bin/` and are user-global; the API key is in
`~/.zshenv`. They are not part of this repo.

## Browser verification (Preview MCP) — ASK FIRST, NEVER AUTONOMOUS

Claude has no eyes on the rendered page by default. The shell can run `npm run dev` but the agent cannot see what loads, which is how UI regressions reach the user before the agent (e.g. the phantom-waypoint hydration trap, retro 2026-05-16).

The `mcp__Claude_Preview__*` and `mcp__Claude_in_Chrome__*` tools close that gap — they can start a dev server, navigate, click, screenshot, read the console, and eval JS in the page. **The agent must NOT use them autonomously.**

Hard rule:

- **When a change touches `src/app/next/`, `src/app/admin/`, or `src/components/`** (or any rendered surface where behaviour depends on the DOM, scroll position, or hydrated state) the agent should *propose* a Preview verification plan: which flow to exercise, what to assert, what success looks like.
- **The user explicitly approves before the agent invokes any Preview / Chrome MCP tool.** No silent dev-server starts, no screenshots-on-spec, no eval-in-page without a green light.
- "Approval" means the user types something like "yes, run it" or "go ahead with preview" in response to the proposed plan. A general "fix this bug" is NOT approval to spin up the browser.
- If the user declines, the agent reports the un-verified UI risk honestly in the end-of-turn summary ("CI green; I could not test the rendered surface — needs your eyes on the dev server").

Why the rule is asymmetric (ask-first, not just disclose):

- Starting a dev server is stateful — it occupies a port, may collide with the user's own running session, and produces logs in their environment.
- Screenshots and console reads inside the Preview tool can capture content the agent shouldn't necessarily see (in-progress drafts, other apps).
- The user has explicit context about whether the dev server is already up, whether other work is in flight, and whether a UI verification is worth the time RIGHT NOW vs. later.

The agent CAN still write integration jest tests that exercise rendered components without the Preview tool — those run in jsdom and don't need approval beyond the usual "I'm about to run tests." Preview is only for the actual rendered browser surface.
