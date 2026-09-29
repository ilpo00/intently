-- ─────────────────────────────────────────────────────────────────
-- Intently · 0008_campaigns
-- Editorial banners + AI prompt-bias campaigns.
-- See wiki/entities/campaigns.md for the contract and integration
-- points. Phase 2 of the admin-panel plan.
--
-- ONE TABLE, TWO TYPES — both fit cleanly:
--
--   * banner       — editorial override on the entry hero (headline /
--                    subheading / CTA), time-bounded.
--   * prompt_bias  — orchestrator side-channel; appends a system-prompt
--                    addendum + optional ranker boosts for a window.
--
-- The discriminator is `type`. The `payload` JSONB carries the type-
-- specific fields (BannerPayload | PromptBiasPayload in
-- src/lib/campaigns/types.ts). One table because the lifecycle
-- (draft → active → paused → archived) and time-windowing are
-- identical; splitting would duplicate that plumbing without gain.
--
-- RLS posture: anon + authenticated can SELECT ONLY rows that are
-- currently active (status='active' AND active_from <= now() AND
-- (active_until IS NULL OR active_until > now())). This is what lets
-- the public entry-hero render fetch the active banner without
-- elevating to service_role. Admin CRUD goes through service_role
-- via src/lib/campaigns/store.ts.
--
-- updated_at is maintained by a trigger so the store doesn't have to
-- pass it on every UPDATE.
-- ─────────────────────────────────────────────────────────────────

create table campaigns (
  id            text primary key,
  name          text not null,
  type          text not null check (type in ('banner', 'prompt_bias')),
  payload       jsonb not null,
  active_from   timestamptz not null,
  active_until  timestamptz,
  status        text not null default 'draft'
                check (status in ('draft', 'active', 'paused', 'archived')),
  created_by    text references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Hot path for the entry-hero resolver and the orchestrator: "which
-- campaigns are active right now?" — filtered index keeps it tiny
-- regardless of how many drafts / archives accumulate.
create index campaigns_active_window_idx
  on campaigns (active_from, active_until)
  where status = 'active';

-- Admin list view filters by type frequently.
create index campaigns_type_status_idx
  on campaigns (type, status);

-- ─── updated_at trigger ────────────────────────────────────────
create or replace function campaigns_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger campaigns_set_updated_at_trigger
  before update on public.campaigns
  for each row execute function campaigns_set_updated_at();

-- ─── RLS ───────────────────────────────────────────────────────
alter table public.campaigns enable row level security;

-- Anon + authenticated SEE active campaigns only. The window predicate
-- runs server-side per query — no extra app-level filter needed for the
-- public entry-hero render.
drop policy if exists "read active campaigns" on public.campaigns;
create policy "read active campaigns"
  on public.campaigns for select
  to anon, authenticated
  using (
    status = 'active'
    and active_from <= now()
    and (active_until is null or active_until > now())
  );

-- No INSERT / UPDATE / DELETE policies — service_role bypasses RLS,
-- so admin CRUD via src/lib/campaigns/store.ts still works while the
-- browser is locked out.
