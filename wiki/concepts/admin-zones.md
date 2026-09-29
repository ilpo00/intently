---
type: concept
status: stable
updated: 2026-05-25
sources: [claude-md]
tags: [admin, medusa, supabase, planning]
---

# Admin zones — Intently vs Medusa boundary

Intently's admin panel is partitioned by which backend would own each surface if/when [[supabase-over-medusa]] flips. Two zones: **Intently-zone** surfaces stay in Supabase forever and we build them in `/admin/*`; **Medusa-zone** surfaces would be replaced by Medusa Admin on adoption and we deliberately don't build them in Intently at all. The partition exists so admin work today doesn't become throwaway code the day Medusa lands.

## Why this concept exists

The admin panel covers user management, analytics, PIM, and campaigns. Each of those has surfaces that overlap with what Medusa Admin gives you out of the box — products, orders, customers, discounts. Building any of those in Intently is wasted effort if Medusa is adopted later (per [[supabase-over-medusa]] the trigger conditions are real and growing). Building none of them blocks operational work today.

The zone partition is the resolution: build Intently-zone surfaces now (they're never duplicated), defer Medusa-zone surfaces until the decision is forced, and document which is which so future sessions don't accidentally cross the line.

## The two zones

**Intently-zone — owned by Supabase forever**
- Recipes (catalogue half that's Intently-native, not Medusa products)
- `library_items`, `taste_signals`, `chat_messages`, `recommendation_events`, `chip_events`/`chip_events_anon`
- Learning paths (v0.3+)
- AI tiered-orchestrator telemetry
- Editorial banners + AI prompt-bias campaigns (the campaign types we actually ship — discounts are Medusa-zone)
- User inspector (Intently-side data only: taste, library, chat, rec events; not the underlying account row when Medusa owns customers)

**Medusa-zone — Medusa Admin if adopted**
- `products` (catalogue half), variants, inventory
- `orders`, `order_items`, refunds, fulfillment, shipping zones
- `customers` (the account row itself; Intently-side per-user data stays in Supabase regardless)
- Discounts, promo codes, gift cards, multi-currency

## What this means in practice

When you're about to build something under `/admin/*`:

1. Ask which zone it's in. If Intently-zone, build it. If Medusa-zone, **don't** — defer.
2. If a Medusa-zone surface becomes urgent, that's the **trigger to make the Medusa call**, not a signal to build it in Intently.
3. Cross-zone analytics that join Intently-side telemetry against orders/customers (e.g. recommendation→conversion) are Intently-zone — we own the analytics layer, we just read from whichever backend owns the underlying row. When Medusa lands, the conversion query points at Medusa's `orders` instead of Supabase's; the rest is unchanged.

## How the admin panel implements this

`intently/src/app/admin/` is the route group. The layout (`src/app/admin/layout.tsx`) runs the allowlist gate via `src/lib/auth/admin-guard.ts` → `src/lib/auth/admin-allowlist.ts`. The gate is intentionally env-var based (`ADMIN_USER_IDS` + `ADMIN_AUTH_ENABLED`) rather than an `is_admin` column — small admin set, no migration cost, no RLS gymnastics. Trade-off committed in `intently/docs/roadmap.md` polish queue and the chips dashboard's original header comment.

Analytics pages follow a fixed pattern (the chips dashboard at `/admin/analytics/chips` is the explicit template per the roadmap):

- Pure aggregation function in `src/lib/<feature>/analytics.ts` — unit-tested.
- Thin fetch wrapper using `getSupabaseService()` from `src/lib/auth/supabase-service.ts` (service-role read; bypasses RLS so the dashboard sees across users).
- Server component page under `src/app/admin/analytics/<feature>/page.tsx` with `dynamic = 'force-dynamic'`, shared `RangePicker` (`src/components/admin/RangePicker.tsx`), local-mode notice.

Phase 1a (recommendation conversion, 2026-05-25) is the first application of this template beyond chips.

## Resolved (2026-05-25) — PIM split

Settled per [[pim-strategy]]:

- **Products → Medusa.** No Intently product editor will be built. Operator edits `src/lib/data.ts` during the Medusa migration window; afterwards Medusa Admin is the canonical editor and Intently reads a synced mirror. Read-only viewer at `/admin/pim/products` covers visibility today.
- **Recipes → Intently forever.** Recipe editor is the next admin-panel build. Uses the campaigns-style Phase-2 pattern (service-role writes + audit log + cache invalidation) plus JSON round-trip to `src/lib/recipes/data/*.json` so source-of-truth stays in code.
- **User inspector** — unchanged. Intently-side data only (taste, library, chat, rec/chip events). Even after Medusa adoption it stays here; Medusa Admin handles customer/order details.

## Related

- [[supabase-over-medusa]] — the original decision and trigger conditions
- [[chip-entry-strategy]] — the analytics template applied first
- [[tiered-ai-architecture]] — produces the telemetry the AI-tier admin dashboard will read
- [[chat-persistence]] — schema for `chat_messages` + `recommendation_events`, the analytics inputs
