---
type: concept
status: stable
updated: 2026-07-16
sources: []
tags: [analytics, events, budget, commerce, conversation, studio]
---

# analytics

**Three lenses over the discovery conversation — commerce, conversation, budget — computed from a
single event stream Intently emits itself.** Live at `/admin/analytics` (nav enabled 2026-07-16);
plan + shipped record in `intently/docs/analytics-plan.md`.

## The shape

```
shopper turn ─▶ /api/discover ──── emits TurnEvent ──┐
add-to-cart ─▶ /api/analytics/track ─ emits CartEvent ┤─▶ EventSink (local JSONL)
                                                      │        .enrichment/events/events.jsonl
/admin/analytics ◀── aggregate.ts (pure, per load) ◀──┘
```

- **Two event types only** (deliberate minimalism): a `TurnEvent` per discovery request — session id,
  query, escalation verdict, per-stage provider/model/tokens/cost, faithfulness+grounding verdicts,
  latency — and a `CartEvent` per add (product + WHICH surface: main reveal vs companion rail).
- **EventSink seam** (`src/lib/analytics/events.ts`): local JSONL in Phase-1, Supabase
  (`0012_analytics_events.sql`, written not applied) at cloud merge — emit sites never change.
  The vector-store-factory pattern again.
- **Anonymous by design:** session ids are client-minted random values in sessionStorage
  (`NextExperience.tsx`); no identity, no PII. New-vs-returning needs the parked account layer.
- **Fire-and-forget:** `emitEvent` never throws; an analytics failure can't break a shopper turn.

## Non-obvious decisions

- **Token capture is a mutable meter, not a return-type change.** `llm-client.ts`'s house contract
  is "never throw, return content-or-null"; every caller relies on it. Adding `usage` to the return
  would touch them all — instead an optional `meter` in opts is ADDED TO by each provider fn
  (all three providers' `usage` blocks were previously discarded). Callers that don't care pass nothing.
- **Cart events bypass the Medusa cart route.** `/api/cart` POST only fires when EMBEDDED; standalone
  adds are local state. The dedicated `/api/analytics/track` endpoint catches both modes — otherwise
  local-dev analytics would show zero carts forever.
- **Purchase is honestly absent.** Checkout belongs to the host storefront; the funnel's last step
  renders "not instrumented" rather than a fake number. Add-to-cart is the labeled proxy conversion.
  (Fix path: a Medusa order webhook into the sink — analytics-plan.md open question 1.)
- **Cost precision is tiered and labeled.** Tokens are exact (from provider responses). Prices:
  OpenAI verified list; DeepSeek/Haiku estimated defaults (`ANALYTICS_PRICE_*` env overrides),
  flagged "≈" in the UI. The same stance as vision-enrich's RATE comment: tokens are the hard number.
- **Hermeticity:** the sink path honors `INTENTLY_EVENTS_DIR`; `tests/setup.ts` points it at a temp
  dir so route tests (which now emit) never touch developer-local events — the lesson from the
  situations non-hermeticity incident (observation #24), applied at birth this time.

## The metrics (each documented in-page: what · how · why)

- **Commerce** — session funnel with explicit exit points (sessions → saw results → added to cart →
  purchase*), add-to-carts by surface (the companion share IS the outfit-completion attach rate),
  items/cart-session, top queries, zero-result queries (each one a failed shopper — should be ~empty),
  top added products.
- **Conversation** (Intently-specific) — escalation rate (the operating number the complexity gate
  controls), LLM-turn rate (what the bill actually follows), turns/session, question answer-rate
  (consultation health), re-voice acceptance, grounding rejections (prevented over-promises — the
  safety layer's visible value), latency p50/p95.
- **Budget** — spend in range, by provider and by stage; cost/turn vs cost/escalated-turn (the gate's
  savings made visible); cost/session ("cost per user"), cost/cart-add (the AI's CAC); daily series +
  **projected month** = trailing-7-day daily average × 28 (a pace projection, deliberately simple).

## Related

- [[tiered-conversation]] — the pipeline the turn events instrument
- [[enrichment-studio]] — the Studio shell analytics lives beside
- `intently/docs/analytics-plan.md` — full plan, shipped record, open questions
