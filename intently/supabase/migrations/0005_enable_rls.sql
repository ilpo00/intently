-- ─────────────────────────────────────────────────────────────────
-- Intently · 0005_enable_rls
--
-- The actual security flip. v0.1.x shipped with policies WRITTEN but
-- RLS DISABLED (see 0002_disable_rls_v01x.sql and the commented blocks
-- at the bottom of 0001 / 0003) — honest about the demo posture. v0.2
-- lands real auth, so this migration turns RLS on for every user-scoped
-- table and applies the policies that were drafted earlier.
--
-- After this migration:
--   - The anon key (which ships in the JS bundle, NEXT_PUBLIC_*) can
--     no longer read another user's orders / chat / etc.
--   - Catalogue table (products) stays publicly readable — needed for
--     the anonymous river. Writes go through the service_role key in
--     scripts/seed-supabase.ts.
--   - All policies cast auth.uid() to text — Supabase Auth returns a
--     uuid but our users.id column is text (kept agnostic across auth
--     providers per the v0.1.x decision).
--
-- Apply via Supabase Dashboard → SQL Editor, or `supabase db push`,
-- or the Supabase MCP `apply_migration` tool.
--
-- Wrapped in a single transaction so any failure mid-way (a missing
-- table, a syntax error, a policy collision) rolls back the whole
-- thing rather than leaving the schema in a partial-RLS state
-- (some tables locked down, no policies in place, signed-in users
-- unable to read their own rows). DDL is transactional in Postgres.
-- ─────────────────────────────────────────────────────────────────

begin;

-- ── User-scoped tables ───────────────────────────────────────────
alter table public.users                  enable row level security;
alter table public.orders                 enable row level security;
alter table public.order_items            enable row level security;
alter table public.taste_signals          enable row level security;
alter table public.chat_messages          enable row level security;
alter table public.recommendation_events  enable row level security;

-- ── Policies — own row only ─────────────────────────────────────
-- Drop any same-named policies first so this migration is re-runnable
-- against a project where someone hand-applied an earlier draft.

drop policy if exists "own user row"      on public.users;
drop policy if exists "own orders"        on public.orders;
drop policy if exists "own order items"   on public.order_items;
drop policy if exists "own taste"         on public.taste_signals;
drop policy if exists "own chat"          on public.chat_messages;
drop policy if exists "own rec events"    on public.recommendation_events;

create policy "own user row"
  on public.users for all
  using       (id = auth.uid()::text)
  with check  (id = auth.uid()::text);

create policy "own orders"
  on public.orders for all
  using       (user_id = auth.uid()::text)
  with check  (user_id = auth.uid()::text);

-- order_items has no user_id of its own; it joins through orders.user_id.
create policy "own order items"
  on public.order_items for all
  using       (order_id in (select id from public.orders where user_id = auth.uid()::text))
  with check  (order_id in (select id from public.orders where user_id = auth.uid()::text));

create policy "own taste"
  on public.taste_signals for all
  using       (user_id = auth.uid()::text)
  with check  (user_id = auth.uid()::text);

create policy "own chat"
  on public.chat_messages for all
  using       (user_id = auth.uid()::text)
  with check  (user_id = auth.uid()::text);

create policy "own rec events"
  on public.recommendation_events for all
  using       (user_id = auth.uid()::text)
  with check  (user_id = auth.uid()::text);

-- ── Catalogue tables — public read, no client writes ────────────
-- The anonymous river needs to render products. Without this policy
-- RLS would silently filter the catalogue down to zero rows for anon
-- callers.
alter table public.products enable row level security;

drop policy if exists "read products" on public.products;

create policy "read products"
  on public.products for select
  using (true);

-- No insert/update/delete policies on products — the only writer is
-- intently/scripts/seed-supabase.ts which uses the service_role key.
-- service_role bypasses RLS entirely, so no explicit policy is needed
-- for its writes.

commit;
