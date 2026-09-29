# Analytics — plan & spec

**Status:** Phase 0 + Phase 1 SHIPPED (local) 2026-07-16 · Phase 2 (Supabase) pending cloud merge
**Audience:** product/catalog managers (Intently's primary users) — live at `/admin/analytics`.

> **What shipped 2026-07-16** (this doc was the plan; the build followed it):
> - **Phase 0 instrumentation** — `src/lib/analytics/events.ts` (EventSink seam, local JSONL at
>   `.enrichment/events/events.jsonl`, env-overridable via `INTENTLY_EVENTS_DIR` for hermetic tests);
>   token capture via a usage meter threaded through `llm-client.ts` (all three providers read the
>   `usage` block now); `/api/discover` emits a turn event per request; `/api/analytics/track`
>   carries add-to-cart from BOTH modes (the Medusa `/api/cart` POST only happens embedded);
>   anonymous session ids minted client-side in `NextExperience.tsx` (sessionStorage, no PII).
> - **Phase 1 surface** — `/admin/analytics` with the three tabs below, range picker (reused
>   `RangePicker.tsx`), every metric documented in-place (what / how / why), nav link enabled.
> - **Costs** — per-1M price table in `events.ts`: OpenAI verified list price; DeepSeek/Haiku
>   **estimates** (env-overridable `ANALYTICS_PRICE_*`), flagged in the UI. Tokens are exact.
> - **Demo data** — `node scripts/seed-analytics.mjs` (synthetic, labeled; delete the JSONL to reset).
> - **Phase 2 target** — migration `0012_analytics_events.sql` written (turn + cart tables WITH
>   token/cost columns), **not applied**; the Supabase EventSink swap happens at cloud merge.
> - Deviations from the plan: session ids are minted in `NextExperience` (not a store slice — the
>   river store isn't the live UI); cart events go through the new track endpoint rather than the
>   Medusa route so standalone mode is covered too.

---

## Context

The Studio's **Analytics** nav is a disabled placeholder ("Coming soon — behavioural metrics arrive with a live customer", `AdminNav.tsx`). It's disabled for a real reason, and this plan's central honest finding is:

> **Nothing is instrumented today.** There is no event pipeline. Sessions, turns, cart adds, and LLM calls are all in-memory or fire-and-forget — none are recorded. The Supabase tables that anticipate analytics (`recommendation_events`, `chip_events`, `ai_telemetry_events`, migrations 0003/0006/0007) are **schema-only with zero writers**, and even they have **no token or cost columns**. The LLM client (`llm-client.ts`) reads each provider's reply content and **discards the `usage` block** — so we currently cannot know what a turn cost.

So this is a two-part plan: **Phase 0 instruments** (the prerequisite nobody can skip), then **Phase 1 builds the three analytics sections** the PM sees. Attempting the dashboard without Phase 0 produces empty charts.

The goal: give a catalog manager one place that answers three questions — *how is the store doing, how is the AI conversation doing, and what is it costing me* — with the middle and third being Intently's differentiators, not something a generic store analytics tool provides.

---

## What matters — the metric analysis

### A. Standard ecommerce analytics ("table stakes")

The universal funnel, instrumented as drop-off so "where users left" is a first-class answer:

```
sessions → engaged (≥1 query) → results shown → product clicked
        → add-to-cart → checkout started → purchase
```

- **Conversion funnel + exit points** — count and % at each step; the largest step-to-step drop is "where users leave." Also: exit-without-a-query (bounce), exit-after-N-turns.
- **AOV** (average order value) and **items per cart/order**.
- **Cart abandonment** — carts created vs checkouts vs purchases.
- **Where cart additions happened** — the surface/step each add fired from: a first reveal, a refinement, or the outfit-completion/companion rail; plus catalog (fashion/outdoor), product, category.
- **Top queries / zero-result queries** — demand signal + catalogue gaps.
- **Top products / categories**, fashion vs outdoor split.
- **New vs returning** — *flagged as Phase-2*: Phase-1 is anonymous (no identity), so this needs the account layer.

### B. Intently-specific analytics (the differentiator — conversation + LLM)

This is the section a generic analytics tool can't produce, and where the product's value shows. Emphasis on conversation and LLM behaviour:

- **Escalation rate** — % of turns that invoked an LLM vs stayed deterministic (the complexity gate). The single most important operating number: it drives both quality and cost.
- **Conversation depth** — turns-per-session distribution, `revealCount`, consultation questions asked vs answered before the reveal.
- **Consultation effectiveness** — does a blocking ask (ask-before-offer) correlate with higher add-to-cart than a direct reveal? Answer-rate: tapped option vs typed-past vs abandoned.
- **LLM quality gates** — how often re-voiced prose was **accepted vs rejected** by the faithfulness + grounding gates. Grounding rejections are effectively *prevented over-promises* — a safety metric worth surfacing prominently ("N times we stopped the AI claiming a product we don't have").
- **Companion / "complete the look" attach rate** — how often the upsell rail converts (ties to the cart/upsell workstream).
- **Refinement behaviour** — how often shoppers refine ("more formal", "nothing floral"), which chips, re-rank depth.
- **Comprehension quality** — parse-patch richness, exclusions applied, catalog-routing correctness, per-situation (occasion/activity) conversion.

### C. Budget analytics (explicit ask)

- **Cost per user** (per session) = LLM spend ÷ sessions; **cost per turn**; **cost per escalated turn**; **cost per conversion** (the AI's CAC).
- **Spend by provider** (deepseek / haiku / openai) **and by stage** (parse / generation).
- **Rolling burn rate — a month back and a month forward**: trailing 28-day actuals as a daily series, plus a forward 28-day projection from the current escalation-rate × volume × per-token price model. This is the "am I about to blow the budget" view.
- **Budget-cap utilisation** — daily calls vs `DISCOVERY_LLM_DAILY_CAP` headroom (already counted by `guardrails.ts`, just not charted).
- **Effective-cost identity** (from the model-bench work): `cost ≈ per-token price × tokens/turn × escalation rate × volume`. The dashboard shows each factor so a PM can see *why* the bill moves — e.g. lowering the complexity threshold raises escalation rate raises cost.

**Prerequisite for the entire C section:** token capture. It does not exist yet.

---

## The three sections (what the PM sees)

Turn the disabled nav item into a live `/admin/analytics` area with three tabs, reusing the Studio's existing aggregation trio (`tally()` + `KEYS` + `BarPanel` from `CatalogClient.tsx`) and the already-generalised `RangePicker.tsx`:

1. **Commerce** — funnel + exit points, AOV, items/cart, cart-add-by-surface, top & zero-result queries, top products/categories, fashion vs outdoor.
2. **Conversation** (Intently-specific) — escalation rate, turns/session, consultation answer-rate + its conversion lift, grounding/faithfulness rejection counts, companion attach rate, refine behaviour, per-situation conversion.
3. **Budget** — cost/user, cost/turn, cost/conversion, spend by provider & stage, the rolling 28-day-back + 28-day-forward burn chart, cap utilisation.

---

## Architecture / approach

### Phase 0 — Instrumentation (the unskippable prerequisite)

1. **Capture LLM usage.** In `llm-client.ts`, read the `usage` block each provider already returns (OpenAI/DeepSeek `usage.prompt_tokens`/`completion_tokens`; Anthropic `usage.input_tokens`/`output_tokens`) and return it alongside content. Map to cost with a per-provider price table (OpenAI known: nano $0.20/$1.25 per 1M, cached $0.02; DeepSeek/Haiku prices to be filled in).
2. **Mint a session id.** None exists today — a client-generated anonymous id stored in the session slice, sent with each `/api/discover` call.
3. **Emit two event types** behind one typed `EventSink` interface (mirroring the `vector-store-factory` swap pattern so storage is pluggable):
   - **turn event** — `sessionId, turn#, catalog, escalated, parseProvider/model, genProvider/model, tokensIn/out, costUsd, latencyMs, parseAccepted, genAccepted, groundingVerdict, resultCount, questionAsked, questionAnswered`.
   - **cart event** — `sessionId, productId, category, catalog, surface(reveal|refine|companion), valueUsd` — emitted at both add-to-cart sites (`NextExperience.tsx` → Medusa POST, and the Zustand `addToCart`/`addToCartSilent`).
4. **Storage (Phase-1 local-first):** a file-backed JSONL event store (`.enrichment/events/*.jsonl`) mirroring the existing local runtime-override/log pattern — gitignored, single-replica, zero-infra. `EventSink` interface lets Phase-2 swap to Supabase without touching emit sites.

### Phase 1 — the analytics surface

- New `/admin/analytics` route + client, three tabs (above). Aggregation reuses `tally()`/`BarPanel`/`RangePicker`. Reads the local event store; all compute isomorphic/pure like `insights.ts`.
- Flip the `AdminNav.tsx` "Analytics" span into a live `Link`.

### Phase 2 — durable + real

- Apply the Supabase migrations, **extended with the missing token/cost columns** (0007 tracks tier/duration/provider but not tokens or spend). Swap `EventSink` to the Postgres impl.
- Add identity (the parked account layer) for new-vs-returning and per-user LTV.

---

## Non-goals

- Not a general BI tool, not real-time streaming, not per-user PII — Phase-1 uses anonymous session ids only (privacy-preserving and matches the local-first stance).
- Not replacing the Studio's **catalogue** insights — those aggregate the static catalogue (a different question) and stay where they are.
- Not building attribution across external ad channels — Intently sees the on-site funnel only.

---

## Open questions (need a decision before building)

1. **Which cart is canonical for AOV/conversion?** The live plugin path posts to the host's **Medusa** cart (fire-and-forget); the river's Zustand cart is transient. Critically, **purchase/checkout completion is owned by the host storefront and is not reported back to Intently today** — so *conversion (purchase)* is currently unobservable from our side. Options: (a) a Medusa order webhook into the event sink, (b) treat add-to-cart as the terminal conversion proxy for Phase-1 and label it honestly. — *product + eng*
2. **Per-provider token prices** — need exact DeepSeek v4-flash and Claude Haiku rates to complete the cost model (OpenAI nano is known). — *eng*
3. **Local event store vs jump straight to Supabase** — the local JSONL keeps Phase-1 zero-infra but won't persist on Vercel (read-only FS) or across replicas; Supabase is durable but means provisioning now. — *eng / infra*
4. **Prior art:** an earlier admin-analytics design exists at `~/.claude/plans/composed-herding-glacier.md` ("Phase 1c of the admin-panel plan") and left `RangePicker.tsx` behind. Reconcile with it before building. — *eng*

---

## Reuse vs build (so estimates are honest)

| Need | Reuse | Build new |
|---|---|---|
| Histogram / distribution compute | `tally()` + `KEYS` + `BarPanel` (`CatalogClient.tsx`), `insights.ts` | event-sourced variants (current ones aggregate the static catalogue) |
| Date-range UI | `RangePicker.tsx` (already generalised) | — |
| LLM call counts / cap headroom | `takeLlmBudget` / `llmBudgetUsedToday` (`guardrails.ts`) | token + cost capture — **`llm-client.ts` discards `usage`** |
| Durable event tables | migrations 0003/0006/0007 (schema) | **all writers + readers (none exist)** + token/cost columns |
| Session/turn signal | `SessionContext.turnCount`/`revealCount`/`intent` | session-id minting + event emit |
| Cart signal | `addToCart`/`addToCartSilent`, `/api/cart` POST, `cartTotal` | cart event emit + purchase report-back |
| Server logging | `log.ts` | it's a debug log, not queryable — analytics needs the event store |

---

## Verification (when built)

- Phase 0: a scripted discovery session produces N turn-events and cart-events in the local store with non-zero token/cost fields; escalation flag matches the complexity gate; grounding-rejection increments when a forced over-promise is fed in.
- Phase 1: each tab renders against a seeded event fixture; the burn chart's trailing series sums to the same total as summing raw events; cost/user = total cost ÷ distinct session ids.
