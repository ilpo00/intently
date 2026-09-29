---
type: concept
updated: 2026-05-24
---

# Chip entry strategy

The four quick-link chips below the entry-hero input. Hidden by default; revealed after 5s of inactivity (anonymous first-time visitor) or immediately (returning user / signed-in user). One anchor chip plus three sampled chips, every impression and every click logged so we can learn which entry points actually pull users in.

This page is the maintenance guide. Code lives in [`src/lib/chips/`](../../intently/src/lib/chips/) and [`src/components/sections/EntrySection.tsx`](../../intently/src/components/sections/EntrySection.tsx). Schema in [`intently/supabase/migrations/0006_chip_events.sql`](../../intently/supabase/migrations/0006_chip_events.sql).

## Why

The entry hero asks an open question ("What do you want to cook?"). A stumped first-time visitor with no chips has no escape hatch — they either type something or leave. A page full of permanent chips fixes that but adds noise and pre-commits to four specific entry points forever. The chip cascade is the compromise: input alone for 5 seconds, then a small menu, *generated from a pool we can experiment with*.

The pool is the bet. With 25 candidate chips and 24 sampled into slots 1-3, we get breadth in what users see and a CTR signal per chip that tells us which framings work. Low-CTR chips get retired; new candidates get tested. The page learns.

## Composition

- **Slot 0** is always `inspire me` (the **anchor**). It's the no-commitment path for users who can't pick. Never rotates.
- **Slots 1-3** are sampled from three buckets, one chip per bucket per session:
  - `cookTonight` — concrete dishes (8 chips)
  - `tools` — equipment-led entries (7 chips)
  - `flavor` — style, cuisine, education, serendipity (9 chips)

Stratified sampling guarantees the user always sees one dish, one tool, and one flavor entry. Within each bucket, picks are uniform-random for now — Phase 2 may bias toward under-impressed chips once we have data.

The sample is **seeded by the chip session id** (a sessionStorage UUID minted on first visit, per tab). A page refresh returns the same four chips; a new tab gets new chips. This keeps the UX consistent within a session and the analytics attribution clean.

## Two tables, deliberately split

Anonymous and signed-in events live in **separate tables**:

- `chip_events` — signed-in. FK to `users(id)`. RLS-protected; a user can only read their own rows. Same pattern as `recommendation_events` / `chat_messages`.
- `chip_events_anon` — anonymous. No `user_id`. Correlation only via `session_id`. RLS allows INSERT from `anon`/`authenticated` but no SELECT — analytics reads go through `service_role` only.

Reasons:

1. The anon table will dominate row counts (~100× signed-in once traffic ramps). Keeping them separate keeps signed-in queries fast and index pages dense.
2. RLS posture differs. Signed-in events have per-row owners. Anon events have none — insert-only-for-anon is cleaner as a separate policy than as a multi-policy single table.
3. The columns differ: `chip_events_anon` has no `user_id` column at all, which eliminates "did we forget to null-check user_id" bugs in analytics queries.

## Maintenance guide

### Adding a chip

1. Open [`src/lib/chips/pool.ts`](../../intently/src/lib/chips/pool.ts) and append the chip text to the relevant bucket array. Lowercase, casual, either `"I want…"` / `"I need…"` framing or a short imperative.
2. Read every chip in the bucket aloud first. The voice is restrained-conversational; a chip that sounds louder than its neighbors is wrong even if the words are fine in isolation.
3. Update `TOTAL_CHIP_COUNT` and the pool-size assertion in `src/tests/chips.test.ts` if the count crosses the asserted total.
4. No migration needed. The chip_label column is opaque text.

### Retiring a chip

Just delete the line from `pool.ts`. Historical `chip_events` rows keep the old label; analytics joins by `chip_label`. Don't repurpose a label — that conflates conversion data.

### Reading the analytics

CTR per chip, last 7 days, signed-in users:

```sql
select
  chip_label,
  count(*) filter (where event_type = 'impression') as impressions,
  count(*) filter (where event_type = 'click')      as clicks,
  round(
    100.0 * count(*) filter (where event_type = 'click')::numeric
    / nullif(count(*) filter (where event_type = 'impression'), 0),
    2
  ) as ctr_pct
from chip_events
where created_at > now() - interval '7 days'
group by chip_label
order by ctr_pct desc nulls last;
```

Same query against `chip_events_anon` for anonymous traffic (run with `service_role` — `anon` can't SELECT).

For Phase 1 a SQL editor is enough. Phase 2 wraps this in a one-page HTML dashboard (rough — see `intently/docs/roadmap.md` § Analytics).

### When to refresh the pool

- **A chip CTR is materially below the bucket median for 2+ weeks** — retire and replace with a candidate from the same bucket.
- **A new dish, tool, or style ships in the catalogue** — consider a chip for it; doesn't have to ship at the same time but should within a sprint.
- **The pool has been static for ~a month** — actively rotate, even if data doesn't compel a swap. Stale chips train returning users to ignore them.

Avoid chasing single-week CTR fluctuations. Three to four weeks of data per change is the right cadence.

## Phasing

| Phase | Scope | Status |
|---|---|---|
| 1 | Anonymous pool + selection + both event tables + impression and click logging | shipped 2026-05-24 |
| 2 | CTR dashboard at `/admin/analytics/chips` — per-source (anon vs signed-in) impressions, clicks, CTR with date range selector. Status indicator for in-pool vs retired chips. | shipped 2026-05-24 |
| 3 | Signed-in personalization rules (deterministic over user state — orders, library, taste signals); anonymous pool as fallback. Impression-weighted sampling to avoid never-seen chips. | not started; depends on auth soak |
| 4 | Auto-retire bottom-quintile CTR chips; surface candidates from a backlog | not started |

### Dashboard (Phase 2)

`/admin/analytics/chips`. Server component, auth-gated (any signed-in user; no admin allowlist yet — Phase 3+ work if non-admin signed-in users land). Uses the service-role Supabase client (`src/lib/auth/supabase-service.ts`) to read across users and across the anon table whose RLS blocks `anon`/`authenticated` SELECT.

Date ranges: 24h, 7d (default), 30d, 90d, all. Each chip row shows impressions, clicks, CTR%, and a status indicator that cross-references against the current pool (`isInCurrentPool` in `src/lib/chips/analytics.ts`) so retired chips with historical data stay visible.

The aggregation is split into a pure function (`aggregateChipEvents`) and a thin DB-fetch wrapper (`fetchChipAnalytics`) so the math is independently testable. See `src/tests/chips-analytics.test.ts`.

**Required env vars** (server-side only):
- `NEXT_PUBLIC_SUPABASE_URL` (already set for auth)
- `SUPABASE_SERVICE_ROLE_KEY` (no `NEXT_PUBLIC_` prefix — must NEVER reach the browser)

## Related

- [[chat-persistence]] — the pattern this borrows from for the two-table split and the fire-and-forget tracking discipline.
- [[deterministic-ranker]] — the Tier-0 principle that Phase 3's signed-in personalization will follow (rules over user state, not LLM-in-the-loop).
- [[tiered-ai-architecture]] — broader principle: anything that can be expressed in code shouldn't be an LLM call. Chip generation is in that category.
- [[persistence-restores-data]] — chips appear immediately for returning users, but only because we read existing data; we do not auto-navigate.
