---
type: concept
status: stable
updated: 2026-07-17
sources: []
tags: [security, secrets, keys, cloud, supabase, upstash, vercel, rls]
---

# security-key-management

**Every secret Intently uses is server-side, env-supplied, and absent from the repo.** This page is
the contract: where each key lives, why it's safe there, and what to do when one leaks.

## The inventory

| Secret | Powers | Exposure class | Where it lives |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | analytics events, runtime_kv (config/situations), pgvector | **CRITICAL — bypasses RLS, full DB** | local `.env.local`; cloud: Vercel env (server) |
| `SUPABASE_URL` | the project endpoint | low (not a secret, but pins the project) | same |
| `UPSTASH_REDIS_REST_TOKEN` | rate-limit + LLM-budget counters | medium — write access to counters only | same |
| `UPSTASH_REDIS_REST_URL` | Upstash endpoint | low | same |
| `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` | Tier-1 LLM calls | **high — billable spend** | same |
| `INTENTLY_WEBHOOK_SECRET` | authenticates the storefront order webhook | high — forged orders would poison analytics | same |
| `ADMIN_BASIC_AUTH_PASSWORD` | gates `/admin/*` at the proxy | high — the Studio is the control plane | same |

## The rules (non-negotiable)

1. **No secret is ever committed.** `.env*` is gitignored at the repo root; `.env.example` carries
   only names + comments. Any tracked file containing a live value is an incident (see Rotation).
2. **`NEXT_PUBLIC_` is a loaded prefix.** Next.js *inlines* those into the browser bundle at build
   time. **Never** prefix a service-role key, an LLM key, or a webhook secret with it. Intently
   uses `SUPABASE_SERVICE_ROLE_KEY` (unprefixed) precisely so it cannot be inlined.
3. **Server-only modules are the second line of defence.** `supabase/rest.ts`, `doc-store.ts`,
   `llm-client.ts`, and `guardrails-shared.ts` all `import 'server-only'` — importing them from a
   client component is a **build error**, so a key cannot leak into the bundle by refactor accident.
4. **Service-role never reaches the browser.** All Supabase access is server-side (route handlers +
   server components) via PostgREST with the service-role key. There is no client-side Supabase
   SDK, no anon-key data path, and RLS is enabled on every table as defence-in-depth: even if the
   key were somehow used from a browser context, the tables refuse anon access.
5. **Secrets are read lazily, never at module scope in a shared constant.** Each accessor reads
   `process.env` at call time so a missing key degrades (fail-soft) rather than crashing at import.
6. **Absent key = degraded, never broken.** Missing Supabase → local file store; missing Upstash →
   in-memory counters; missing LLM key → deterministic engine; missing webhook secret → the order
   endpoint answers **501** (loud, not silent).

## Where keys live, per environment

- **Local dev:** `~/.zshenv` is the source of truth on Ilmari's machine (`*_INTENTLY`-suffixed
  Supabase vars, `UPSTASH_TOKEN`, `UPSTASH_REDIS_REST_URL`, `OPENAI_API_KEY`). `intently/.env.local`
  (gitignored) is generated from it — note the **name mapping**: zshenv's `UPSTASH_TOKEN` →
  app's `UPSTASH_REDIS_REST_TOKEN`; `NEXT_PUBLIC_SUPABASE_URL_INTENTLY` → `SUPABASE_URL`;
  `SUPABASE_SERVICE_ROLE_KEY_INTENTLY` → `SUPABASE_SERVICE_ROLE_KEY`.
- **Cloud (Vercel):** **Project → Settings → Environment Variables**, scoped to Production (+
  Preview if used), marked **Sensitive** where offered. Vercel encrypts them at rest and injects
  them into the server runtime only — they never enter the client bundle unless `NEXT_PUBLIC_`-
  prefixed (rule 2). **Do not** ship secrets via `vercel.json`, build args, or committed files.
- **CI:** intentionally keyless. CI exercises the deterministic path; no secret is needed, so none
  is configured — the smallest possible blast radius.

## Supabase project note (2026-07-17)

The live project is **`<supabase-project-ref>`** ("intently", eu-central-1) — it carries the full
migration history 0001–0015. It was paused and got restored when the cloud stores landed. The
service-role key in `~/.zshenv` authenticates **against this project**; `intently-demo`
(`<supabase-demo-project-ref>`) also received the analytics/runtime_kv schema during exploration but is
**not** the project the key targets. If you ever swap projects, the key must swap with it.

## Rotation & incident response

1. **Rotate at the source**: Supabase → Settings → API → *reset service role key*; Upstash → DB →
   *rotate REST token*; OpenAI/DeepSeek/Anthropic → console → revoke + reissue.
2. Update `~/.zshenv`, regenerate `.env.local`, update the Vercel env, redeploy.
3. `INTENTLY_WEBHOOK_SECRET` / `ADMIN_BASIC_AUTH_PASSWORD` are self-chosen — regenerate any long
   random string on both sides.
4. **If a key ever reaches git history**, rotating is mandatory — history rewriting alone is not
   sufficient (the value is already distributed).
5. **Spend safety**: the provider console's monthly cap is the only *hard* financial backstop.
   `DISCOVERY_LLM_DAILY_CAP` + the Upstash counter are the soft, in-app limits.

## Why RLS is on with a service-role key

The key bypasses RLS by design, so RLS looks redundant — it isn't. It's the blast-radius limiter:
if the *anon/publishable* key were ever wired to a client (or a future feature adds one), every
Intently table denies it by default. Security posture should not depend on "we didn't write that
code yet".

## Related

- [[analytics]] — what the events tables hold (anonymous session ids only, no PII)
- `intently/docs/cloud-demo-plan.md` — the Vercel env checklist
- `intently/docs/cloud-architecture-plan.md` (ADR-012) — the admin-hardening item (C1)
