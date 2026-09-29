-- ─────────────────────────────────────────────────────────────────
-- Intently · 0009_admin_audit_log
-- Append-only record of every admin write. Phase 2 of the admin-panel
-- plan introduces the first write surface (campaigns CRUD), so this
-- table arrives now rather than back in Phase 0 where there was
-- nothing to audit yet.
--
-- Schema is intentionally generic (action / target_table / target_id
-- / payload) so future write surfaces (PIM authoring in Phase 4, the
-- one allowlist-promote action in Phase 3) plug in without altering
-- the table. The discriminator is `action` — namespace it like
-- 'campaign.create', 'campaign.status_change', 'pim.publish'.
--
-- The payload column carries arbitrary context (before/after diff,
-- old + new status, etc.) — keep it small and grep-friendly rather
-- than dumping full row state.
--
-- RLS posture: service-role-only. Admin UI reads + writes via
-- getSupabaseService(). Anon / authenticated are locked out — RLS
-- enabled with no policies → deny by default.
-- ─────────────────────────────────────────────────────────────────

create table admin_audit_log (
  id             text primary key,
  actor_user_id  text references users(id) on delete set null,
  action         text not null,
  target_table   text not null,
  target_id      text,
  payload        jsonb,
  created_at     timestamptz not null default now()
);

-- "Show me everything that happened recently."
create index admin_audit_log_created_idx
  on admin_audit_log (created_at desc);

-- "Who touched this campaign and when?"
create index admin_audit_log_target_idx
  on admin_audit_log (target_table, target_id, created_at desc);

-- "What did this admin do this week?" — for review / debugging support
-- actions before they accumulate.
create index admin_audit_log_actor_idx
  on admin_audit_log (actor_user_id, created_at desc);

alter table public.admin_audit_log enable row level security;
-- No anon/authenticated policies — service-role-only access.
