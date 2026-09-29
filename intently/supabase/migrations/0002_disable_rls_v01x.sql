-- ─────────────────────────────────────────────────────────────────
-- Intently · 0002_disable_rls_v01x
-- Supabase auto-enabled RLS on every public table at creation time.
-- The v0.1.x plan is "RLS designed but disabled until auth lands in v0.2".
-- Without policies, the anon key cannot read/write anything via PostgREST,
-- and we have no real users yet — so RLS is locking out the demo without
-- providing any security. Disable it explicitly here; v0.2 re-enables and
-- adds the policies committed (commented) in 0001_account_backbone.sql.
-- ─────────────────────────────────────────────────────────────────

alter table public.users          disable row level security;
alter table public.products       disable row level security;
alter table public.orders         disable row level security;
alter table public.order_items    disable row level security;
alter table public.taste_signals  disable row level security;
