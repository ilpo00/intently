-- ─────────────────────────────────────────────────────────────────
-- Intently · 0011_drop_recipes_library
--
-- Pivot cleanup. MISE's cooking-shaped data model carried two
-- tables that don't belong in Intently's fashion / outdoor
-- discovery scope:
--
--   * recipes        — cooking recipes catalogue mirror
--   * library_items  — user-owned "My Kitchen" tools
--
-- Both go away here. order_items.fulfillment loses the
-- 'digital-recipe' option since recipe purchases are no longer a
-- thing.
--
-- Forward-only and idempotent. Re-runnable without error. The
-- baseline migration 0001_account_backbone.sql is also being
-- updated in the same change so future fresh applies never create
-- these tables in the first place — this migration is the
-- equivalent for projects (like the dev Supabase) where 0001
-- already ran in its old form.
--
-- Wrapped in a transaction; partial application can't leave a
-- half-drained schema.
-- ─────────────────────────────────────────────────────────────────

begin;

-- ── 1. RLS policies on the doomed tables ─────────────────────────
-- Policies are owned by tables; dropping the table drops them. But
-- being explicit makes the intent grep-able and harmless when the
-- policy was never installed.
drop policy if exists "own library"  on public.library_items;
drop policy if exists "read recipes" on public.recipes;

-- ── 2. Indexes ───────────────────────────────────────────────────
drop index  if exists public.library_items_user_acquired_idx;

-- ── 3. Tables ────────────────────────────────────────────────────
-- CASCADE because library_items had an FK from users(id) and we
-- don't want a "depends on" error if any v0.2 work added more
-- FKs we forgot about.
drop table  if exists public.library_items cascade;
drop table  if exists public.recipes        cascade;

-- ── 4. order_items.fulfillment — drop the 'digital-recipe' value ─
-- The CHECK constraint allowed 'physical' | 'digital-recipe' |
-- 'learning-path'. Without recipes the middle value is dead. We
-- can't ALTER a CHECK constraint in place; the safe pattern is
-- drop + recreate with the new allowed set.
--
-- If any existing rows have fulfillment = 'digital-recipe' we
-- normalise them to 'physical' before re-applying the constraint.
-- In the prototype dev project this is a no-op (order_items is
-- empty), but the pattern keeps the migration safe for any future
-- branch where rows exist.

do $$
declare
  has_table boolean;
begin
  select exists(
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'order_items'
  ) into has_table;

  if has_table then
    update public.order_items
       set fulfillment = 'physical'
     where fulfillment = 'digital-recipe';
  end if;
end;
$$;

alter table if exists public.order_items
  drop constraint if exists order_items_fulfillment_check;

alter table if exists public.order_items
  add  constraint order_items_fulfillment_check
       check (fulfillment in ('physical', 'learning-path'));

commit;

-- ─────────────────────────────────────────────────────────────────
-- After applying:
--
--   1. PostgREST will auto-reload schema. If the dashboard still
--      shows the tables, run `NOTIFY pgrst, 'reload schema';` from
--      the SQL editor (or restart the project from the dashboard).
--
--   2. The app code is being de-recipe'd in the same change set.
--      Anything still importing from src/lib/recipes.ts after this
--      migration is a bug.
-- ─────────────────────────────────────────────────────────────────
