-- ─────────────────────────────────────────────────────────────────
-- Intently · 0004_auth_v02
--
-- v0.2 profile columns. Tiny migration — the only NEW persisted shape
-- this branch needs is display_name (already exists from 0001) and a
-- handful of forward-compatibility columns we'll want before we have
-- to write another migration.
--
-- Memory storage for "remembers previous conversations" reuses
-- chat_messages from 0003_chat_history.sql — no new table.
--
-- email_mirror note:
--   Email lives canonically in auth.users (Supabase Auth). The /account
--   page reads it from supabase.auth.getUser() at the UI layer, not from
--   public.users.email. We add the column anyway because the next
--   plausible feature ("send me a digest") needs server-side access to
--   the email without an auth-session round-trip. Cheap to land now,
--   expensive to retro-fit if RLS is already on.
-- ─────────────────────────────────────────────────────────────────

alter table public.users add column if not exists email      text;
alter table public.users add column if not exists avatar_url text;

-- Partial unique index — only enforces uniqueness when an email is
-- actually set. Pre-migration rows (display-only DEMO_USER_ID etc) all
-- have email = null, so the partial predicate avoids a backfill blocker.
create unique index if not exists users_email_unique
  on public.users (email)
  where email is not null;
