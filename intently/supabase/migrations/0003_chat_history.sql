-- ─────────────────────────────────────────────────────────────────
-- Intently · 0003_chat_history
-- Phase 3 persistence: chat transcript + recommendation events.
--
-- Two tables:
--   * chat_messages          — every message (user + assistant) per session.
--                              Content is opaque text + JSONB tool calls so the
--                              streaming shape from /api/chat is preserved
--                              verbatim and the analytics path stays decoupled
--                              from the AI-response renderer.
--   * recommendation_events  — one row per asset that the AI surfaced in a
--                              tool call. clicked_at / ordered_at close the
--                              conversion loop — the join target for "which
--                              recommendations actually converted."
--
-- Both tables FK against users(id). The session_id column is opaque text
-- here (whatever /api/chat/session minted); we keep it lightweight rather
-- than a separate sessions table since the warmup cache is in-memory today.
--
-- RLS direction is committed (commented) at the bottom matching the 0001
-- pattern. v0.1.x ships disabled; v0.2 enables alongside the auth migration.
-- ─────────────────────────────────────────────────────────────────

-- ─── Chat transcript ───────────────────────────────────────────
create table chat_messages (
  id              text primary key,                  -- ulid (or simple sortable id)
  user_id         text not null references users(id) on delete cascade,
  session_id      text not null,                     -- from POST /api/chat/session
  role            text not null
                  check (role in ('user', 'assistant')),
  content         text not null,                     -- visible prose; assistant rows carry the canonical final text
  tool_calls      jsonb,                             -- assistant-only; array of {name, input}
  resolved_by_tier text,                             -- assistant-only telemetry: tier-2-validator / tier-3-haiku / tier-4-sonnet
  created_at      timestamptz not null default now()
);

-- Query patterns served by these indexes:
--   1. listChatMessages(userId, sessionId) — replay a single conversation
--   2. listChatMessages(userId)            — user-wide history
create index chat_messages_session_idx
  on chat_messages (user_id, session_id, created_at);

create index chat_messages_user_idx
  on chat_messages (user_id, created_at desc);

-- ─── Recommendation events ─────────────────────────────────────
-- Written by /api/chat after the orchestrator returns. One row per tool
-- call that surfaces catalog assets — cite_recipe writes one row (single
-- recipeId), recommend_products writes one row per productId batch (the
-- tool call's whole array goes into asset_ids[]).
--
-- message_id can be null when we haven't started writing chat_messages
-- atomically with rec events (today they're both written from the same
-- route handler so the FK is satisfiable; left nullable to keep the
-- migration safe to apply mid-flight).
create table recommendation_events (
  id              text primary key,                  -- ulid
  user_id         text not null references users(id) on delete cascade,
  session_id      text not null,
  message_id      text references chat_messages(id) on delete cascade,
  tool_name       text not null
                  check (tool_name in (
                    'recommend_products', 'cite_recipe',
                    'ask_clarifying',     'show_taste_grid'
                  )),
  -- Composite asset ids (`product:gyuto-240`, `recipe:tonkotsu-ramen`)
  -- per src/lib/asset.ts. Empty array is valid for ask_clarifying /
  -- show_taste_grid where there's no asset to point at — those rows still
  -- carry useful "which tool fired when" telemetry.
  asset_ids       text[] not null default '{}'::text[],
  created_at      timestamptz not null default now(),
  -- Closing the loop:
  --   clicked_at — user opened the product detail / recipe expansion
  --   ordered_at — asset_id ended up in an order
  -- Both nullable; updated post-hoc when the corresponding UI event fires.
  clicked_at      timestamptz,
  ordered_at      timestamptz
);

create index recommendation_events_session_idx
  on recommendation_events (user_id, session_id, created_at);

create index recommendation_events_user_idx
  on recommendation_events (user_id, created_at desc);

-- Useful for the conversion-rate analytic ("of N rec events in the
-- last week, how many had clicked_at set?").
create index recommendation_events_conversion_idx
  on recommendation_events (user_id, created_at)
  where clicked_at is not null;

-- ─── Disable RLS for v0.1.x ─────────────────────────────────────
-- Matches the 0002 pattern: Supabase auto-enables RLS on every new public
-- table, which locks out the anon key without providing real security
-- (no real users yet). v0.2 re-enables alongside the auth migration.
alter table public.chat_messages         disable row level security;
alter table public.recommendation_events disable row level security;

-- ─────────────────────────────────────────────────────────────────
-- RLS direction (committed but disabled in v0.1.x)
-- Re-enable + apply in v0.2 alongside auth. Same `auth.jwt() ->> 'sub'`
-- pattern as 0001 for cross-provider compatibility (Supabase Auth uuid,
-- Clerk text, etc).
-- ─────────────────────────────────────────────────────────────────
--
-- alter table chat_messages         enable row level security;
-- alter table recommendation_events enable row level security;
--
-- create policy "own chat messages"
--   on chat_messages for all
--   using (user_id = auth.jwt() ->> 'sub')
--   with check (user_id = auth.jwt() ->> 'sub');
--
-- create policy "own recommendation events"
--   on recommendation_events for all
--   using (user_id = auth.jwt() ->> 'sub')
--   with check (user_id = auth.jwt() ->> 'sub');
