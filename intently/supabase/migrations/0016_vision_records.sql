-- ─────────────────────────────────────────────────────────────────
-- 0016 · vision_records — the cloud home for vision-enrichment output.
--
-- Why a table and not another runtime_kv blob: a full catalogue run is ~292
-- products written in ~20 chunks across separate serverless invocations. One
-- row per product lets each chunk upsert only what it just analysed, instead
-- of a read-modify-write of a ~500KB document every 60 seconds. It also makes
-- "clear the enriched data" a single scoped DELETE.
--
-- scope: 'sample'  = the 10 curated PIM-stub products (the PIM-vs-vision view)
--        'catalog' = the full product catalogue
-- Composite PK (scope, id) so the same product may exist in both scopes and
-- PostgREST merge-duplicates upserts resolve correctly.
--
-- Run STATUS lives in runtime_kv under 'vision-run' (small, written once per
-- chunk) — see 0013.
--
-- Server-side access only (service role); RLS blocks everything else. The
-- records are not user data, but RLS-on is the standing blast-radius rule.
-- ─────────────────────────────────────────────────────────────────

create table if not exists vision_records (
  scope      text not null,
  id         text not null,
  record     jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (scope, id)
);

comment on table vision_records is
  'Vision-enrichment output, one row per analysed product. Mirrors the local .enrichment/vision-*.json caches; the aggregate report is derived on read.';

create index if not exists vision_records_scope_idx on vision_records (scope);

alter table vision_records enable row level security;
