# prodprep.md — Pre-production checklist

Things the code does that are **fine for a single-operator demo but must be
addressed before real users, multiple replicas, or public exposure.** Not a
roadmap (that lives in `intently/docs/roadmap.md` and the wiki) — this is the
residue from code reviews where the right call was "acceptable now, name it
so it isn't forgotten."

Entries for code removed in the MISE → Intently pivot live in
[`docs/archive/prodprep-mise-era.md`](docs/archive/prodprep-mise-era.md) —
kept for when the Phase-2 account layer is revived. Resolved entries stay at
the bottom for one review cycle so the fix is visible, then move to the archive.

_Last full review against the code: 2026-09-29._

---

## Security

### `ADMIN_AUTH_ENABLED` defaults to false — `intently/src/lib/auth/admin-guard.ts`

**Corrected 2026-06-17 (verified against code):** this entry previously pointed at `admin-allowlist.ts`, which does not exist in the current tree — a stale reference from before the MISE→Intently pivot. The real file, `admin-guard.ts`, is a hardcoded stub: `requireAdmin()` always returns an allowed user, `assertAdminApi()` always returns `null` (never denies), regardless of `ADMIN_AUTH_ENABLED` / `ADMIN_USER_IDS`. **Setting those two env vars today has no effect** — there's no code path that reads them.

Real protection now comes from a different layer: `intently/src/proxy.ts` (added 2026-06-17, the Next.js 16 `proxy` convention — `middleware.ts`/`export function middleware` is deprecated in favor of `export function proxy`) HTTP-Basic-Auth-gates the deployment behind shared secrets. It's deliberately minimal — shared passwords, no per-user identity, no session — chosen because Vercel's native Password Protection is Pro-plan only and this deploy stays on Hobby. Good enough for a single-operator demo; **not** a substitute for a real allowlist (`admin-guard.ts` reading `ADMIN_USER_IDS` against an authenticated identity) if this ever needs multiple admins or per-user audit trails. Before that real gate ships, `admin-guard.ts` needs an actual implementation — today it's still a stub regardless of the Basic-Auth gate being set at the edge.

**Widened 2026-07-27:** the gate now matches `/:path*` (the whole deployment, static assets included) with two independent passwords — `SITE_BASIC_AUTH_PASSWORD` for everything, `ADMIN_BASIC_AUTH_PASSWORD` for `/admin/*`, `/api/admin/*`, `/api/enrichment/*`. Each variable governs only its own scope, so an admin-only config still leaves the shopper river public. `POST /api/analytics/order` is exempt by design (it authenticates with `INTENTLY_WEBHOOK_SECRET`; a webhook caller can't answer a Basic challenge). Live on the cloud demo since 2026-07-27.

### The Basic-Auth gate has no rate limiting and compares passwords non-constant-time — `intently/src/proxy.ts`

Now that the gate fronts *every* request rather than just `/admin`, two dev-acceptable shortcuts are worth naming:

- **No throttling on failed attempts.** The gate is a shared password with unlimited guesses from any IP. Fine for an obscure demo URL; not fine for anything with real users or a guessable password. The discovery routes have their own rate limiter (`DISCOVERY_RATE_PER_MIN`), but it sits *behind* the gate and never sees a 401.
- **`accepted.includes(supplied)` is a non-constant-time comparison,** so it leaks timing. Practically unexploitable across the internet against a Vercel function, but it's the kind of thing a security review flags. A `timingSafeEqual` over the UTF-8 bytes (padded to a fixed length so the length itself doesn't leak) is the fix.

Both become real the moment this fronts anything but a single-operator demo. The proper answer at that point isn't a better Basic-Auth gate — it's the real auth layer (Supabase magic-link + `ADMIN_USER_IDS` allowlist) that the entry above describes.

### Client IP for rate limiting is taken from a spoofable header — `intently/src/app/api/discover/route.ts`, `intently/src/lib/discovery/guardrails.ts`

Per-IP rate limits and the global daily LLM budget live in process memory: correct on the single-replica demo, silently ineffective under multiple replicas (each replica gets its own counters → real limits are N× the configured ones), and reset on every deploy. `x-forwarded-for` is also trivially spoofable without a trusted proxy in front. Before prod: move counters to a shared store (Redis/Upstash or an edge rate-limiter), take the client IP from the trusted proxy header only, and consider per-session (cookie) limits alongside per-IP.

**Partly resolved (2026-07-17):** the counter half is fixed — `guardrails-shared.ts` moves the per-IP rate limit and the global daily LLM budget onto Upstash Redis (`INCR` + `EXPIRE`, replica-safe, fail-open to in-memory), live on the cloud demo. What remains: the IP is still read from the first `x-forwarded-for` value, which a client can set. Before prod: take it from the platform's trusted header (on Vercel, `x-real-ip` / `request.ip`) and add a per-session (cookie) limit alongside per-IP.

### The action-claim verifier is a denylist that generalises poorly — `intently/src/lib/discovery/verify.ts`

`claimsUnsupportedCapability` is the always-on guard against the LLM re-voicer promising what Intently can't do ("I've ordered it", "ships tomorrow"). Measured by `scripts/scorecard.eval.ts` (2026-09-29): **100% on the phrasings it was tuned on, ~30% on a held-out set** written before tuning — e.g. "I've gone ahead and ordered it", "Delivery is on us", "Your parcel will be dispatched today" pass. Product grounding (naming an unshown product) is exact and at 100%; this entry is only about action/fulfilment claims. Low blast radius today (generation is off by default, prose is short, the faithfulness gate constrains structure), but it is the weakest link in "the LLM phrases, it never promises."

Before prod, pick one: (a) an LLM verifier pass on re-voiced prose (a cheap classifier call, only when generation ran — budget it under the existing daily cap); or (b) — the more architectural fix — narrow what generation may write: per-product "why" lines and the question wording only, via structured output, so free-form sentences about the cart/delivery can't be produced at all. Do **not** keep growing the regex list against the held-out set; that just destroys the measurement.

---

## Robustness / Correctness

### Consultation parsing regexes are demo-tuned — `intently/src/lib/discovery/{session,attributes}.ts`

Two regexes added with the tailor consultation layer are calibrated to demo phrasings, not real traffic (budget-conscious cue false-positives on "the price doesn't matter"; `NON_REQUEST_CUE`'s 18-char window misses long clauses).

**Largely addressed (2026-06-11):** the Tier-1 LLM parser (`DISCOVERY_PARSER`, see [[tiered-conversation]]) is the prescribed fix landing — it handles paraphrase/negation/indirection and merges regex-first. BUT the regex remains the fallback (CI/no-key/error path), so these regex weaknesses still bite when the LLM is off or errors. Before prod: either run the LLM parser as the live default with the regex purely as fallback (accept the weaker fallback), or tighten the two cues (negation handling on budget; widen `NON_REQUEST_CUE`).

### Audience filtering is category-granular only — `intently/src/lib/discovery/prefilter.ts`, `intently/src/lib/discovery/attributes.ts`

The blind-tailor audience question (2026-07-06) hard-excludes dress/skirt/heels for `audience='men'` — but that's the finest granularity the data supports: the catalogue has **no per-item gender/presentation field** (verified: zero records mention men/women/ladies). Observed consequence in live testing: a white camisole ranks — even as best match — under `top` for a "for him" brief, because 'top' is an unisex *category* while that *item* reads femme. Same class of issue for wrap-silhouette tops, etc.

Fix path when this matters: add a `presentation` field per item via a vision-enrichment pass (the Haiku photo-reader already extracts silhouette/occasions; presentation is one more attribute, ~$0.50 for the full catalogue), then tighten the audience filter item-wise. Until then the tailor never *claims* gender fit in why-lines (voice rule: attribute-backed claims only), which keeps the residual honest rather than wrong.

### Vision-catalogue mode has no outdoor catalogue — `intently/src/lib/data.ts`

With `NEXT_PUBLIC_CATALOG=vision` (the demo flag), every product is `catalog: 'fashion'`. A hiking-flavoured query still routes through `inferCatalog` → `'outdoor'` → `getProductsByCatalog('outdoor')` returns `[]` → zero results, and the consultation goes quiet (info-gain guard needs ≥6 candidates). Pre-existing before the consultation layer, but the tailor experience makes the dead-end more visible. Before any demo that might field outdoor questions: either route everything to `'fashion'` under vision mode, or accept and script around it.

### Companion-pool retrieval couples the route to slot vocabulary — `intently/src/app/api/discover/route.ts`

In vector mode the route fetches the outfit-completion pool with a hardcoded query suffix (`"layer jacket sweatshirt shirt trousers backpack cap"`). Adding a slot with new categories to `companions.ts` requires remembering to extend that string, or vector-mode rails silently thin out. Fine while slots are few; before prod, derive the suffix from the slot templates (export the union of `companionCategories`).

### Discovery route assumes the first cart item is the anchor — `intently/src/app/api/discover/route.ts`

When DISCOVERY_GENERATION is on, the route extracts the "unstocked garment" for the re-voicer via `/No (\w+) in the collection today/.exec(outcome.message)` — i.e. it parses the engine's own rendered prose. Change `garmentGapPrefix`'s wording and this silently yields no gap garment (the re-voicer just loses that fact; not user-breaking, but invisible). Before prod: have the engine return `gapGarment` structurally on the DiscoverResponse instead of round-tripping through the message string. Same shape applies to `cartSettled: cart[0]?.category`, which assumes the first cart item is what the engine anchored on.

**Partly resolved:** the gap-garment half is fixed — the engine now returns `gapGarment` structurally on its outcome (the route no longer regexes its own prose). The `cartSettled: cart[0]?.category` assumption remains.

### Consultation question-bank ids are a client↔server wire contract — `intently/src/lib/discovery/consult.ts`

A tapped option sends `{ questionId, optionId }`; the server resolves it against ITS question bank. If client and server versions skew during a rolling deploy (or the bank is renamed), `applyAnswer` silently no-ops — the tap shows the label as a user message but applies nothing, and the parser fallback only catches labels that happen to parse. Single-replica dev never hits this. Before prod: log a warning on unknown ids and fall back to parsing the label text.

### `process.cwd()` for file paths — `intently/src/lib/log.ts`, `intently/src/lib/store/doc-store.ts`, `intently/src/lib/enrichment/vector-store-local.ts`

Local-mode state files (`.logs/ai.log`, `.enrichment/*.json`, the local vector store, the analytics JSONL sink) resolve from `process.cwd()`. Where the dev server is started from determines where these files land; run it from a different cwd (e.g. a deploy script) and state is silently split across locations. On the cloud deployment these paths are bypassed (`INTENTLY_STORE=supabase`, `LOG_FILE_ENABLED=false`), so this is a local/self-hosted concern.

Anchor to a known marker — walk up from `__dirname` looking for `package.json`, or read from an explicit env var (`INTENTLY_STATE_DIR`) with a documented default. (The MISE-era `src/lib/ai/budget.ts` this entry originally named was removed in the pivot.)

---

## Platform constraints

### Xenova embedder mode does not run on Vercel — `intently/src/lib/enrichment/embedder.ts`

**RESOLVED for the deployment (2026-07-06)** via `ENRICHMENT_EMBEDDER=openai`: `OpenAIEmbedder` (text-embedding-3-small at `dimensions:384`, batched, tested) runs on any serverless runtime. The deployed sync + semantic search are verified live against the user's `intently` Supabase project (292 rows, `text-embedding-3-small@384`). What remains true and must not be forgotten:

- `ENRICHMENT_EMBEDDER=xenova` (the local-dev default) still cannot run on Vercel — the `@xenova/transformers` onnxruntime native binary isn't in the function environment. Don't flip the deployed env back to xenova.
- **Stored + query vectors must come from the same embedder.** Local dev uses Xenova against the local file store; the deployment uses OpenAI against Supabase — two consistent pairs. Cross-wiring them (e.g. local Xenova writes into the Supabase store) makes search silently garbage. Switching embedders on a populated store = clear + full re-sync.
- `@xenova/transformers@2.x` is end-of-life (renamed `@huggingface/transformers`) — migrate or drop when the local-embedding path is next touched.

---

## Resolved (kept one review cycle)

### Budget file write race — was `intently/src/lib/ai/budget.ts`

**Resolved (2026-07-17).** The MISE-era file-based budget was removed in the pivot; its successor, the global daily LLM budget in `guardrails.ts`, now runs on an atomic Upstash `INCR` keyed per day (`guardrails-shared.ts`) — exactly the fix this entry prescribed. Unset Upstash → in-memory fallback for local dev/CI.

### Admin curation writes had no durable store on Vercel

**Resolved (2026-07-17).** Product overrides, situation overrides/custom situations, runtime config, vision-run status and the needs-attention queue all go through `intently/src/lib/store/doc-store.ts`: local JSON in dev/CI, Supabase `runtime_kv` on cloud (`INTENTLY_STORE=supabase`). Same keys, same shapes — the swap is a backend change, not a data-model change. Residual: whole-document read-modify-write means two curators editing simultaneously can lose one edit (last-write-wins); fine for a single-operator Studio.

---

## How to use this file

When something dev-acceptable-but-prod-risky comes up in review:

1. Add a section here. Don't fix unless trivial.
2. Add a one-line `// see prodprep.md` comment at the code site if it'd be easy to miss when scanning.
3. Before any prod-bound deployment: read this file top to bottom, fix or consciously defer each item.
4. When an entry is resolved, move it to **Resolved** with the evidence; on the next review, move it to the archive. This file should shrink over time, not grow.
