-- ─────────────────────────────────────────────────────────────────
-- Intently · 0001_account_backbone
-- v0.1.x foundational tables for the account layer before auth lands.
--
-- Scope:
--   * users (singleton 'demo-user' until v0.2 plugs in real auth)
--   * products — read-only mirror; data.ts stays the source of truth
--     for the catalogue in v0.1.x. Mirrored here so orders can FK
--     against it.
--   * orders, order_items, taste_signals — authoritative mutable rows
--     for user-scoped data.
--
-- Historical note: this migration originally also created `recipes`
-- and `library_items` tables — MISE-era artefacts removed when the
-- project pivoted to Intently. See 0011_drop_recipes_library.sql for
-- the forward migration that cleans them up on already-applied
-- projects. The CREATE statements were removed from this file so
-- fresh setups never have them in the first place.
--
-- IDs are `text` everywhere so we stay auth-provider-agnostic
-- (Supabase Auth uuid, Clerk text, or roll-your-own all stay open).
--
-- RLS: policies are written below as comments. Enforcement flips on in
-- v0.2 alongside the auth migration. Doing the design now forces honest
-- "which row belongs to which user" thinking before users are real.
-- ─────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- ─── Identity ───────────────────────────────────────────────────
create table users (
  id            text primary key,
  display_name  text,
  created_at    timestamptz not null default now()
);

-- v0.1.x demo singleton. v0.2 migration re-keys rows onto auth-provider ids.
insert into users (id, display_name)
  values ('demo-user', 'Demo User')
  on conflict (id) do nothing;

-- ─── Catalogue mirror ──────────────────────────────────────────
-- Authoritative source remains src/lib/data.ts in v0.1.x. This table
-- exists purely as a FK target and to make the order-store work
-- without round-tripping through the in-memory catalogue. Re-seeded
-- by intently/scripts/seed-supabase.ts.
create table products (
  id           text primary key,             -- inner id, e.g. 'gyuto-240'
  name         text not null,
  price_cents  integer not null,
  payload      jsonb not null,               -- full Product row; opaque from SQL
  updated_at   timestamptz not null default now()
);

-- ─── Orders ────────────────────────────────────────────────────
-- Today's CheckoutSection.tsx has no persistent order — just a flag.
-- This is the audit trail.
create table orders (
  id              text primary key,            -- ulid
  user_id         text not null references users(id),
  placed_at       timestamptz not null default now(),
  subtotal_cents  integer not null,
  delivery_cents  integer not null,
  giftwrap_cents  integer not null,
  total_cents     integer not null,
  status          text not null default 'placed'
                  check (status in ('placed', 'fulfilled', 'cancelled', 'refunded'))
);

create index orders_user_placed_idx on orders (user_id, placed_at desc);

create table order_items (
  order_id     text not null references orders(id) on delete cascade,
  asset_id     text not null,                   -- composite id
  quantity     integer not null check (quantity > 0),
  unit_cents   integer not null,                -- price at time of order; immutable
  fulfillment  text not null
               check (fulfillment in ('physical', 'learning-path')),
  gift_note    text,
  primary key (order_id, asset_id)
);

-- ─── Taste signals ─────────────────────────────────────────────
-- Persists 12-grid 'love' / 'skip' marks across devices once auth lands.
create table taste_signals (
  user_id      text not null references users(id) on delete cascade,
  style_id     text not null,
  signal       text not null check (signal in ('love', 'skip', 'nope')),
  recorded_at  timestamptz not null default now(),
  primary key (user_id, style_id)
);

-- ─────────────────────────────────────────────────────────────────
-- RLS direction (committed but disabled in v0.1.x)
-- Uncomment + apply alongside auth in v0.2. Policies use `auth.jwt() ->> 'sub'`
-- so they work with Supabase Auth (uuid sub) and Clerk (text sub) alike.
-- ─────────────────────────────────────────────────────────────────
--
-- alter table orders         enable row level security;
-- alter table order_items    enable row level security;
-- alter table taste_signals  enable row level security;
--
-- create policy "own orders"
--   on orders for all
--   using (user_id = auth.jwt() ->> 'sub')
--   with check (user_id = auth.jwt() ->> 'sub');
--
-- create policy "own order items"
--   on order_items for all
--   using (
--     exists (select 1 from orders o
--             where o.id = order_items.order_id
--               and o.user_id = auth.jwt() ->> 'sub')
--   );
--
-- create policy "own taste signals"
--   on taste_signals for all
--   using (user_id = auth.jwt() ->> 'sub')
--   with check (user_id = auth.jwt() ->> 'sub');
--
-- products stay public-read (catalogue is not user-scoped).
