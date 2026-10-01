> **Archived 2026-09-29 — superseded.** Point-in-time orientation note from
> 2026-07-06. Since then: wise listing shipped and is live; the cloud stores
> (Supabase + Upstash), order webhook, A/B and situation mining landed
> (2026-07-17); the whole deployment went private behind the two-password gate
> (2026-07-27). For current state read the root `README.md`,
> `intently/docs/roadmap.md` and `prodprep.md`.

# Session handoff — 2026-07-06

Read this first in a new session. It's the orientation doc, not the record —
git history and the wiki carry the detail. Branch: `claude/fervent-hellman-e8fc4d`
(worktree `fervent-hellman-e8fc4d`), 14 commits ahead of `main`, about to be
merged. Working tree was clean at handoff time.

## TL;DR

- **Live demo:** https://intently-red.vercel.app — landing, tiered AI
  conversation (DeepSeek), populated vector store (OpenAI embeddings),
  and the new blind-tailor consultation (audience + build questions) are
  all deployed and verified.
- **Committed but deliberately NOT deployed:** "wise listing" (accessory
  scoping + relevance cutoff + confidence-scaled shortlist size). Ilmari
  asked to hold the deploy so he can eyeball the 8/12/3-piece calibration
  on local dev first. **Do not deploy this until he says so.**
- **Next planned topic (not started):** how shopping continues after the
  first item lands in the cart — the upsell/cross-sell design. Foundation
  (cart-aware turns, never re-offering, cart-anchored pivots) already
  exists; the *experience* around it is undesigned.
- **Open decision blocking Phase 7 (CI/CD):** the repo's only git remote
  is GitLab, but `.github/workflows/ci.yml` is GitHub Actions syntax and
  has never run. Ask Ilmari: is there a GitHub mirror, a `.gitlab-ci.yml`
  not yet found, or is the workflow file dead config?

## What shipped this session, in order

1. **Landing redesign** — Concept B ("The Living Preview": editorial input
   + a calm cross-fading example of the payoff, replacing an empty
   canvas), then merged with Concept A's rotating placeholder + promise
   line. See `wiki/concepts/landing-living-preview.md`.
2. **Vercel deployment** — standalone (no Medusa, no basePath), Hobby
   tier, €0 infra. `intently/vercel.json` restored, `.nvmrc` pinned,
   `src/proxy.ts` added (Next 16's `proxy` convention, not the deprecated
   `middleware.ts`) as a minimal HTTP-Basic-Auth gate on `/admin/*` and
   `/api/enrichment/*` — Vercel's native Password Protection is Pro-only
   and this stays on Hobby.
3. **Full-capability wiring** — real keys piped from `~/.zshenv` directly
   into Vercel env vars (never printed, never written to a file):
   `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, Supabase URL + service-role +
   anon keys. `OpenAIEmbedder` built (text-embedding-3-small at
   `dimensions:384` — fits the existing `vector(384)` schema, zero
   migration) because Xenova's native ONNX binary can't run on Vercel's
   serverless runtime at all. Vector store seeded live via the deployed
   Studio's Sync button: 292/292 products, ~$0.0004.
4. **Customer demo script** — `docs/demo-script.md`, a ~12-minute arc with
   a verified query bank, Q&A ammunition, and a landmine table.
5. **Blind-tailor consultation** — on a vague brief, Intently now asks
   instead of guessing: "Who will be wearing it?" and "How should the cut
   sit?", rendered as sketch tiles in the (previously empty) desktop
   canvas. See `wiki/concepts/blind-tailor-consultation.md` for the full
   rationale (data checked first — zero per-item gender data exists, so
   category is the only honest signal; 'for him' hard-excludes
   dress/skirt/heels with a requested-garment override; build tokens ride
   the existing preference rails and are silhouette-backed, never
   category-hallucinated).
6. **Wise listing** (committed, not deployed) — the shortlist is the
   answer, not a shelf: accessories never pad a clothes-brief grid (they
   surface via the outfit-completion rail instead), a relevance cutoff
   drops the baseline-scored tail instead of padding to a fixed count,
   and a consulted brief (≥2 signals) gets a tighter 8-piece shelf instead
   of 12. Same wiki page, "Wise listing" section.

## Before deploying wise listing

Run the local dev server (`NEXT_PUBLIC_CATALOG=vision npm run dev`, or via
`.claude/launch.json`'s `intently-dev` config on :3100) and walk a few
briefs. The tunable constants are in `src/lib/discovery/engine.ts`:
`REL_FLOOR` (0.5× best score), `MIN_SHOW` (3), `LIMIT_COLD` (12),
`LIMIT_CONSULTED` (8), and the `signalCount(ctx) >= 2` threshold that picks
between them. These are calibrated against the eval fleet, not against
Ilmari's taste — that's the explicit thing to check before shipping.
Once approved: `cd intently && vercel deploy --prod` (no CI/CD auto-deploy
yet — see Phase 7 below).

## Operational facts a new session needs

- **Vercel:** project `intently` (`<vercel-project-id>`), team
  `<vercel-team>`. Deploy is manual: `vercel deploy --prod` from
  `intently/`. An old `mise`-named project exists in the same team,
  unrelated and untouched.
- **Supabase:** the live vector store is Ilmari's own **`intently`**
  project (`<supabase-project-ref>`, eu-central-1) — not `intently-demo`
  (`<supabase-demo-project-ref>`), which was provisioned earlier in the session
  before real keys were available and is now redundant ($0/mo; ask before
  deleting).
- **Keys:** DeepSeek, OpenAI, and Supabase are live in Vercel. Anthropic is
  wired but dormant (the live conversational path is DeepSeek-only for
  cost — `DISCOVERY_PARSER=haiku` is a one-env-var fallback if DeepSeek
  ever misbehaves). OpenAI has a $5 prepaid balance which is itself the
  hard spend cap (the embedder is OpenAI's only consumer, ~$0.0004/sync).
- **`/admin` password:** generated once, given directly to Ilmari, not
  stored anywhere in the repo, memory, or this doc. If a new session needs
  it, ask him.
- **Local dev:** `NEXT_PUBLIC_CATALOG=vision npm run dev` (the vision
  catalogue — 292 real, image-backed products — not the Kaggle demo set).

## Open items, roughly in priority order

1. **Wise-listing calibration** (above) — the immediate next step.
2. **Cart continuation / upsell design** — Ilmari's stated next topic.
   Foundation: `companions.ts` (outfit completion, rail slots),
   `engine.ts`'s cart-anchored pivot logic (`ANCHOR_GARMENT_WORD`,
   `completionSlotFor`). No design work started yet.
3. **Phase 7 — continuous deployment** — blocked on the GitHub-mirror/
   `.gitlab-ci.yml` question above.
4. **prodprep.md residuals** (not urgent, all documented with fix paths):
   category-granularity in audience filtering (a camisole can still rank
   under "top" for a men's brief — needs a vision-enrichment
   `presentation` field, ~$0.50 for the full catalogue), admin curation
   writes have no durable store on Vercel, the AI budget file has a
   concurrency race. Read `prodprep.md` (repo root) top to bottom before
   any real production push.

## Where to read more

- `prodprep.md` (repo root) — dev-acceptable-but-prod-risky ledger.
- `wiki/concepts/blind-tailor-consultation.md` — the consultation + wise
  listing rationale, in full.
- `wiki/concepts/landing-living-preview.md` — the landing redesign.
- `docs/demo-script.md` — the customer-facing walkthrough, kept in sync
  with what's actually deployed.
- `CLAUDE.md` (repo root) — standing project conventions; note it has a
  few stale sections (documents an older river architecture that no
  longer exists) flagged in earlier session memory, not yet cleaned up.
