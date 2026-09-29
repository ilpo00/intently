# Account backbone — Supabase, no auth yet (v0.1.x)

> ⚠️ **Pre-pivot Phase-2 reference (read before trusting the specifics).**
> This doc predates the MISE → Intently pivot (see
> [mise_to_intently_migration.md](mise_to_intently_migration.md)). The
> **auth / RLS / migration / data-mode-toggle mechanics** described here are
> still indicative of the parked Phase-2 account layer. But the **domain
> modeling is MISE-era and superseded** — the owned-asset library ("My
> Kitchen"), `markCooked` / "cooked" timestamps, the `recipes` mirror table,
> and `taste_signals` describe the old food product. The pivot dropped those
> concepts (style replaced taste; there is no owned-asset library or "cooked"
> signal in the discovery product). Treat table/field names tied to the food
> domain as historical, not as the target schema. The account-layer code itself
> was removed with `src/_parked/` in the pivot cleanup (2026-06-15) and lives in
> git history — see `CLAUDE.md`.

> Branch: `claude/xenodochial-franklin-642f0c`
> Status: shipped 2026-05-09 (commits `cfb3ac0` → `eb9ca2e`)
> Direction & rationale: [wiki/decisions/supabase-over-medusa](../../wiki/decisions/supabase-over-medusa.md)

This file is the technical reference for the account layer. The
*decision* (Supabase vs Medusa) lives in the wiki. The *what / where /
how* lives here.

## What landed

A real Postgres backbone for everything user-scoped — orders, library
("My Kitchen"), taste signals — behind a data-mode toggle that lets
the existing localStorage demo keep working without any keys.

```
intently/
├── supabase/migrations/
│   ├── 0001_account_backbone.sql      # schema, RLS commented but disabled
│   └── 0002_disable_rls_v01x.sql      # corrective: Supabase auto-enables RLS
├── scripts/
│   └── seed-supabase.ts               # idempotent catalogue mirror seeder
└── src/
    ├── lib/
    │   ├── account/
    │   │   ├── account-store.ts            # interface + domain types
    │   │   ├── account-store-local.ts      # localStorage impl (default)
    │   │   ├── account-store-supabase.ts   # Postgres impl
    │   │   ├── account-store-factory.ts    # mode switch + init-time fallback
    │   │   └── demo-user.ts                # DEMO_USER_ID = 'demo-user'
    │   └── ids.ts                          # newOrderId() — sortable opaque id
    ├── store/intently-store.ts                 # slices route through accountStore
    └── components/ui/AccountHydrator.tsx   # hydrates library + orders + taste on mount
```

Nothing in the app's UI changed. The slice APIs (`addToLibrary`,
`isInLibrary`, `markCooked`, `addTasteSignal`) stayed sync; persistence
moved behind the `AccountStore` interface.

## Schema

Seven tables, all keyed by `text` ids (auth-provider-agnostic). Full
DDL: [`intently/supabase/migrations/0001_account_backbone.sql`](../supabase/migrations/0001_account_backbone.sql).

| Table | Rows | Purpose |
|---|---|---|
| `users` | the demo user in v0.1.x | Identity. v0.2 re-keys onto auth provider ids. |
| `products`, `recipes` | catalogue mirror (read-only) | FK targets. `data.ts` remains source of truth in v0.1.x. |
| `library_items` | per-user-per-asset | "My Kitchen" — what the user owns + cooked timestamps. |
| `orders`, `order_items` | per-order, per-line | Audit trail. `unit_cents` is captured at purchase time, immutable. |
| `taste_signals` | per-user-per-style | Love / skip / nope on the 12-grid. |

## AccountStore interface

```ts
interface AccountStore {
  getLibrary(userId): Promise<LibraryItem[]>
  addToLibrary(userId, { assetId, acquiredFrom? }): Promise<void>
  removeFromLibrary(userId, assetId): Promise<void>
  markCooked(userId, assetId): Promise<void>

  createOrder(userId, draft: OrderDraft): Promise<OrderRecord>
  listOrders(userId): Promise<OrderRecord[]>

  recordTasteSignal(userId, { styleId, signal }): Promise<void>
  listTasteSignals(userId): Promise<TasteSignalRecord[]>
  removeTasteSignal(userId, styleId): Promise<void>
}
```

Full definition + domain types: [`src/lib/account/account-store.ts`](../src/lib/account/account-store.ts).

All methods are async even though the local impl resolves
synchronously, so call sites stay implementation-agnostic. Per-call
errors propagate (factory only handles init-time fallback) — call
sites decide UX. `CheckoutSection.handleOrder` is the canonical
example: it `await`s `createOrder` and falls through silently on
failure rather than blocking the demo.

## Mode toggle

```
NEXT_PUBLIC_DATA_MODE=local      # default; CI target; no keys required
NEXT_PUBLIC_DATA_MODE=supabase   # requires NEXT_PUBLIC_SUPABASE_URL + ANON_KEY
```

`getAccountStore()` (in `account-store-factory.ts`) is a lazy
singleton. In `supabase` mode it tries to construct a client; if URL
or anon key is missing, or `createClient` throws, it logs a warning
and falls back to `LocalAccountStore` for the rest of the session. The
pattern mirrors `useChat`'s scripted-fallback for live AI.

The factory caches per process; `__resetAccountStore()` is exposed for
tests only.

## Storage keys (local mode)

| Key | Shape |
|---|---|
| `intently.kitchen.v1` | `{ ownedAssetIds[], acquiredAt: {[id]: ms}, cookedAt: {[id]: ms} }` (existing; preserved exactly) |
| `intently.orders.v1` | `OrderRecord[]` (new in phase 3) |
| `intently.taste.v1`  | `TasteSignalRecord[]` (new in phase 3) |

`intently.kitchen.v1` shape is preserved bit-for-bit so a user with an
existing library doesn't lose anything when this branch lands.
`acquiredFrom` is *not* persisted in v0.1.x (no UI surface sets it
yet); reads default to `'intently'`.

## Order ids

`newOrderId()` in `src/lib/ids.ts` returns `ord_<ts36>_<rand36>`:

- `ts36` = `Date.now()` in base36 (sortable, lexicographic-friendly)
- `rand36` = 8 base36 chars from `crypto.getRandomValues`

Not strict ulid. The `orders.id` column is `text`, so we can swap for
real ulid (`npm i ulid`) without a schema change if collision risk
ever matters at our scale.

## Security note

**RLS is off in v0.1.x.** With the anon key in `NEXT_PUBLIC_*` (which
lands in the bundled JS), anyone who reads the bundle has read/write
on every row. This is the deliberate trade-off: no auth yet, single
demo user, dev-only deploys. Migration `0002_disable_rls_v01x.sql`
makes it explicit.

**Do not deploy this publicly with anything you care about until v0.2
lands auth + RLS policies.** The policies themselves are already
written (commented) at the bottom of `0001_account_backbone.sql` —
turning RLS on in v0.2 is one `alter table … enable row level
security` per table plus uncommenting the four `create policy` blocks.

## Phase 4 checkout flow

```
user clicks "Pay" / "Get your recipes"
        ↓
handleOrder()  (async; isPlacing flag prevents double-click)
        ↓
build OrderDraft from cart  (snapshot before any await)
        ↓
await accountStore.createOrder(DEMO_USER_ID, draft)
        ↓                         ↓
       ok                       error
        ↓                         ↓
  addOrder(record)          console.warn, fall through
        ↓                         ↓
        └─────────┬───────────────┘
                  ↓
  addToLibrary for digital items  (existing behaviour)
                  ↓
  flushSession('purchase'), particles, setOrderPlaced(true)
                  ↓
  setTimeout 1200ms → clearCart, resetConversation
```

In `local` mode the await resolves microseconds later; in `supabase`
mode it's a real network round-trip.

## Hydration

`AccountHydrator` (mounted once inside `ClientShell`) calls
`hydrateLibrary` + `hydrateOrders` + `hydrateTaste` on first effect.
Each is idempotent so StrictMode's double-mount in dev is fine. Each
fetches via `accountStore.list*` and writes the result into the
in-memory slice.

The slices then read in-memory only — `isInLibrary` stays sync — and
writes optimistically update in-memory before fire-and-forgetting the
persistence call. Failures are logged; the in-memory state is the
authority for the current session. This is acceptable in v0.1.x; v0.2
should add a retry / surface-error path for failures that persist
beyond a single retry.

## Verification (manual)

**Local mode (no env vars):**

1. `npm run dev`. Place an order with one knife + one recipe.
2. Refresh — recipe still shows "In My Kitchen" on the AssetCard.
3. DevTools → Application → Local Storage:
   - `intently.kitchen.v1` populated
   - `intently.orders.v1` has the order with the right items + total
   - `intently.taste.v1` populated if you marked any styles
4. `npm run typecheck && npm run lint && npm run test:ci && npm run build` all clean.

**Supabase mode:**

1. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in `intently/.env.local`.
2. `npx tsx scripts/seed-supabase.ts` — products + recipes appear in the catalogue mirror tables.
3. Set `NEXT_PUBLIC_DATA_MODE=supabase`, restart dev, place an order.
4. SQL: `select count(*) from order_items where order_id = '<id>'` — count matches the cart.
5. Kill the Supabase URL mid-session: app falls back to local mode silently. Confirmation pane still renders.

## Open questions for v0.2

1. ~~**Auth provider.**~~ **Resolved 2026-05-24:** Supabase Auth (magic-link only). See [wiki/decisions/supabase-auth-over-clerk](../../wiki/decisions/supabase-auth-over-clerk.md).
2. ~~**localStorage → Supabase migration on first sign-in.**~~ **Resolved 2026-05-24:** `src/lib/account/migrate-from-local.ts`, idempotent via the `intently.migrated.v1` marker, fired from `useAuth` when transitioning to signed-in.
3. **Catalogue source of truth.** Stays in `data.ts` until the PIM work in `intently/docs/roadmap.md` lands.
4. **Tool-ownership flag.** `acquired_from = 'pre-existing'` is in the schema; the AssetCard toggle that emits it was a deferred MISE-era addition (the design draft it referenced was removed in the pivot — see the banner above).

## Phasing recap

| Phase | Branch commits | Includes |
|---|---|---|
| 1 — schema + seed | `cfb3ac0` | migrations, seed script, generated TS types, env example |
| 2 — abstraction | `b3619f4` | `AccountStore` interface, local + supabase impls, factory, 13 unit tests |
| 3 — store wire-up | `097314a` | slices route through accountStore, OrdersSlice added, hydrator renamed |
| 4 — checkout | `eb9ca2e` | `handleOrder` async, real `Order` rows, double-click guard, ulid-ish helper |
| 5 — docs (v0.1.x) | `20c41ea` | v0.1.x reference, wiki ADR, CLAUDE.md + README updates |
| v0.2 auth land | branch `claude/auth-memory-v02` | full v0.2 update — see appendix below |

---

# Appendix — v0.2 auth + memory + RLS (shipped 2026-05-24)

The v0.2 branch turns the v0.1.x scaffolding into a real auth-gated experience: magic-link Supabase Auth, RLS on all user-scoped tables, conversation memory pulled from the existing `chat_messages` table, a minimal `/account` page, and the localStorage migration that v0.1.x left as dead code.

## Auth flow (Supabase Auth, magic-link only)

```
anonymous river
  ↓  click "Returning · Sign in"  (entry hero, supabase mode only)
/auth/login                       (server component + LoginForm client island)
  ↓  email field + supabase.auth.signInWithOtp
"Check your inbox"
  ↓  user clicks magic link in their email
/auth/callback?code=…             (server route handler)
  ↓  supabase.auth.exchangeCodeForSession(code)  (sets HttpOnly cookies)
  ↓  upsert public.users(id) so AccountStore FK targets exist
  ↓  branch on display_name:
       null → /account/welcome (server action sets display_name)
       set  → ?redirect= or /
river                             (entry hero now reads "Welcome back, $name")
```

Local-mode short-circuit: `useAuth()` in `src/hooks/useAuth.ts` checks `process.env.NEXT_PUBLIC_DATA_MODE`. In local mode it returns a synthetic signed-in state for `DEMO_USER_ID` with `displayName: 'Demo'` — no login UI surfaces at all, CI/demo unchanged.

## Schema additions

- `0004_auth_v02.sql` — adds `email` + `avatar_url` columns to `public.users` (`display_name` was already there from `0001`). Email is also tracked canonically in `auth.users` (Supabase Auth); the mirror exists for forward compat (server-side digests, admin lookups). Partial unique index on `email where email is not null` avoids blocking pre-migration null rows.
- `0005_enable_rls.sql` — the actual security flip. Wrapped in `BEGIN; ... COMMIT;` for atomic apply (after a partial-apply postmortem). Enables RLS on all 7 user-scoped tables (`users`, `library_items`, `orders`, `order_items`, `taste_signals`, `chat_messages`, `recommendation_events`) with `using/with check (user_id = auth.uid()::text)` policies. Catalogue tables (`products`, `recipes`) get `for select using (true)` so the anonymous river still renders.

Cast note: Supabase Auth returns `uuid`; our `users.id` is `text` (kept agnostic in v0.1.x). Every policy casts `auth.uid()::text`. Forgetting the cast silently locks rows out — single migration file + paired review against `0001` template is the mitigation.

## AccountStore additions

```ts
getProfile(userId): Promise<UserProfile>           // { id, displayName }
updateProfile(userId, patch: Partial<…>): Promise<void>   // upserts
```

Both impls; local stores under `intently.profile.v1`. Email is NOT mirrored on the AccountStore — UI reads it from `supabase.auth.getUser()` at the auth layer.

## Identity replacement

Every read/write that was `DEMO_USER_ID` in v0.1.x now reads `getActiveUserId()` (sync, from `src/lib/auth/active-user.ts`) or `useActiveUserId()` (React). The auth hook publishes the active id via `setActiveUserId(user.id)` on every auth state change. Local-mode default: `DEMO_USER_ID`.

18 seams updated:
- `src/store/intently-store.ts` — 11 sites across TasteSlice, LibrarySlice, OrdersSlice, SessionSlice.
- `src/hooks/useChat.ts:187` — body sends `getActiveUserId()`. Server ignores it in supabase mode (cookie wins).
- `src/components/sections/CheckoutSection.tsx` — `createOrder` + `markRecommendationOrdered`.
- `src/app/api/chat/route.ts` — in supabase mode reads `getAuthUserId()` from the cookie, returns 401 on null. In local mode keeps `body.userId ?? DEMO_USER_ID`.
- `src/app/api/chat/conversion/route.ts` — same pattern; `?userId=` query param ignored in supabase mode.

This closes `prodprep.md:94-107` — both chat endpoints no longer trust client-supplied user ids.

## Conversation memory (no new schema)

The "remembers previous conversations" requirement is served by the existing `chat_messages` table (Phase 3 of the v0.1.x rollout) — every chat turn is already persisted. `/api/chat/route.ts` between auth resolution and the orchestrator call:

```ts
const all = await getAccountStore().listChatMessages(userId)
const priorContext = all
  .filter(m => m.sessionId !== sessionId)
  .slice(0, PRIOR_CONTEXT_LIMIT)   // 10
  .reverse()                        // newest-first → chronological
```

Passed to `runOrchestrator(config, { ..., priorContext })`. Inside the orchestrator, `buildPriorContextBlock(messages)` (in `src/lib/ai/system-prompt.ts`) renders the block:

```
--- Prior context ---
From the user's previous session (N turns):
user: ...
assistant: ...
```

This block joins the existing `contextPacket` in `systemAddendum` — the per-user channel that lands AFTER the cached catalog prefix on both DeepSeek and Anthropic. The cache stays valid; only the per-user suffix re-evaluates.

Local mode: `listChatMessages` returns `[]` because `LocalAccountStore`'s implementation can't reach `window.localStorage` from a Node route handler. Prior-context injection is therefore supabase-only in practice. Documented as a known limitation; doesn't break the demo because the demo is single-session.

## `/account` page

`src/app/account/page.tsx` — server component, `force-dynamic` (so CI builds don't try to prerender without Supabase env vars). In supabase mode: resolves auth server-side, redirects to `/auth/login?redirect=/account` if no session. Renders:

- Initials avatar + display name + email (or "Demo mode" badge in local mode).
- Orders list (`AccountOrdersList` client island reading the existing `OrdersSlice`). Newest-first, expandable to show line items + totals. Uses `getAssetById()` from `src/lib/asset.ts` to resolve composite asset ids (`product:gyuto-240`) to human titles.
- Sign-out button (`SignOutButton` client island; supabase mode only).

No tabs, no library shelf, no "I cooked this" — those were MISE-era v0.3 ambitions, dropped in the pivot (see the banner above).

## Entry hero personalization

`src/components/sections/EntrySection.tsx` gates on `isSupabaseMode = NEXT_PUBLIC_DATA_MODE === 'supabase'`:
- Local mode: unchanged ("What do you want to cook?", no auth UI).
- Supabase mode + signed-out: existing copy + "Returning · Sign in" link in the wordmark's tracking-wide uppercase style.
- Supabase mode + signed-in: "Welcome back, $name." + "What's tonight's question…" subtitle + "Your account" link.

## localStorage → Supabase migration

`src/lib/account/migrate-from-local.ts` — fires from `useAuth.applyUser` when transitioning to signed-in. Idempotent via the `intently.migrated.v1` marker (one-shot per device per user).

Reads `intently.kitchen.v1`, `intently.orders.v1`, `intently.taste.v1`, `intently.profile.v1` via the local AccountStore impl (so JSON parsing logic stays in one place) and writes through the Supabase AccountStore. Per-row failures are logged and skipped — best-effort. On full success: source keys cleared. On partial failure: source keys left in place so a marker-clear retries cleanly.

No last-write-wins timestamp comparison in v0.2 — first-signin (the common case) has no Supabase data to compare against, and multi-device merge isn't a v0.2 use case. Documented as a deferred refinement.

## What the v0.2 land does NOT include

- `/kitchen` page proper (Shape A library shelf) — v0.3.
- "I cooked this" button — v0.3 with `/kitchen`.
- Tool-ownership "I already have one" toggle — v0.3.
- Custom magic-link email template + sender domain — v0.2 polish queue (see `docs/roadmap.md`).
- Display-name editing on `/account` — read-only in v0.2, edit lands in v0.3.
- OAuth providers (Google, GitHub) — v0.3 trigger.
- Account deletion UI — schema cascades; UI is v0.3.
- Multi-device session listing — v0.3+.
