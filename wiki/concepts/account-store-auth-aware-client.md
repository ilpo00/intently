---
type: concept
status: stable
updated: 2026-05-25
sources: [claude-md]
tags: [supabase, auth, rls, account-store, gotcha]
---

# Account-store auth-aware client (browser)

In supabase mode, the `AccountStore` in the **browser** must use the auth-aware Supabase client (`getSupabaseBrowser()` from `src/lib/auth/supabase-browser.ts`, built on `@supabase/ssr`'s `createBrowserClient`). The headless `createClient()` from `@supabase/supabase-js` does **not** carry the session cookie, so PostgREST runs the request as `anon` and `auth.uid()` returns NULL. After migration `0005_enable_rls`, every user-scoped policy is shaped `user_id = auth.uid()::text`, so a NULL `auth.uid()` rejects every write for signed-in users too — not just anonymous ones.

## The trap

Pre-RLS (v0.1.x), the headless anon-key client worked from the browser because all writes were accepted unconditionally. That client was deliberately separate from `useAuth`'s auth-aware client — the comment in `account-store-factory.ts` even called out a unique `storageKey` to avoid the "Multiple GoTrueClient instances" warning in dev.

When 0005 enabled RLS, that same separation became a silent break. Symptom that surfaced it (2026-05-25): the taste grid click logged

```
[intently-store] addTasteSignal persist failed: { code: '42501',
  message: 'new row violates row-level security policy for table "taste_signals"' }
```

— even for signed-in users, because the AccountStore's headless client never sees the auth cookie that `useAuth` deposits.

## The fix

In `src/lib/account/account-store-factory.ts`, the browser branch reuses the same `getSupabaseBrowser()` singleton that `useAuth` uses. One auth-aware client per page = cookies flow + no GoTrueClient instance collision.

The server branch still constructs a headless anon-key client (different env: no cookies anyway). This means **server-side writes to user-scoped tables also fail RLS** — currently latent in `/api/chat`'s `persistTurn` (`recordChatMessage`, `recordRecommendationEvent`). Those writes are best-effort and logged-not-surfaced, so the chat UX doesn't break, but the audit table silently won't fill. Fixing that cleanly needs either `SUPABASE_SERVICE_ROLE_KEY` for the audit writes or a per-request auth-aware server client routed into AccountStore — tracked separately.

## Rules to keep this from regressing

1. Never construct a second `@supabase/supabase-js` client in the browser for AccountStore-style queries. Reuse `getSupabaseBrowser()`.
2. If you add a new user-scoped table, write its policies the same shape: `user_id = auth.uid()::text` in both `using` and `with check`. See [[supabase-auth-over-clerk]] for the wider RLS posture.
3. Anonymous users in supabase mode will still hit RLS on writes — that's correct (no `auth.uid()` → no `user_id` match). The river is gated upstream (`/api/chat` rejects anonymous POSTs with 401), so this surfaces as a 401 at the chat boundary, not as scattered 42501s. If you see a 42501 in the console, it means a write reached the DB without a session — investigate which surface is calling AccountStore for an anonymous user instead of suppressing the warning.

## Related

- [[chat-persistence]] — the route that still has the server-side variant of this bug.
- [[supabase-auth-over-clerk]] — auth provider decision; the RLS-on posture is the constraint that makes this issue visible.
