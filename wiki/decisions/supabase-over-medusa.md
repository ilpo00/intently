---
type: decision
status: stable
updated: 2026-05-09
sources: [claude-md]
tags: [backend, database, commerce, accounts]
---

# supabase-over-medusa

For v0.1.x, **Supabase (Postgres) is the backbone for mutable user-scoped data** — `users`, `orders`, `order_items`, `library_items`, `taste_signals`. **Medusa was considered as the v2 swap target and deferred indefinitely.** The catalogue (products, recipes) stays sourced from `src/lib/data.ts` for now and is mirrored read-only into Supabase as a foreign-key target.

This decision retires the `data.ts → Medusa` swap-comment that lived in `intently/CLAUDE.md` and `intently/README.md` before the Asset rework. That comment was written when Recipe was a second-class shim into Product — once Asset lifted Recipe, Tool, and (future) LearningPath to siblings, "swap data.ts to Medusa" stopped being shovel-ready.

## Why Supabase

- The boring database we needed. Real schema, real foreign keys, real `select`/`insert` from day one. Auth comes for free when v0.2 flips it on.
- Postgres is portable. Self-hostable, free tier covers a side project for years, `pg_dump` works anywhere. Lock-in is shallow.
- Type generation against the live schema fits the strict-TS posture (see `src/types/supabase.ts`).
- The data-mode toggle (`NEXT_PUBLIC_DATA_MODE=local|supabase`, mirroring `NEXT_PUBLIC_AI_MODE`) keeps the no-key demo working in CI; same pattern engineers already understand from `useChat`.

## Why not Medusa

- Medusa has no place to put recipes, taste signals, library entries, learning paths. The Asset graph (recipe + product + LearningPath, plus library / taste / paths) has outgrown what Medusa naturally models. Adopting Medusa now would force a second backend (Supabase or similar) for everything Medusa doesn't cover — two backends, two SDKs, a sync layer between them.
- Medusa's commerce model is opinionated about primitives Intently doesn't have yet — variants, inventory, payments, shipping zones, refunds, multi-currency. Designing those to fit Intently's catalogue prematurely is work we'd redo when actual requirements show up.
- Medusa is a one-way door. Supabase keeps the option of layering Medusa on later, when commerce complexity actually justifies it.

## When to revisit Medusa

Re-open this ADR when at least three of the following become real product requirements (not speculative):

1. Variants (size, colour, etc.) on the tool catalogue.
2. Real inventory management (stock counts, backorders).
3. Live payments (real Stripe flow, not a stub).
4. Shipping zones / multi-region fulfillment.
5. Refunds / order-line modifications post-purchase.
6. Multi-currency pricing.

Until at least three of those hit, Supabase tables suffice. If we revisit, the likely shape is Medusa for `products` / `customers` / `cart` / `orders`, Supabase remaining for `recipes` / `library_items` / `taste_signals` / `learning_paths`. Plan the sync layer carefully — that's the painful part.

## Update 2026-05-25 — adoption decision

The trigger to revisit fired earlier than the six-condition checklist anticipated: the operator pain became "I want to edit products without code commits" once the admin panel landed, even before variants / inventory / payments became hard requirements. [[pim-strategy]] captures the resulting decision — **adopt Medusa for products; recipes stay in Intently forever** — and explicitly rejects building a Intently product editor as throwaway work.

Implementation pacing:

- Medusa adoption is a separate, larger milestone tracked outside the admin-panel plan. ~2–4 weeks.
- Until Medusa lands, product edits stay in `src/lib/data.ts` with `/admin/pim/products` as the visibility surface.
- Recipe editor is the next admin-panel build (recipes are Intently-zone regardless of Medusa).

The originally-anticipated shape — "Medusa for products / customers / cart / orders, Supabase for recipes / library / taste / paths" — stands. The sync layer (Medusa → Supabase `products` mirror) is the architectural piece that needs the most care.

## Trade-offs accepted in v0.1.x

- **No auth yet.** Single hardcoded user id `'demo-user'` (see `src/lib/account/demo-user.ts`). This is honest scaffolding, not a real account system. v0.2 swaps the singleton for an auth-derived id and flips RLS on.
- **RLS off.** Anyone with the public anon key (which lands in the bundled JS) can read/write every row. Migration `0002_disable_rls_v01x.sql` makes this explicit. Acceptable for dev-only; do not deploy publicly with anything you care about until v0.2 lands auth + RLS policies. The policy shapes are already committed (commented) in `0001_account_backbone.sql`.
- **`users.id` is `text`, not `uuid`.** Kept agnostic so Supabase Auth (`uuid` `sub`), Clerk (`user_xxx` strings), or a roll-your-own provider all stay open. Decision deferred to v0.2.
- **Catalogue stays in `data.ts`.** Products + recipes are mirrored read-only into Supabase as FK targets via `intently/scripts/seed-supabase.ts`. Authoring happens in code, not in the database — that flips when the PIM work in `intently/docs/roadmap.md` lands.

## Related

- [[claude-md]] — root project guidance, "Data layer — catalogue vs accounts" section
- [[dependency-pinning]] — sister decision on version policy
- `intently/docs/account-backbone.md` — schema, AccountStore interface, mode toggle, verification
- `intently/supabase/migrations/0001_account_backbone.sql` — schema (with RLS policies committed but disabled)
- `intently/supabase/migrations/0002_disable_rls_v01x.sql` — corrective migration for Supabase's RLS auto-enable default
- `intently/src/lib/account/` — interface (`account-store.ts`), local + supabase impls, factory, demo-user singleton
