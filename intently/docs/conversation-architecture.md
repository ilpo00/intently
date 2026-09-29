# The Intently conversation — architecture & handoff

How a shopper's free-text situation becomes an **understood context + an explained
shortlist**, end to end. This is the surface to refine next session, so this doc is
written as a handoff: the path, the data objects, the parameters, the models (AI
tiers), and where the seams are.

> **Headline:** there is **no LLM in the live request path today.** The whole
> "conversation" — parsing, scoring, ranking, the assistant's message, and the
> per-product "why" — is **deterministic** (regex + lookup + a weighted scorer +
> string templates). It's instant, needs no key, and runs in CI. The LLM tiers are
> designed-for but not wired (see *AI tiers* below). Refining the conversation =
> deciding what to promote from deterministic templates to a model, behind the same
> single contract.

---

## 1. The path: text in → text out

```
 Shopper types a situation ("a smart jacket for the office")
        │  RefineBar (NextExperience.tsx)
        ▼
 runFirst / runRefine                                    ── src/app/next/NextExperience.tsx
        │  optimistic UI: push user bubble, "thinking…"
        ▼
 liveDiscover(query, session)                            ── src/app/next/live.ts
        │  POST {BASE}/api/discover  { query, session, catalog }
        │  (on ANY error → discoverFirst(query), the scripted offline fallback in scripted.ts)
        ▼
 POST /api/discover                                      ── src/app/api/discover/route.ts
        │  pick retrieval + load situation profiles (flags below)
        ├── DISCOVERY_RETRIEVAL=vector → vectorRetrieve(query, catalog)   ── src/lib/discovery/retrieve.ts
        │        Xenova MiniLM embeds the query → VectorStore top-k candidates
        │        (the catalogue is lazily embedded once; Medusa/vision/catalogue source via PIM_SOURCE)
        └── default (deterministic)   → the whole catalogue for `catalog`
        ▼
 composeFromCandidates(query, session, candidates, profiles)   ── src/lib/discovery/engine.ts
        │  1. updateSessionContext(prev, query)   parse the turn → running context   ── session.ts
        │  2. prefilter(candidates, ctx)          hard exclusions + a 0..1 score      ── prefilter.ts
        │  3. (optional) soft situation bias      multiplicative re-rank, never excludes ── situation-match.ts
        │  4. diversifyByCategory                 round-robin across categories
        │  5. toResults → explain(product, ctx)   templated "why this fits"
        │  6. summary(ctx, n, isRefinement)       the assistant's top-line message
        ▼
 { message, results:[{product, matchExplanation, relevanceScore}], updatedSession }
        ▼
 Overlay renders                                         ── NextExperience.tsx
        • message            → the assistant bubble
        • updatedSession     → the "understood" chips (occasion / formality / season / …)
        • results            → explained cards (the why-this line is the hero)
        • refineChips        → quick refinements; re-rank diff (added/removed/kept) on the next turn
```

**Two entry points, one contract.** The legacy "river" calls the engine via
`src/hooks/useDiscover.ts`; the `/next` overlay calls it via `src/app/next/live.ts`.
Both POST the *same* `/api/discover` and must return the *same* shape, and **both
keep a complete scripted fallback** (`useDiscover`'s client path / `scripted.ts`'s
`discoverFirst`) so the no-key/offline/CI demo never dead-ends. Preserve this when
you add a model: branch inside the adapter, never in the UI.

---

## 2. The data objects (the "parameters behind it")

### `SessionContext` — the lean state the engine reasons over (never raw chat history)
Defined in `src/types/index.ts`; folded by `updateSessionContext` (`session.ts`):

| field | type | how it's set |
|---|---|---|
| `occasion` | string? | `detectOccasion` — wedding/party/work/dinner (latest-wins) |
| `formality` | enum? | `detectFormality` — casual / smart casual / formal / black tie |
| `season` | string? | `detectSeason` — season words + month→season table |
| `activity` | string? | `detectActivity` — hiking / running / camping |
| `exclusions` | string[] | `detectExclusions` — "no/avoid/without/already have X" (additive) |
| `constraints` | string[] | `detectConstraints` — outdoor venue / cold evenings / budget / … (additive) |
| `preferences` | string[] | `detectPreferences` — fabrics, cuts, the 9 style archetypes (additive) |
| `turnCount` | number | incremented each turn (drives "Here are…" vs "Updated —…") |

The parser is **deterministic regex/keyword matching** — additive for
exclusions/constraints/preferences, latest-wins for occasion/formality/season/activity.
This is the single biggest lever on conversation quality (see §5).

### `DiscoverTurn` — the overlay's per-turn view model (`scripted.ts`)
`{ message, chips: ParsedChip[], results: ExplainedResult[], refineChips, followUp?, diff?, noMatch }`.
`chips` = the **understood context** (one per SessionContext signal); removing a chip
becomes an exclusion → a refinement. `diff` = the re-rank delta vs the previous turn.

### `DiscoveryResult` — one ranked item (`src/types/index.ts`)
`{ product: Product, matchExplanation: string, relevanceScore: number }`. The
`matchExplanation` ("This jacket reads smart casual — in navy.") is built by
`explain()` and is **the hero of the card**.

---

## 3. The models (AI tiers)

Today the live path is **Tier 0 only**. The reach for "let's call an LLM" is
deliberately resisted (see the `mise-tiered-ai` skill); climb from deterministic.

| Tier | What | Where | Status |
|---|---|---|---|
| **Tier 0 — deterministic** | the turn parser, the prefilter score, the soft situation scorer, the assistant `summary`, the per-product `explain` | `session.ts`, `prefilter.ts`, `situation-match.ts`, `engine.ts` | **LIVE — this is the whole conversation today** |
| Embedder (not an LLM) | `all-MiniLM-L6-v2`, 384-dim, in-process via `@xenova/transformers` | `embedder.ts` (used by `retrieve.ts`) | LIVE, only when `DISCOVERY_RETRIEVAL=vector`. Semantic *retrieval*, not generation. |
| Vision (offline, not in the request path) | **Claude Haiku** reads each product photo → attributes | `src/lib/enrichment/vision/enrich.ts` | LIVE as **catalogue prep**, not part of a turn |
| **Tier 1 — LLM comprehension + generation** | free text → validated context patch (`parse-llm.ts`); re-voice the spoken prose (`generate-llm.ts`) | wired into `/api/discover`, opt-in via `DISCOVERY_PARSER` / `DISCOVERY_GENERATION` (deepseek \| haiku \| openai) | **LIVE (opt-in)** — gated per-turn by the complexity gate (`escalate.ts`): simple turns never call an LLM |
| **Layer 2 — grounding verifier** | deterministic gate on Tier-1 prose: rejects any rephrase naming an unshown product or claiming an action Intently can't perform (`verify.ts`, extending `faithful()`) | `/api/discover`, always on when generation runs | **LIVE** — replaced the never-built "Claude Sonnet verifier" design target |

The scripted client-side mode (`NEXT_PUBLIC_AI_MODE=scripted`) was **removed
2026-07-15** — `/api/discover` is the sole path, live-only. The deterministic
engine remains the base and universal fallback: any LLM failure, budget
exhaustion, or grounding rejection keeps the engine's template.

---

## 4. Knobs (env + data)

| knob | values | effect |
|---|---|---|
| `DISCOVERY_PARSER` | unset (default) / `deepseek` / `haiku` / `openai` | Tier-1 comprehension provider; unset = regex parser only |
| `DISCOVERY_GENERATION` | unset (default) / `deepseek` / `haiku` / `openai` | Tier-1 re-voicer; unset = deterministic templates |
| `DISCOVERY_OPENAI_MODEL` | `gpt-5.4-nano` (default) | OpenAI model for the `openai` provider |
| `DISCOVERY_ESCALATE_MINWORDS` | `8` (default) | complexity gate: word count at which a turn counts as long |
| `DISCOVERY_RETRIEVAL` | `deterministic` (default) / `vector` | candidate set: whole catalogue vs MiniLM + VectorStore top-k |
| `DISCOVERY_SITUATION` | `off` (default) / `on` | apply the soft situation bias (curator-tunable profiles) |
| `PIM_SOURCE` | `intently-catalog` / `medusa` / `kaggle` | where vector candidates (and the plugin catalogue) come from |
| `NEXT_PUBLIC_CATALOG` | unset / `vision` | swaps the standalone catalogue to the 292-photo vision set |
| `NEXT_PUBLIC_BASE_PATH` | unset / `/discover` | plugin mode (embed in the Medusa storefront; shared cart) |

**Situation profiles** (`src/lib/discovery/situation-profiles.json` ⊕ runtime overrides):
per-situation `weights` (formality/occasion/garment/style/season/material, 0–100) and
`emphasis` (target formality, preferred garments/occasions/styles/seasons/materials).
The **embed text** (`enrich-text.ts`) is the biggest lever on *retrieval* quality;
the **parser** is the biggest lever on *comprehension* quality.

---

## 5. Handoff — where to refine the conversation (ranked by leverage)

1. **The parser (`session.ts`) — highest leverage.** It's keyword/regex, so novel
   phrasing slips through ("something for a rainy festival weekend" → mostly empty
   context). This is the natural first **Tier-1 (DeepSeek)** job: query →
   structured `SessionContext`, with the regex parser kept as the validator/fallback
   (Tier-0 between the model and the engine). Don't trust raw model JSON — validate
   against the `SessionContext` shape.
2. **The assistant message + the "why" lines** (`summary` / `explain` in `engine.ts`).
   Templated and a little stiff. Candidate for **Tier-1** generation with a
   **Tier-2 (Claude)** verify-or-regenerate gate (cheap pass/fail: does the "why"
   only claim attributes the product actually has? `explain` already enforces this
   deterministically — keep that contract).
3. **A re-ranker over the vector candidates** (`/api/discover`, vector path). LLM
   re-rank top-k for situational nuance the cosine score misses — **Tier-2**, behind
   the deterministic order as fallback.
4. **Clarifying follow-ups.** `DiscoverTurn.followUp` exists but is barely used. A
   conversational clarifier ("indoor or outdoor wedding?") would deepen the
   "conversation" framing — generate the question, fold the answer through the same
   `updateSessionContext` path.
5. **Multi-turn memory.** Today it's `SessionContext` only (occasion/season/… + lists),
   not message history — deliberately lean. If you want references like "the second
   one, but warmer", you'll need light item-level memory in the turn loop.

**Guardrails to keep while refining:** the single `/api/discover` contract; the
complete scripted/offline fallback; deterministic-first (climb tiers only when they
earn it); user `exclusions` stay the only **hard** filter (everything else, incl. the
situation bias, only re-orders).

---

## 6. File map

| file | role |
|---|---|
| `src/app/next/NextExperience.tsx` | the overlay: turn loop, optimistic UI, chips, re-rank diff, cart |
| `src/app/next/live.ts` | `liveDiscover` → `/api/discover`; maps the response to a `DiscoverTurn` |
| `src/app/next/scripted.ts` | the no-key offline turn (`discoverFirst`) + the overlay view-model types |
| `src/app/api/discover/route.ts` | the seam: retrieval branch + situation profiles → engine |
| `src/lib/discovery/session.ts` | the **parser** — text → `SessionContext` |
| `src/lib/discovery/prefilter.ts` | hard exclusions + the 0..1 relevance score |
| `src/lib/discovery/situation-match.ts` | the soft, weighted situation scorer (never excludes) |
| `src/lib/discovery/engine.ts` | compose: parse → filter → bias → diversify → explain → message |
| `src/lib/discovery/retrieve.ts` | vector retrieval bridge (MiniLM + VectorStore), opt-in |
| `src/hooks/useDiscover.ts` | the river's adapter to the same engine (same contract) |
