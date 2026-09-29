-- ─────────────────────────────────────────────────────────────────
-- 0013 · runtime_kv — the cloud home for the PM-editable runtime stores
-- (ADR-012 Phase C1): runtime config, situations (custom / overrides /
-- active). One row per document key, whole-document JSON — deliberately
-- symmetric with the local .enrichment/*.json files so the store swap is
-- a read/write seam change, not a data-model change.
--
-- Keys in use: 'runtime-config', 'situation-custom', 'situation-overrides',
-- 'situation-active'. Server-side access only (service role); RLS blocks
-- everything else.
-- ─────────────────────────────────────────────────────────────────

create table if not exists runtime_kv (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table runtime_kv is
  'PM-editable runtime documents (config, situations). Mirrors the local .enrichment/*.json stores 1:1.';

alter table runtime_kv enable row level security;
