---
type: concept
status: stable
updated: 2026-05-22
sources: [you-are-a-lead-stateful-teapot, tiered-ai-architecture, account-backbone]
tags: [persistence, supabase, account-store, analytics, conversion-loop]
---

# chat-persistence

Phase 3 of the tiered AI path. Every `/api/chat` turn writes the user message, the assistant message, and one recommendation_event per tool call to the AccountStore. The two new Supabase tables live behind the same interface as library / orders / taste-signals so demo mode (localStorage) and Supabase mode share a single contract.

## Why an audit log

Three things become possible once we have it:

1. **Conversion loop.** The `recommendation_events` table carries `clicked_at` and `ordered_at` columns. When the user opens a product detail or completes an order, those columns get stamped. The join is the answer to *"of the recommendations the AI surfaced this week, how many converted?"* — feeds the editorial-weight tuning loop the ranker formula has been waiting for.
2. **Session replay.** `listChatMessages(userId, sessionId)` returns the whole conversation oldest-first. Powers the next-session "pick up where you left off" affordance (Phase 3.5) and the support-debugging path for "the AI told me X, can you check?".
3. **Eval against real traffic.** Phase 1c's grounding harness uses a static golden set. Once we have transcripts, the eval can replay actual conversations and grade the answers — far better signal than synthetic prompts.

## The contract — two tables

`chat_messages`:
```
id              text primary key      -- ulid-style sortable
user_id         text → users(id)
session_id      text                  -- opaque, from POST /api/chat/session
role            text                  -- 'user' | 'assistant'
content         text                  -- canonical prose (post-streaming)
tool_calls      jsonb                 -- assistant-only; array of {name, input}
resolved_by_tier text                 -- assistant-only telemetry
created_at      timestamptz
```

`recommendation_events`:
```
id              text primary key
user_id         text → users(id)
session_id      text
message_id      text → chat_messages(id)  -- nullable; FK to the assistant turn
tool_name       text                       -- one of the 4 tool names
asset_ids       text[]                     -- composite ids; empty for ask_clarifying / show_taste_grid
created_at      timestamptz
clicked_at      timestamptz                -- set when the user opens the product detail / recipe expansion
ordered_at      timestamptz                -- set when an order containing the asset is placed
```

Indexes match the access patterns: (user_id, session_id, created_at) for session replay and (user_id, created_at desc) for user-wide browse. A partial index on `clicked_at is not null` keeps the conversion-rate query cheap.

## Write path

`/api/chat` writes after the orchestrator returns and AFTER the user gets their response. The write is `void persistTurn(...)` — fire-and-forget, best-effort:

- **Failure swallowed** — a Supabase outage logs a WARN line and disappears. The user's chat experience must not depend on the audit log succeeding.
- **No latency tail** — awaiting persistence before responding would add the round-trip to every chat turn. The user already has their final text by the time we write.
- **Ordering** — user row is written before assistant row so `created_at` reflects causality even when both fall in the same millisecond.

### Requires NEXT_PUBLIC_DATA_MODE=supabase

`persistTurn` and `/api/chat/conversion` both run server-side. `LocalAccountStore` checks `typeof window !== 'undefined'` and silently no-ops when called from a Node process — its writes only land when the call originates in the browser. So in local mode:

- Every `persistTurn` call appears to succeed but writes nothing.
- `/api/chat/conversion` returns `totalEvents: 0` always.
- `markRecommendationClicked` / `markRecommendationOrdered` (which DO run client-side from the store and CheckoutSection) find no rec_event rows to stamp.

End-to-end, **the persistence + conversion loop is non-functional in local mode**. Local mode is the CI / offline-contributor demo path and is deprecated for new feature development. To exercise the persistence path locally, set `NEXT_PUBLIC_DATA_MODE=supabase` with valid keys.

Two alternative architectures were considered and rejected for this iteration:
1. Move `persistTurn` client-side (call from `useChat` after the SSE `final` event). Works in both modes; needs a new client-side analytics-query surface to replace the conversion endpoint.
2. Add a per-process in-memory `Map` fallback when `LocalAccountStore` runs server-side. Volatile across restarts but functional within a dev session.

Both are open; neither is on the current roadmap.

Each turn produces:
- 1 `chat_messages` row for the user message
- 1 `chat_messages` row for the assistant message (with `tool_calls` JSONB + `resolved_by_tier`)
- N `recommendation_events` rows, one per tool call. `recommend_products` carries the productId batch; `cite_recipe` carries one recipeId; `ask_clarifying` / `show_taste_grid` carry `asset_ids: []` (the row is still written so the conversion-rate denominator stays honest).

## AccountStore methods

```ts
appendChatMessage(userId, draft): Promise<ChatMessageRecord>
listChatMessages(userId, sessionId?): Promise<ChatMessageRecord[]>
recordRecommendationEvent(userId, draft): Promise<RecommendationEventRecord>
listRecommendationEvents(userId, sessionId?): Promise<RecommendationEventRecord[]>
```

Both reads support the optional `sessionId` scoping: scoped → oldest-first (for replay); unscoped → newest-first (for browse). Same shape in local and Supabase impls so the call site doesn't know which is active.

## Phase 3.5 — closing the conversion loop (shipped 2026-05-22)

The columns existed since 0003; this phase wires the UI to stamp them.

Server-side **inference** (not client-tracked event IDs): the client tells the AccountStore *"the user clicked this asset in this session"* or *"this order contained these assets,"* and the store finds the matching `recommendation_events` row to stamp. Two new interface methods:

```ts
markRecommendationClicked(userId, sessionId, assetId): Promise<void>
markRecommendationOrdered(userId, assetIds[]): Promise<void>
```

`markRecommendationClicked` is session-scoped — a click attributes to the conversation that actually surfaced it, not an unrelated earlier one. Picks the most recent un-stamped rec_event whose `asset_ids` contains the asset; no-op when the click came from the catalogue rather than a recommendation.

`markRecommendationOrdered` crosses session boundaries — a user can order something they saw in a previous chat. For each asset id in the order, stamps the most recent un-stamped rec_event. Idempotent.

**Wire shape:**
- `intently-store.ts` `selectAsset(asset)` — when a non-null asset is selected and an active chat session exists, fire `markRecommendationClicked`. The session id lives in `lib/ai/client-session.ts` (extracted out of `useChat` so the store can read it without an import cycle).
- `CheckoutSection.tsx` — after `createOrder` succeeds, fire `markRecommendationOrdered` with the order's asset ids.
- Both calls are fire-and-forget; analytics failures don't block UX.

**Read shape:** `GET /api/chat/conversion` returns the aggregate per-tool conversion rates. Sibling to `/budget` and `/telemetry`.

```
$ curl localhost:3000/api/chat/conversion | jq
{
  "userId": "demo-user",
  "totalEvents": 7,
  "totalClicked": 4,
  "totalOrdered": 3,
  "overallClickRatePct": 57.1,
  "overallOrderRatePct": 42.9,
  "perTool": [
    { "tool": "recommend_products", "events": 4, "clicked": 3, "ordered": 2,
      "clickRatePct": 75, "orderRatePct": 50 },
    { "tool": "cite_recipe", "events": 2, "clicked": 1, "ordered": 1,
      "clickRatePct": 50, "orderRatePct": 50 },
    { "tool": "ask_clarifying", "events": 1, "clicked": 0, "ordered": 0,
      "clickRatePct": 0, "orderRatePct": 0 }
  ]
}
```

Supports `?sinceMs=<unix-ms>` for time-windowed queries. The aggregation is in-memory (list-then-bucket); fine for v0.1.x demo, will swap to a server-side aggregation query at meaningful event volume.

## What's NOT in Phase 3.5

- **Session replay UI.** Data is there; surfacing it as "your previous conversations" is the next discrete chunk.
- **RLS enforcement.** Designed in the migration (committed but commented), disabled today same as 0002. Flips on with auth in v0.2.
- **Server-side aggregation query.** `GET /api/chat/conversion` aggregates in-memory after listing all rec events. Fine for the demo; will need a `select count(*) ... group by tool_name` push-down once event volume justifies it.

## Files

- `intently/supabase/migrations/0003_chat_history.sql` — schema
- `intently/src/types/supabase.ts` — generated Database types extended manually for the two new tables (regen after running `supabase gen types`)
- `intently/src/lib/account/account-store.ts` — interface + record types
- `intently/src/lib/account/account-store-local.ts` — localStorage impl (`intently.chat.v1` + `intently.rec-events.v1` keys)
- `intently/src/lib/account/account-store-supabase.ts` — Supabase impl
- `intently/src/app/api/chat/route.ts` — `persistTurn()` helper + fire-and-forget call sites
- `intently/src/hooks/useChat.ts` — sends `userId` in the request body
- `intently/src/tests/account-store-local.test.ts` — round-trip tests for chat + rec events
- `intently/src/tests/api/chat-persistence.test.ts` — route-level integration

## Related

- [[tiered-ai-architecture]] — the orchestrator whose output gets persisted
- [[deterministic-ranker]] — once enough conversion data accumulates, the editorial-weight component gets tuned from it
- [[supabase-over-medusa]] — the decision that made these tables cheap
- [[use-chat]] — sends `userId` in the request body so every turn is attributable
