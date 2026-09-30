# Intently — developer README

The Next.js 16 app behind Intently: the shopper-facing discovery surface, the
merchandiser Studio (`/admin`), and the API routes that serve both. For the
*why* — problem, architecture, decisions — start at the
[root README](../README.md) and the [wiki](../wiki/index.md).

---

## Running locally

```bash
npm install
NEXT_PUBLIC_CATALOG=vision npm run dev   # http://localhost:3000
```

Product photos (H&M images, `public/catalog/*.webp`) are served by the live
demo but are not part of the public repository. Without them the app runs
normally, but cards have no photo.

No API key needed — the deterministic discovery engine answers every turn by
default. `NEXT_PUBLIC_CATALOG=vision` selects the 292-product, photo-enriched
catalogue (recommended). With keys, opt-in Tier-1 LLM stages layer on top — see
"Enabling the LLM tiers" below.

| Command | What it does |
|---|---|
| `npm run typecheck` / `lint` / `test` | the CI gates (`test:ci` adds coverage) |
| `npm run build` | production build |
| `npm run eval` | all keyless evals (runs in CI); each rewrites its `docs/*-latest.md` report — a keyless run drops the parse report's LLM column, so don't commit that file from a keyless run |
| `npm run eval:scorecard` | safety + cost scorecard → `docs/eval-scorecard-latest.md` (exclusions, grounding red-team with a held-out set, escalation rate, latency) |
| `npm run eval:parse` | comprehension eval → `docs/parse-eval-latest.md` (`PARSE_LLM=deepseek\|haiku\|openai` adds the LLM column, ~$0.01) |
| `npm run eval:tailor` | persona conversation eval → `docs/tailor-eval-latest.md` (`TAILOR_JUDGE=1` adds a Haiku judge) |
| `npm run env:init` | scaffold `.env.local` from `.env.example` |

### Surfaces

| Path | What |
|---|---|
| `/` | the discovery surface ("Shop by situation") — `src/app/next/NextExperience.tsx` |
| `/admin/enrichment/studio` | the Studio: catalogue health, vision enrichment, curation, situations, needs-attention queue |
| `/admin/enrichment/studio/models` | model bench — same query, two provider configs side by side |
| `/admin/enrichment/studio/config` | runtime config (LLM budget, rate limits, escalation threshold, A/B experiments) |
| `/admin/analytics` | commerce funnel, conversation/LLM health, budget burn |
| `POST /api/discover` | the single discovery contract (`useDiscover` is its only client) |
| `/api/enrichment/*` | sync, search, products, vectors, situations, attention queue |

For a guided walkthrough, see [`docs/demo-script.md`](docs/demo-script.md).

---

## Project structure

```
src/
├── app/
│   ├── page.tsx              # renders NextExperience (discovery surface)
│   ├── next/                 # NextExperience.tsx + live.ts (API client) + response contract types
│   ├── admin/                # Studio + analytics pages
│   └── api/                  # discover, discover/probe, enrichment/*, analytics/*, cart, admin/*
├── lib/
│   ├── discovery/            # the engine — see below
│   ├── enrichment/           # PIM adapters → embed text → embedder → vector store; vision/
│   ├── analytics/            # event stream, aggregation, situation mining
│   ├── store/                # doc-store: PM-editable docs, local JSON ↔ Supabase runtime_kv (INTENTLY_STORE)
│   └── data.ts               # catalogue access (stable signatures over the JSON catalogues)
├── hooks/useDiscover.ts      # the one UI → discovery contract
├── store/intently-store.ts   # the single Zustand store
├── proxy.ts                  # two-password Basic-Auth edge gate (Next 16 proxy convention)
├── types/                    # shared types; enrichment.ts holds the pipeline interfaces
└── tests/                    # Jest (jsdom) — the only path Jest matches
scripts/                      # evals (*.eval.ts), catalogue builders, ops helpers
supabase/migrations/          # Postgres schema (pgvector, analytics, RLS)
```

### Discovery engine (`src/lib/discovery/`)

| File | Role |
|---|---|
| `engine.ts` | parse → prefilter → diversify → compose; shortlist sizing ("wise listing") |
| `parse-context.ts` / `vocabulary.ts` | deterministic regex parser over a canonical vocabulary |
| `escalate.ts` | complexity gate — decides per turn whether an LLM parse is worth paying for |
| `parse-llm.ts` / `generate-llm.ts` / `llm-client.ts` | Tier-1 comprehension + re-voicing, provider-agnostic |
| `verify.ts` | grounding verifier — rejects prose naming unshown products or promising actions |
| `guardrails.ts` | input sanitising, per-IP rate limits, global daily LLM budget |
| `consult.ts` / `voice.ts` / `attributes.ts` | ask-before-offer consultation, tailor voice |
| `companions.ts` | outfit completion ("complete the look"), cart-aware |
| `situation-match.ts` + `situation-*.ts` | soft situation model — biases ranking, never hard-excludes |
| `retrieve.ts` | opt-in vector retrieval bridge (`DISCOVERY_RETRIEVAL=vector`) |

---

## Status of optional / paused parts

| Area | Status |
|---|---|
| Medusa PIM (`../pim`) + storefront (`../storefront`) | local-only; cloud hosting paused on cost. `PIM_SOURCE=medusa` + `NEXT_PUBLIC_BASE_PATH=/discovery` embeds discovery into the storefront. |
| Shopper accounts / auth | Phase 2 — schema + RLS applied (`supabase/migrations`), app layer in git history. `src/lib/auth/admin-guard.ts` is a permissive stub; admin is protected at the edge by `proxy.ts`. |
| Studio curation on serverless | durable via `lib/store/doc-store.ts` (Supabase `runtime_kv` on cloud); last-write-wins — see [`prodprep.md`](../prodprep.md) |

---

## Deploying to Vercel

This repo has no root `package.json` — `intently/` and `wiki/` are siblings
under the repo root. **The #1 way a first import silently fails is forgetting
this.**

### Step 1 — Import the repo

This repo's remote is **GitLab** (`git@gitlab.com:ilmari.m.vuorenmaa-group/intently.git`),
not GitHub — use Vercel's "Import from GitLab" flow (a separate connection
from its GitHub App). If you're deploying from a GitHub mirror instead,
the flow is the same, just pick GitHub in the import screen.

1. Go to [vercel.com](https://vercel.com) → **Add New Project** → import the
   `intently` repo (GitLab or your GitHub mirror).
2. **Before the first deploy, set Project Settings → General → Root
   Directory → `intently`.** Without this, the build fails with
   "no package.json found."
3. Framework Preset should auto-detect **Next.js** from `intently/vercel.json`
   once Root Directory is correct. Node version: 20.x (pinned via
   `intently/.nvmrc`).

### Step 2 — Set environment variables

Project → Settings → Environment Variables. At minimum, for a standalone
demo (no Medusa, no basePath):

| Variable | Value |
|---|---|
| `PIM_SOURCE` | `catalog` |
| `DISCOVERY_RETRIEVAL` | `deterministic` |
| `LOG_FILE_ENABLED` | `false` — **required**, the filesystem is read-only at runtime |
| `NEXT_PUBLIC_DATA_MODE` | `local` |
| `NEXT_PUBLIC_CATALOG` | `vision` (richer, image-backed catalogue) |
| `SITE_BASIC_AUTH_PASSWORD` | a password of your choice — gates the **whole** deployment (see `src/proxy.ts`) |
| `ADMIN_BASIC_AUTH_PASSWORD` | a second password — gates `/admin/*` and the admin APIs |

**Both passwords are optional and independent** (`src/proxy.ts`). Unset both
and the deployment is fully public; set only `ADMIN_BASIC_AUTH_PASSWORD` and
you get a public demo with a private admin; set both and the deployment is
private end to end, with the demo password not granting admin access. The
admin password opens shopper routes too, so one operator credential is enough.

The only path that stays reachable through the gate is `POST
/api/analytics/order` — the host storefront's order webhook, which is
authenticated by `INTENTLY_WEBHOOK_SECRET` and called by a backend that can't
answer a Basic Auth challenge.

Add `DISCOVERY_PARSER` / `DISCOVERY_GENERATION` (`deepseek` | `haiku` | `openai`)
plus the matching key (`DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`)
for the LLM-driven conversation, or `ENRICHMENT_STORE=supabase` +
`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` for a durable vector
store — see `.env.example` for the full reference and `prodprep.md` (repo
root) for what's still local-file-backed and won't persist across deploys.

**Set a monthly spend cap in the provider console** (DeepSeek / Anthropic /
OpenAI) if enabling the LLM tiers — the app's own budget cap is in-memory and
only a soft limit across Vercel's multiple function instances.

### Step 3 — First deploy, then ongoing updates

The first deploy is worth triggering manually (`vercel deploy` or the
dashboard's Deploy button) so you can watch the build log directly. Once
that's clean, connect the project's Git integration (Settings → Git) for
automatic deploys on every push to `main`.

---

## Enabling the LLM tiers (optional)

Discovery is **live-only**: every turn POSTs `/api/discover` (the scripted
client-side mode was removed 2026-07-15). The deterministic engine answers by
default — no key needed. Two opt-in Tier-1 LLM stages layer on top, each
selectable per provider:

- `DISCOVERY_PARSER=deepseek|haiku|openai` — comprehension: free text → a
  validated context patch (paraphrase, negation, indirect phrasing).
- `DISCOVERY_GENERATION=deepseek|haiku|openai` — re-voice the tailor's spoken
  prose; a deterministic faithfulness + grounding gate (`verify.ts`) rejects
  any rephrase that names an unshown product or promises an action Intently
  can't perform, keeping the template.

Cost/latency discipline is structural:

- **Complexity gate** (`escalate.ts`): simple turns ("blue shirt") never call
  an LLM even when a provider is on — only turns the regex parser would
  under-read escalate.
- **Daily budget** (`DISCOVERY_LLM_DAILY_CAP`): over cap = silent degrade to
  the deterministic path.
- Every failure mode (no key, timeout, non-200, unfaithful output) returns
  the deterministic answer — the demo never dead-ends.

Setup: `npm run env:init`, add the key for your provider
(`DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`), set the two
`DISCOVERY_*` flags, restart `npm run dev`. Models are overridable via
`DISCOVERY_DEEPSEEK_MODEL` / `DISCOVERY_HAIKU_MODEL` / `DISCOVERY_OPENAI_MODEL`
(default `gpt-5.4-nano` — 5× cheaper than gpt-5.6-luna and right-sized for
extraction/rephrase).

PMs can test and validate models per use case in the **Studio model bench**
(`/admin/enrichment/studio/models`) — same query, two configurations side by
side, with per-stage latency and grounding verdicts.

Provider-side monthly caps in the DeepSeek / Anthropic / OpenAI consoles
remain the only hard financial backstop.

---

## Dependency version policy

Versions in `package.json` are pinned for two reasons:

- **next / react / react-dom** — pinned to patched versions for CVE-2025-66478.
  Do not float these with `^` until the security advisory is closed.
- **@types/react / @types/react-dom** — pinned exactly (no `^`) to prevent
  peer dependency conflicts with `@testing-library/react`. Floating caused
  npm to resolve `@types/react@18` which conflicts with React 19.

When upgrading, update all three together: `next`, `react`, `react-dom`,
`@types/react`, `@types/react-dom`, and `eslint-config-next`.

