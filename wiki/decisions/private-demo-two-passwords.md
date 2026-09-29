---
type: decision
status: stable
updated: 2026-07-27
sources: [session-2026-07-27-site-gate]
tags: [security, auth, deployment, proxy, vercel]
---

# private-demo-two-passwords

The cloud demo is **private end to end** as of 2026-07-27. `intently/src/proxy.ts` gates
`/:path*` — pages, static chunks, `/api/discover`, everything — not just `/admin/*` as it did
from 2026-06-17. Two independent shared passwords, either of which may be unset:

| Variable | Scope |
|---|---|
| `SITE_BASIC_AUTH_PASSWORD` | the whole deployment |
| `ADMIN_BASIC_AUTH_PASSWORD` | `/admin/*`, `/api/admin/*`, `/api/enrichment/*` |

## Why two passwords, not one

One password would mean the credential handed to a prospect also opens the Studio — the vector
inspector, the situation tuner, the model bench, the analytics. The demo audience and the
operator audience are different people; collapsing them is a downgrade from the pre-2026-07-27
state, where the demo was public and admin was private.

So the admin password is a **master key, not a separate silo**: it opens shopper routes too (one
operator credential is enough), but the site password never opens admin.

## The non-obvious rule: each variable gates only its own scope

The subtle part, and the bug caught during implementation:

> **What *activates* a gate and what *opens* it are different questions.**

The first implementation folded them together — `accepted = [site, admin]` for shopper routes,
gated if *any* accepted password existed. That made setting only `ADMIN_BASIC_AUTH_PASSWORD`
silently close the shopper river, because the admin password was in the accepted list. Correct
behaviour: `ADMIN_BASIC_AUTH_PASSWORD` alone must leave the river public, exactly as it was
before this change, so widening the gate is a **no-op for existing deploys** until the site
password is deliberately set.

The code now computes `gate` (presence decides whether to challenge) separately from `accepted`
(which passwords satisfy the challenge). `src/tests/proxy.test.ts` pins all four configurations;
the admin-only case carries the regression comment.

## What stays reachable

`POST /api/analytics/order` only — the host storefront's order webhook. It authenticates with
`INTENTLY_WEBHOOK_SECRET` and is called by a backend that cannot answer a Basic Auth challenge.
Every other route, including its sibling `/api/analytics/track`, is behind the gate. The
exemption is a prefix list in the proxy, not a matcher regex, so it's greppable and testable.

## Why static assets are gated too

A "private" site whose JS bundle and product images are anonymously fetchable is not private —
the catalogue and the whole client app would be readable without the password. Browsers replay
the credential they were challenged for at `/` to same-origin asset requests, so gating
`_next/static` costs nothing in practice. Verified live: an anonymous chunk fetch is 401, the
same URL with credentials is 200.

## Why not Vercel's native Password Protection

Pro-plan feature; this deploy stays on Hobby. Same reason the admin gate was hand-rolled in the
first place — see [[cloud-demo-deployment]].

## What this is not

Not authentication. Shared passwords, no session, no per-user identity, no throttling on failed
attempts, non-constant-time comparison. Enough for a single-operator demo behind an obscure URL;
the residue is named in `prodprep.md`. The real answer, when there are real users, is the parked
Supabase magic-link layer plus an `ADMIN_USER_IDS` allowlist — see [[supabase-auth-over-clerk]]
and [[account-store-auth-aware-client]] — not a better Basic-Auth gate.

## Gotcha: `vercel deploy` from the wrong directory

The `intently` Vercel project has **Root Directory `.`**, so CLI deploys must run from
`intently/`, where `.vercel/` lives. Running `vercel deploy --prod --yes` from the repo root —
which has no link — makes the CLI silently **create a new project** named after the current
directory, with no environment variables. The result is a second, completely ungated copy of the
site on a live URL. Check `.vercel/project.json` before deploying, and check
`vercel projects ls` after. See [[cloud-demo-deployment]] and [[security-key-management]].
