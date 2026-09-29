---
type: concept
status: stable
updated: 2026-05-25
sources: [claude-md]
tags: [admin, operator-guide, how-to]
---

# Admin panel — operator guide

Practical reference for everything you can do at `/admin/*`. The architecture lives in [[admin-zones]]; this page is the "I want to do X — where do I click" companion.

The panel ships with seven surfaces today:

| Path | Purpose |
|---|---|
| `/admin` | Landing — status grid of every surface |
| `/admin/analytics/chips` | Per-chip impressions / clicks / CTR on the entry hero |
| `/admin/analytics/conversion` | Recommendation → order rate, any-touch attribution |
| `/admin/analytics/sessions` | Funnel: entry → first input → conversation → discovery → click → order |
| `/admin/analytics/ai` | Tiered orchestrator: tier distribution, latency, validation reasons |
| `/admin/campaigns` | Editorial banners + AI prompt-bias campaigns |
| `/admin/users` | Read-only inspector for one user's Intently-side data |

PIM (read-only product / recipe viewer) is queued for Phase 4; the strategy decision is captured in [[pim-strategy]].

## Access

### Local dev — no gate

When `ADMIN_AUTH_ENABLED` is unset or `false`, the gate is bypassed. `/admin` is reachable to anyone who guesses the URL. This is the current dev disposition and matches how the chips dashboard originally shipped — the magic-link signin flow is too fragile for routine admin access right now.

The gate-off behaviour is **only safe on localhost.** Before any public deploy you flip the switch (see below).

### Enforced — env-var allowlist

When you want the gate on:

```bash
# In .env.local for laptop dev, or in the Vercel project env for deploy.
ADMIN_AUTH_ENABLED=true
ADMIN_USER_IDS=<your-supabase-user-uuid>,<second-admin-uuid-if-any>
```

The user IDs are the Supabase Auth user IDs — copy them from the Supabase dashboard once you've signed in once via magic link, or generate a link with `npm run admin:login-link` (no email needed).

The gate calls `notFound()` (404 — not 403) for anyone not on the allowlist. **404 is deliberate** — we don't want to advertise the admin URL's existence to probes.

### One-command local launch

```bash
npm run dev:localsetup
```

Sources `~/.zshenv`, fills gaps from `.env.local`, asserts the four required keys (DEEPSEEK + 3× Supabase), forces `NEXT_PUBLIC_DATA_MODE=supabase` + `NEXT_PUBLIC_AI_MODE=tiered`, runs the service-role sanity check, then boots `next dev -p 3000`. This is the "I want to run Intently the way it's meant to run" entry point.

## Analytics — what to look at, when

### Chips (`/admin/analytics/chips`)

Two tables: anonymous traffic + signed-in traffic. Each chip label gets impressions, clicks, CTR, and an "in pool / retired" flag. The default range is 7 days; switch via the picker.

**When to look:** when the chip pool changes, or weekly to spot dying chips. CTR below ~3% on a chip with meaningful impressions is the retire signal.

### Recommendation conversion (`/admin/analytics/conversion`)

Two tables: Products + Recipes. Per asset: impressions, clicks, CTR, orders, CVR. Display name resolved from the catalogue.

**Attribution caveat:** any-touch. When a recommendation event surfaces three assets and one ordered, all three get credit. Read the per-asset CVR proportional to bundle size — it's directionally right, not literally accurate. The page header repeats this so you don't forget.

**When to look:** weekly to see which recipes drive orders, monthly to retune editorial weights based on actual data.

### Session funnel (`/admin/analytics/sessions`)

Six stages from entry to order. **Critical caveat:** the entry stage uses chip session IDs (sessionStorage), Stages 2+ use chat session IDs (minted by `/api/chat/session`). They are **different namespaces** and can't be linked per-session. The "% of entry" column on chat stages is therefore an estimate, not deterministic retention. The amber ⓘ glyph on those rows is your reminder.

**When to look:** to answer "where do we lose people" at the high level. The chip → first input drop is the most useful — it tells you whether the entry hero is converting curiosity into engagement.

### AI tier telemetry (`/admin/analytics/ai`)

Distribution across the five tiered-orchestrator outcomes (`tier-1-deepseek`, `tier-2-validator`, `tier-3-haiku`, `tier-4-sonnet`, `fallback`) plus latency p50/p95/p99, flags (guardrail disabled, truncated at length), and the top-10 validation reasons. Healthy distribution is annotated on the row: ≥80% on the validator, ≤20% on Haiku, ≤5% on Sonnet.

**When to look:** when a chat response feels off, when DeepSeek seems flaky, or weekly as a heartbeat. If `truncated at length` is non-zero, your prompts are hitting the token cap — raise `AI_MAX_OUTPUT_TOKENS` or trim the addendum.

## Campaigns — running an editorial moment

Two campaign types, one workflow.

### Banner — entry-hero override

Replaces the headline (and optional subheading) on the entry hero for everyone who lands during the active window. The wordmark and input stay put; the banner is a content swap, not a layout swap.

Recipe:

1. `/admin/campaigns/new?type=banner` (or click "+ New" → Banner).
2. Fill in **name** (internal label, e.g. "spring menu launch"), **heading** (the visible copy), **subheading** (optional smaller text), surface = `entry_hero`.
3. Set **active from** to "now" (the form defaults to current time) and **active until** to your end date (blank = open-ended).
4. Set **initial status** to `active` if you want it live immediately, or `draft` to stage it.
5. Save. You land on `/admin/campaigns/[id]`. Visit `/` — the override is in within ~60s (the cache TTL); use the status-bar toggle to pause / resume.

**Priority rule on the headline:** banner override > "Welcome back, X" personalised greeting > default. Editorial intent always wins because that's the point of running a campaign.

**Multiple active banners:** if you have two overlapping, the one with the most recent `active_from` wins. Use this for "soft-launching" a refresh — leave the old one active until the new one starts.

**CTA fields:** present in the form but **not rendered in v1**. The hero doesn't carry a CTA button by design. If you fill them, they live in the payload for the day we wire them up — they don't break anything.

### Prompt bias — nudge the AI

Adds a system-prompt addendum + optional ranker boosts. Think of it as "for the next 14 days, the AI gently prefers Japanese knives" or "when intent is buy, surface the spring product list first."

Recipe:

1. `/admin/campaigns/new?type=prompt_bias`.
2. **System addendum** — a paragraph or two appended to the orchestrator's system prompt. Wrapped at runtime with `--- Active editorial campaigns ---` so the model knows it's a server directive. Plain instruction is best — "For the next two weeks, prefer spring-forward Japanese recipes when intent allows."
3. **Product / Recipe id boosts** — comma-separated inner IDs (`gyuto-240, nakiri-180`). Each id gets a flat +15 score in the deterministic ranker. Defensively bounded: a boosted product can't override a clear taste-nope signal — `+15 < tasteAlignment cap of 40`.
4. **Tags / intent filter** — accepted in the form for forward compat, **not honoured by the v1 ranker**. Don't waste time filling them today.
5. Save → set status → live. Verify by sending a chat that's relevant; the response should bias toward the boosted ids. The addendum + boost are logged in the orchestrator's debug output.

### Status transitions

Every campaign goes `draft → active → paused → archived` (or any subset). The four buttons on the detail page move it. **Every transition writes to `admin_audit_log`** — you can grep it later to answer "who paused this when and why."

### Cache busting

The active-campaigns read is cached for 60 seconds. Admin mutations (`create / update / status change`) call `updateTag` so changes are visible within the request, not after the TTL. If a status flip seems delayed, give it ~5 seconds — the SSR cache on `/` is the slowest piece.

## Users — the inspector

Read-only view of one user's Intently-side data. **Strict invariant: no admin writes to user-scoped data.** Support inspects, never mutates.

**List page** (`/admin/users`): search by email / display name / id. Paginated 50/page. Click a row to drill in.

**Detail page** (`/admin/users/[id]`): six panels load in parallel —

1. **Profile** — id, email, display name, created.
2. **Taste signals** — every love/skip/nope the user has cast, newest first.
3. **Library** — assets acquired (orders + manual additions), with acquired-from + cooked-at.
4. **Orders** — placed orders with their line items, cents formatted as dollars.
5. **Chat messages** — last 200 messages, grouped visually by role (assistant rows in moss-tinted background). Tier resolution shown when present.
6. **Recommendation events** — last 200 events with asset_ids, click + order stamps.
7. **Chip events** — last 200 chip impressions / clicks the signed-in user generated.

Each tab caps at 200 rows. If you need deeper history, query `chat_messages` etc. directly in Supabase.

**When to use:** debugging a chat session, reproducing a support report, sanity-checking that a user's taste signals look reasonable for the recommendations they're seeing.

The one admin write touching users — **promote / demote** — is **not a UI action**. Edit `ADMIN_USER_IDS` in `.env.local` (or the Vercel env) and restart. Deliberate: a UI toggle for "make this person an admin" is too easy to fat-finger.

## Common workflows

### "Launch a spring menu banner"

1. `/admin/campaigns/new?type=banner` → headline "spring menu drops monday" → active_from now, until next Monday → status active → save.
2. Open `/` in another tab → confirm the headline rendered.
3. On launch day: status → paused (preserves history) or archived (cold storage).

### "Bias the AI toward Japanese knives for a week"

1. `/admin/campaigns/new?type=prompt_bias` → addendum "For the next week, prefer Japanese knives when the user mentions slicing, prep, or knife skills." → productIds = `gyuto-240, nakiri-180, yanagiba-270` → 7-day window → status active → save.
2. Chat with `/` and ask about knife skills — the recommendations should lean Japanese.
3. After the campaign window closes, the addendum + boost disappear automatically (no manual cleanup needed).

### "Why didn't this user convert?"

1. `/admin/users/[id]` → check **Recommendation events** → look for clicked_at without ordered_at rows.
2. Chat messages → see what the user said in the relevant session.
3. Cross-reference with `/admin/analytics/conversion` to see if the surfaced products are converting *generally* — if not, it's a catalogue issue, not a user issue.

### "Is the AI healthy?"

1. `/admin/analytics/ai` (default 7d) → confirm tier-2 share is ≥80%.
2. Check **truncated_at_length** — should be near zero. Non-zero means responses are getting cut off.
3. Scan top validation reasons — repeated "unknown-product" or "off-catalog-brand" entries indicate DeepSeek is hallucinating; consider tightening the catalog summary or adding examples.

### "Audit who changed what"

The `admin_audit_log` table records every campaign mutation. There's no UI yet — query directly:

```sql
select created_at, actor_user_id, action, target_id, payload
from admin_audit_log
order by created_at desc
limit 50;
```

An audit-log UI is queued for Phase 4+ if the table becomes large enough that grep stops being enough.

## Production hardening checklist

Before exposing `/admin/*` publicly (Vercel, custom domain, anything not localhost):

- [ ] `ADMIN_AUTH_ENABLED=true` in the deploy env
- [ ] `ADMIN_USER_IDS` populated with the actual operator UUIDs
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set (and never inlined into a client bundle — keep the no-`NEXT_PUBLIC_` prefix discipline)
- [ ] Magic-link SMTP reliable enough for routine admin signin (currently fragile; tracked in `intently/docs/roadmap.md` polish queue)
- [ ] Verify a non-allowlisted browser session 404s on `/admin`
- [ ] Verify `/admin/analytics/*` shows real data (CTR, conversion, tier distribution) — confirms service-role read is wired

The `prodprep.md` entry "ADMIN_AUTH_ENABLED defaults to false" captures the first three.

## What's not built (and why)

- **Edit user data** — explicit invariant, see Users section.
- **Discount / promo codes** — Medusa-zone per [[admin-zones]]. Don't build.
- **Order list / refunds / inventory** — Medusa-zone.
- **PIM authoring** — queued; strategy decision in [[pim-strategy]].
- **Audit-log UI** — query SQL directly until volume warrants UI.

## Related

- [[admin-zones]] — what we build vs what we defer to Medusa
- [[campaigns]] — schema + integration contract for the campaign system
- [[chip-entry-strategy]] — the chip analytics surface this page complements
- [[tiered-ai-architecture]] — what the AI telemetry page is observing
