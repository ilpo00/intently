---
type: decision
status: stable
updated: 2026-05-24
sources: [claude-md]
tags: [auth, accounts, supabase, security]
---

# supabase-auth-over-clerk

For v0.2, **Supabase Auth (magic-link only) is the authentication provider** for Intently. **Clerk and roll-your-own were considered and rejected.** The decision locks in alongside the [[supabase-over-medusa]] choice from v0.1.x — Supabase Auth lives in the same Postgres project that already backs `library_items`, `orders`, `taste_signals`, and `chat_messages`, so RLS policies can read `auth.uid()` directly with no JWT-bridge gymnastics.

## What landed

- One auth surface in the app: `/auth/login` (email field) → magic link → `/auth/callback` → `/account/welcome` (first signin only) → river.
- A `useAuth()` hook (`src/hooks/useAuth.ts`) is the single source of "who's signed in". Non-React callers read the sync mirror in `src/lib/auth/active-user.ts` so the Zustand store's `persist()` helper stays sync.
- All 7 user-scoped tables run RLS with `auth.uid()::text = user_id` policies (`intently/supabase/migrations/0005_enable_rls.sql`).
- `/api/chat` and `/api/chat/conversion` server-extract `auth.uid()` from the session cookie in supabase mode and reject anonymous POSTs with 401 — the `body.userId` / `?userId=` channels are ignored. This closes `prodprep.md:94-107`.

## Why Supabase Auth

- **Zero new vendors.** The existing Supabase project gains an `auth` schema with no extra setup. Magic-link sending is built in.
- **RLS becomes trivial.** `auth.uid()::text = user_id` reads directly from the JWT inside Postgres — no middleware bridge, no JWT template gymnastics. Compare to Clerk where you'd need to forge a Supabase JWT from the Clerk session or proxy every request through a server function.
- **Free at Intently's scale forever.** Magic links cost nothing; Supabase Auth has no per-MAU pricing for the use cases Intently needs.
- **Magic links require no UI we don't have.** One email field, one button. No password complexity, no "forgot password" flow, no OAuth consent screens. Fits the river's minimal aesthetic without bolting on a real account hub.
- **`users.id` was kept text-typed in v0.1.x** specifically to leave this decision open. We chose Supabase Auth's `uuid` and store it as text — no schema migration.

## Why not Clerk

- Better DX and prettier components, but a second vendor introduces a sync layer between Clerk's session and Supabase's RLS. JWT templates work but require ongoing maintenance.
- Paid tier within a year if Intently grows past 10k MAU. Not a problem at v0.2 scale; a paper-cut that compounds.
- Not worth the integration cost for a project explicitly framed as a joy-phase exploration.

## Why not roll-your-own

- Magic-link sender + session cookie + CSRF + rate limit + token rotation is real, repeatable work. The "joy" in Intently is in the recipe/tool surface, not in re-implementing auth primitives.
- The crypto + cookie hygiene is the kind of thing where Supabase's defaults are better than anything I'd hand-roll under deadline pressure.

## Trade-offs accepted in v0.2

- **Magic-link only — no OAuth providers (Google, GitHub).** Magic link covers the demo use case. OAuth lands when sign-up conversion bottlenecks on "yet another email" (per `docs/roadmap.md` polish queue).
- **The default Supabase email template is bleak.** Functional for dev verification, wrong for any real launch. Tracked in `docs/roadmap.md` polish queue.
- **No custom sender domain.** `noreply@supabase.co` reads as spam to many MUAs. Needs Resend / Postmark / SES + DNS records — out of scope for v0.2.
- **No display-name editing on `/account`.** The welcome page captures it on first signin; there's no edit path after. Read-only is honest scaffolding for v0.2.
- **No sign-out from inside the river.** `/account` is the only sign-out surface. v0.3 likely adds a persistent header element, but wait for `/kitchen` design before committing to its shape.
- **Anonymous users in supabase mode cannot chat.** `/api/chat` returns 401 without a session. The river still renders (catalogue is publicly readable) and the entry hero shows a "Returning · Sign in" link. The local-mode demo path keeps the anonymous-chat experience for CI / no-key contributors.
- **Local mode preserves DEMO_USER_ID.** `NEXT_PUBLIC_DATA_MODE=local` short-circuits `useAuth()` to a synthetic signed-in state for the demo user. CI and the no-key demo keep working unchanged.

## When to revisit

Re-open this ADR when at least one of the following becomes a real concern:

1. Sign-up conversion bottleneck on email-only (need Google / GitHub OAuth).
2. Sustained pain from RLS-cast bugs (`auth.uid()::text` mistakes) — could be argued as a reason to move to a thinner identity layer.
3. Multi-org / shared-account semantics on the roadmap (Supabase Auth's "user" model is single-identity; Clerk has richer org primitives).
4. Custom email infra needs that outgrow Supabase's outbox.

Until then, Supabase Auth covers everything Intently needs.

## Related

- [[supabase-over-medusa]] — sister decision; Supabase chosen as the v0.1.x account backbone. This ADR is its v0.2 sequel.
- [[claude-md]] — root project guidance; "Data layer — catalogue vs accounts" + "Auth" sections.
- `intently/docs/account-backbone.md` — v0.1.x schema, AccountStore interface, mode toggle. Gets a v0.2 appendix covering the auth flow + RLS + memory injection.
- `intently/supabase/migrations/0004_auth_v02.sql` — profile columns (email, avatar_url).
- `intently/supabase/migrations/0005_enable_rls.sql` — the security flip, wrapped in BEGIN/COMMIT for atomic apply.
- `intently/src/hooks/useAuth.ts` — single auth source.
- `intently/src/lib/auth/{supabase-browser,supabase-server,active-user}.ts` — SDK wrappers + sync mirror.
