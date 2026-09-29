---
type: entity
status: stable
updated: 2026-05-25
sources: [claude-md]
tags: [campaigns, admin, banner, prompt-bias, ranker]
---

# Campaigns

Editorial banners + AI prompt-bias campaigns. One Supabase table (`public.campaigns`), one discriminated union (`Campaign = BannerCampaign | PromptBiasCampaign`), three integration points (Entry hero, `/api/chat` orchestrator, deterministic ranker). Phase 2 of the admin-panel plan, shipped 2026-05-25.

A campaign has a name, type, payload, time window (`activeFrom` + nullable `activeUntil`), and status (`draft | active | paused | archived`). Only campaigns with `status='active'` AND `activeFrom <= now()` AND (`activeUntil` is null OR `activeUntil > now()`) appear to non-admin readers — RLS enforces this at the DB.

## Why one table, not two

Banner and prompt-bias campaigns differ only in `payload` shape. Lifecycle (draft → active → paused → archived), windowing, and audit semantics are identical. Splitting tables would duplicate every column and every workflow for zero gain. The discriminator is `type`; the typed `Campaign` union narrows on it so payload shape mismatches surface at compile time.

## Schema

Migration: `intently/supabase/migrations/0008_campaigns.sql`.

```
campaigns (
  id            text primary key,
  name          text not null,
  type          text not null check (type in ('banner','prompt_bias')),
  payload       jsonb not null,
  active_from   timestamptz not null,
  active_until  timestamptz,
  status        text not null check (status in ('draft','active','paused','archived')),
  created_by    text references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
)
```

`updated_at` is maintained by a trigger so callers don't pass it. A filtered index on `(active_from, active_until) WHERE status = 'active'` keeps the active-fetch hot path tiny regardless of how many drafts / archives accumulate.

### Audit trail

Every campaign mutation writes a row to `admin_audit_log` (migration `0009_admin_audit_log.sql`). The schema is intentionally generic (`action / target_table / target_id / payload`) so future write surfaces (PIM authoring, allowlist promotion) plug in without altering the table. Namespace actions like `campaign.create`, `campaign.update`, `campaign.status_change`.

## RLS posture

Two access patterns:

- **Public read** — anon/authenticated SELECT, restricted by RLS to currently-active rows only. Lets the entry-hero SSR fetch run without elevating to service_role.
- **Admin CRUD** — goes through `getSupabaseService()` (service_role bypasses RLS) in `src/lib/campaigns/store.ts`. Every mutation writes the audit log and busts the active-campaigns cache.

`admin_audit_log` has no anon/authenticated policies — service-role-only access, both reads and writes.

## TypeScript contract

`src/lib/campaigns/types.ts` is the single source of truth between the jsonb payload and the typed union:

```ts
type BannerPayload = {
  surface: 'entry_hero' | 'river_header'
  heading?: string; subheading?: string
  ctaText?: string; ctaUrl?: string
}
type PromptBiasPayload = {
  systemAddendum: string
  rankerBoosts?: { tags?: string[]; productIds?: string[]; recipeIds?: string[] }
  intentFilter?: 'cook' | 'browse' | 'buy'
}
type Campaign = BannerCampaign | PromptBiasCampaign
```

`campaignFromRow(row)` is the only place row → union narrowing happens. It returns `null` defensively on:

- unknown `type` or `status`
- banner payload without a valid `surface`
- prompt-bias payload without a `systemAddendum`
- malformed `rankerBoosts` (non-string ids get silently stripped)

`mergePromptBiasCampaigns(campaigns)` collapses multiple active prompt-bias campaigns into one `{ systemAddendum, rankerBoosts }` — addenda joined by blank line, id arrays deduped. Returns `null` for empty input.

## Read path

`src/lib/campaigns/active-resolver.ts` is the cached read fronting everything. One cached fetch per minute (`unstable_cache`, 60s TTL, tag `campaigns:active`); admin mutations call `updateTag` to bust it within seconds rather than waiting the TTL.

Two filtered accessors:

- `getActiveBannerCampaign(surface)` — picks the most-recent `activeFrom` if multiple banners overlap.
- `getActivePromptBiasCampaigns()` — returns all; `/api/chat` merges them.

Both delegate to one cached `fetchActiveCampaignsCached`, so filter combos share the same Supabase round-trip.

## Integration: Entry hero

`src/app/page.tsx` (server component) awaits `getActiveBannerCampaign('entry_hero')` and passes an optional `bannerOverride` prop to `EntrySection`. The component's headline render falls through in priority order:

1. `bannerOverride.heading` (active banner wins)
2. `'Welcome back, ${name}.'` (signed-in personalised greeting)
3. `'What do you want to cook?'` (default)

When `subheading` is set, it renders below the headline with reduced spacing so the distance to the input stays constant regardless of banner state. CTA fields are accepted in the type for forward-compat but **not rendered in v1** — the entry hero just shipped its current layout and we're not introducing a CTA button without explicit editorial demand.

## Integration: tiered AI orchestrator

`/api/chat/route.ts` calls `getActivePromptBiasCampaigns()` once per request (non-fatal; failures warn-log and skip), merges them with `mergePromptBiasCampaigns`, and passes the result into both streaming and blocking `runOrchestrator` calls via two new fields:

- `campaignAddendum: string` — folded into the existing `systemAddendum` channel alongside `buildPriorContextBlock`. **Never lands in the cached system prefix** (`buildSystemPrompt`); the catalog prefix stays cacheable, which is the entire point of the addendum channel.
- `campaignBoosts: { productIds, recipeIds, tags }` — passed through to the ranker context.

The addendum is wrapped with the literal text `--- Active editorial campaigns ---` so the model can identify it in the prompt.

## Integration: deterministic ranker

`src/lib/recommend/ranker.ts` accepts `RankContext.campaignBoosts` and adds a fifth scoring component:

- `RANKER_CAPS.campaignBoost = 15` — deliberately smaller than `tasteAlignment` (40), so an editorial nudge can flip a tie or surface a candidate but **can't override a clear taste signal**. A boosted hit can score up to 115 (base 100 + boost 15).
- v1 boost is **id-list membership only**: `+15` when `product.id ∈ campaignBoosts.productIds` (same for recipes). Tags are accepted in the type but silently ignored — no `Product.tag` matching scaffolding exists yet, and `Recipe` has no tags field at all.
- Tie-breaker behavior pinned by `src/tests/ranker-boosts.test.ts`: with no other discriminating signals, a boosted product outranks its unboosted sibling regardless of alphabetical id.

## Tests

- `src/tests/campaigns-types.test.ts` (17 tests) — row parsing, union narrowing, merge.
- `src/tests/ranker-boosts.test.ts` (8 tests) — boost magnitude, taste-signal override safety, tie-flipping.
- `src/tests/recommend/ranker.test.ts` — updated `RANKER_CAPS` invariant to reflect the base-100 + additive-boost design.

The store and active-resolver are not unit-tested in isolation because they're thin glue over the Supabase client + `unstable_cache`. Integration verification happens via the admin UI (manual smoke).

## Admin UI

- `/admin/campaigns` — list view (every status; filter chips planned but not yet built).
- `/admin/campaigns/new` — type picker → conditional form. Banner and prompt-bias share the common fields (name, window, status) and bring their own payload fieldset.
- `/admin/campaigns/[id]` — edit + status toggle. Type is fixed at create time. Every mutation writes to the audit log.

Server actions in `src/app/admin/campaigns/actions.ts` translate FormData → typed input → store call. Validation is intentionally light; CHECK constraints on the DB catch malformed values.

## Related

- [[admin-zones]] — campaigns are Intently-zone forever (no Medusa overlap)
- [[tiered-ai-architecture]] — prompt-bias addendum + ranker boost flow into the existing orchestrator without touching the cached system prefix
- [[deterministic-ranker]] — the fifth scoring component
