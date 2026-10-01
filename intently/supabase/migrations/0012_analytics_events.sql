-- ─────────────────────────────────────────────────────────────────
-- 0012 · Analytics events — the durable home for the Phase-1 local
-- JSONL event stream (src/lib/analytics/events.ts).
--
-- APPLIED to intently-demo (<supabase-project-ref>) 2026-07-16. Phase-1
-- analytics still runs on the local file sink by default; the Supabase
-- EventSink swaps in via env (emit sites unchanged). Mirrors the
-- TurnEvent / CartEvent shapes 1:1 — if you change those types, change
-- this file in the same commit.
--
-- Unlike the older 0007 ai_telemetry_events (tier/duration only), this
-- carries TOKENS and COST — the columns the budget analytics need.
-- ─────────────────────────────────────────────────────────────────

create table if not exists analytics_turn_events (
  id          bigint generated always as identity primary key,
  ts          timestamptz not null default now(),
  session_id  text not null,
  turn        int  not null default 0,
  query       text not null,            -- sanitized, ≤280 chars (route-capped)
  query_chars int  not null,
  escalated   boolean not null,
  answered    boolean not null,
  result_count int not null,
  question_asked boolean not null,
  latency_ms  int not null,
  -- Tier-1 comprehension (null when the stage didn't run)
  parse_provider   text,
  parse_model      text,
  parse_tokens_in  int,
  parse_tokens_out int,
  parse_cost_usd   numeric(12, 8),
  parse_ok         boolean,
  -- Tier-1 re-voicing (null when the stage didn't run)
  gen_provider     text,
  gen_model        text,
  gen_tokens_in    int,
  gen_tokens_out   int,
  gen_cost_usd     numeric(12, 8),
  gen_accepted     boolean,
  gen_grounding_rejected boolean
);

create index if not exists analytics_turn_events_ts_idx      on analytics_turn_events (ts);
create index if not exists analytics_turn_events_session_idx on analytics_turn_events (session_id);

create table if not exists analytics_cart_events (
  id         bigint generated always as identity primary key,
  ts         timestamptz not null default now(),
  session_id text not null,
  product_id text not null,
  title      text not null default '',
  surface    text not null default 'unknown'
             check (surface in ('reveal', 'companion', 'unknown'))
);

create index if not exists analytics_cart_events_ts_idx      on analytics_cart_events (ts);
create index if not exists analytics_cart_events_session_idx on analytics_cart_events (session_id);

-- RLS: server-side writers/readers only (service role); no anon access.
alter table analytics_turn_events enable row level security;
alter table analytics_cart_events enable row level security;
