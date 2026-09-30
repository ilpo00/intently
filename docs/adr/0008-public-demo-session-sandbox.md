# ADR-0008 — The open-web demo is a per-visitor sandbox, enforced at the route

- **Status:** Accepted (2026-09-30); implemented. Deployed once and rolled back the same hour (the Redis database the sandbox depends on no longer existed — see ADR-0006); live again 2026-09-30 on a new database, verified from outside
- **Detail:** `intently/src/lib/public-demo.ts`, `public-demo-guard.ts`, `store/sandbox.ts`, `store/doc-store.ts` · tests `public-demo-sandbox.test.ts`, `public-demo-guard.test.ts`

## Context

The demo was private behind a two-password gate (see
[private-demo-two-passwords](../../wiki/decisions/private-demo-two-passwords.md)).
The goal changed: a visitor arriving from a portfolio page should be able to use
**both** the shopper view and the Studio, with no password.

Removing the gate exposes three things the gate had been hiding:

1. Several admin routes spend money or rewrite data every visitor shares —
   vision enrichment, embedding sync, vector deletes, the model bench's live
   LLM calls, the data reset.
2. The Studio's runtime config selects the provider and model and holds the
   daily LLM cap, and the shopper route reads it on every turn.
3. Studio edits are shared state. One visitor's curation would change what
   every other visitor sees.

## Decision

One flag, `INTENTLY_PUBLIC_DEMO=1`, default off. The flag itself opens the gate: the two passwords are ignored while it is on and take effect again the moment it is turned off, so going public is one reversible switch and no secret has to be deleted. In that mode:

- **Session sandbox at the storage chokepoint.** The proxy gives each visitor a
  session (httpOnly cookie, plus the id as a request header it always
  overwrites). The doc-store reads "this visitor's copy, else the shared base"
  and sends every write or delete to the visitor's copy only — Upstash, 24 h
  TTL. The shared base is never written in public mode; a write with no
  resolvable session is dropped. A delete is a tombstone, so "revert" means the
  built-in default for that visitor.
- **Refusal at the route, not the UI.** Cost and shared-mutation routes return
  403 before doing anything. The UI explains; it is not the control.
- **Cost limits are not the visitor's to set.** The caps always come from the
  shared config, and a stage may only use its provider's default model.
- **The model bench replays recordings.** Real outputs, captured once per
  sample query and provider; the deterministic engine still runs live.
- **The shopper conversation keeps the real LLM tier,** under the existing
  complexity gate, per-IP limits and global daily cap (ADR-0002, ADR-0006).

Rejected:

- *Hide the buttons in the UI.* The API is public; a hidden button protects
  nothing.
- *Keep the overlay in the browser and send it with each request.* The Studio
  pages read state in server components, so a browser-held overlay would not
  reach them without reworking every page.
- *A read-only Studio.* Safe, but it removes the point: seeing that a
  merchandiser's edit changes the recommendation.
- *Per-visitor re-embedding.* Would make the semantic-search readout move, but
  costs embeddings per edit and needs per-session vectors.

## Consequences

- A visitor's curated attribute changes their own discovery results at once,
  because the discover route merges overrides into the candidate list. This
  also fixed a standing defect: the default deterministic path had not been
  applying curator overrides at all.
- In public mode the Studio's semantic-search rank does not move after an
  edit (no re-embed). The UI says so instead of showing a misleading "no
  change".
- Moving product overrides and the attention queue onto the doc-store (needed
  for the sandbox) also fixed their persistence on serverless in every mode.
- Worst-case spend on the open site is the shopper path's global daily cap
  times the per-call price; the Studio contributes nothing beyond small,
  rate-limited query embeddings for its search box.
- The sandbox adds about five Redis reads per shopper turn (one per document
  the turn consults) on top of the two guardrail counters. On the free tier's
  10,000 commands a day that is room for roughly 1,400 turns — fine for demo
  traffic. If it grows, store a session as one hash and read it once.
- The operator's real Studio (live enrichment, real config) now means running
  locally or a separate private deployment.
