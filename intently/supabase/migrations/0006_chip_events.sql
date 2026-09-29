-- ─────────────────────────────────────────────────────────────────
-- Intently · 0006_chip_events
-- Entry-hero quick-link analytics. See wiki/concepts/chip-entry-strategy.md
-- for the rationale (anonymous random-pool experiment + impression/click
-- CTR loop).
--
-- Two tables, deliberately split by user identity:
--
--   * chip_events       — signed-in users. FK to users(id). RLS-protected;
--                         a user can only read their own rows.
--   * chip_events_anon  — anonymous visitors. No user_id; correlation
--                         only via session_id (sessionStorage UUID minted
--                         in src/lib/chips/session.ts). RLS allows INSERT
--                         from anon but no SELECT — analytics reads go
--                         through service_role only.
--
-- Why two tables and not one nullable user_id column:
--   1. The anon table will dominate row counts (~100× signed-in volume
--      once traffic ramps). Keeping it separate makes index pages denser
--      for both tables, and analytics queries against signed-in events
--      don't pay the scan cost of the anon table.
--   2. RLS posture is different. Signed-in events follow the
--      recommendation_events / chat_messages pattern (auth.uid()::text =
--      user_id). Anon events have no per-row owner — insert-only for
--      anon, read-only for service_role. Encoding this in two tables is
--      cleaner than a multi-policy single table.
--   3. The columns differ: chip_events_anon has no user_id at all, which
--      eliminates an entire class of "did we forget to null-check user_id"
--      bugs in analytics queries.
--
-- Both tables ship with RLS enabled (matching v0.2 posture per 0005).
-- ─────────────────────────────────────────────────────────────────

-- ─── chip_events (signed-in) ───────────────────────────────────
create table chip_events (
  id           text primary key,                                       -- uuid
  user_id      text not null references users(id) on delete cascade,
  session_id   text not null,                                          -- sessionStorage UUID
  chip_label   text not null,                                          -- the rendered chip text, e.g. 'I want to make ramen'
  event_type   text not null
               check (event_type in ('impression', 'click')),
  position     int  not null
               check (position between 0 and 3),                       -- slot in the cascade (0 = anchor)
  created_at   timestamptz not null default now()
);

-- Session replay: "show me every chip event in this user's current session"
create index chip_events_session_idx
  on chip_events (user_id, session_id, created_at);

-- CTR aggregation: "for chip_label X, how many impressions and clicks since N?"
create index chip_events_label_idx
  on chip_events (chip_label, event_type, created_at desc);

-- ─── chip_events_anon (anonymous) ──────────────────────────────
create table chip_events_anon (
  id           text primary key,
  session_id   text not null,
  chip_label   text not null,
  event_type   text not null
               check (event_type in ('impression', 'click')),
  position     int  not null
               check (position between 0 and 3),
  created_at   timestamptz not null default now()
);

create index chip_events_anon_session_idx
  on chip_events_anon (session_id, created_at);

create index chip_events_anon_label_idx
  on chip_events_anon (chip_label, event_type, created_at desc);

-- ─── RLS ───────────────────────────────────────────────────────
-- Same pattern as 0005: enable RLS, then add policies cast against
-- auth.uid() as text (users.id is text-agnostic across auth providers).

begin;

-- chip_events (signed-in): users own their rows.
alter table public.chip_events enable row level security;

drop policy if exists "own chip events" on public.chip_events;
create policy "own chip events"
  on public.chip_events for all
  using      (user_id = (auth.uid())::text)
  with check (user_id = (auth.uid())::text);

-- chip_events_anon: INSERT is allowed for anon (no user binding), but
-- SELECT/UPDATE/DELETE are denied — analytics reads use service_role
-- bypass. This prevents one anon visitor from enumerating other anon
-- sessions even though the data isn't tied to identities.
alter table public.chip_events_anon enable row level security;

drop policy if exists "anon insert chip events" on public.chip_events_anon;
create policy "anon insert chip events"
  on public.chip_events_anon for insert
  to anon, authenticated
  with check (true);

-- No SELECT policy for anon/authenticated → no reads from the JS bundle.
-- service_role bypasses RLS, so analytics jobs and dashboards still work.

commit;
