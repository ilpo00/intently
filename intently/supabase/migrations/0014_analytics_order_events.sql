-- ─────────────────────────────────────────────────────────────────
-- 0014 · analytics_order_events — closes the commerce loop (brainstorm #1).
-- One row per completed order reported by the host storefront's webhook
-- (Medusa `order.placed` → POST /api/analytics/order). Lets the funnel's
-- "Purchased" step stop saying "not instrumented".
--
-- session_id is nullable: attribution exists only when the storefront
-- carries the Intently session id through checkout (cart metadata);
-- item-level product ids allow a secondary product-match attribution.
-- ─────────────────────────────────────────────────────────────────

create table if not exists analytics_order_events (
  id         bigint generated always as identity primary key,
  ts         timestamptz not null default now(),
  order_id   text not null unique,
  session_id text,
  total_usd  numeric(12, 2),
  items      jsonb not null default '[]'::jsonb, -- [{productId, title, quantity, unitUsd}]
  source     text not null default 'medusa'
);

create index if not exists analytics_order_events_ts_idx      on analytics_order_events (ts);
create index if not exists analytics_order_events_session_idx on analytics_order_events (session_id);

alter table analytics_order_events enable row level security;
