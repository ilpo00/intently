# Roadmap

Where Intently is going, what is deliberately paused, and why. Rationale for
individual decisions lives in the [wiki](../../wiki/index.md); prod-readiness
residue lives in [`prodprep.md`](../../prodprep.md).

## Thesis

A shopper should be able to describe their **situation** — *"a garden party,
might get cold later, nothing floral"* — and get a small, **explained**
shortlist, the way a good salesperson would answer. Two audiences, one loop:
the shopper gets advice instead of filters; the product/catalogue manager gets
a Studio where improving the catalogue's *understanding* visibly improves the
shopper's results. The architectural rule underneath: **the engine decides,
the LLM phrases.**

## Where it stands (2026-09)

Shipped and live on the cloud demo:

- Situation → explained shortlist, with ask-before-offer consultation, the
  blind-tailor audience/build questions, "wise listing" (the shortlist is the
  answer, never padded) and restrained outfit completion.
- Tiered LLM conversation (comprehension + re-voicing) behind a complexity
  gate, a grounding verifier and replica-safe budget/rate guardrails.
- Vision enrichment (Claude Haiku reads each product photo) → embeddings →
  pgvector; resumable on serverless.
- The Studio: catalogue health, per-product provenance, attribute curation →
  re-embed → see discovery change, situation tuner, needs-attention queue,
  model bench, runtime config, analytics.
- From the 2026-07 brainstorm ([feature-brainstorm-2026-07.md](feature-brainstorm-2026-07.md)),
  all three converged ideas shipped: query→situation mining, the closed
  commerce loop (order webhook → attributed revenue), and online A/B of model
  configurations.

## Next, in priority order

1. **Post-cart continuation.** What happens after the first item lands in the
   cart. The foundation exists (cart-aware turns, never re-offering,
   cart-anchored pivots in `companions.ts` / `engine.ts`); the *experience*
   is undesigned. Constraint: restraint beats basket-size — a pushy add-on
   costs more trust than it earns.
2. **Item-level presentation attribute.** Audience filtering is
   category-granular today (see `prodprep.md`); one more vision-enrichment
   field (~$0.50 for the catalogue) makes it item-granular.
3. **Pilot-grade measurement.** The ROI model in
   [value-proposition](../../wiki/concepts/value-proposition.md) is
   illustrative; the A/B + order-webhook plumbing exists to replace its
   coefficients with measured ones on real traffic.
4. **Embeddable storefront plugin** — packaging discovery for a host store
   ([storefront-plugin.md](storefront-plugin.md)); proven locally against Medusa
   via Multi-Zones.

## Paused — and what would resume it

| Area | State | Resume when |
|---|---|---|
| Shopper accounts / auth | Supabase schema + RLS applied; app layer removed in the pivot, recoverable from git history ([account-backbone.md](account-backbone.md)) | Personalisation or saved sessions become the next bottleneck (currently low priority) |
| Medusa PIM + storefront in the cloud | Works locally ([medusa-cloud-plan.md](medusa-cloud-plan.md)) | A pilot needs a hosted commerce backend (cost is the only blocker) |
| Per-user Studio access | Shared-password edge gate (`proxy.ts`) | More than one operator needs audit trails |
| Outdoor catalogue | Kaggle-derived demo set only; the vision catalogue is fashion-only | A real outdoor PIM source exists |

## Analytics

A gathering place for analytics topics across Intently. The goal is to think
product analytics through deliberately — what we measure, why, how it informs
the next change — rather than instrument reactively.

The principle: collect data we'll actually act on. A metric we look at but never
change anything based on is dashboard pollution. If we can't say "if X drops,
we'll do Y" before instrumenting, don't instrument yet.

> The specific metric set is being re-derived for the discovery product
> (situation → shortlist funnel, explanation quality, catalogue-routing
> accuracy). The pre-pivot dashboards — tied to the old food product — were
> removed with the rest of that roadmap.

### Things we don't measure yet, deliberately

- **Scroll depth on the discovery surface.** Not useful while the surface is a single page
  with conditional sections — scroll position doesn't map to a meaningful
  funnel state.
- **Time on page.** Same reason; a single-surface page makes time-on-page meaningless
  without per-section context.
- **Heatmaps.** Premature. The interactions that matter are tracked as discrete
  events (input submissions, product detail opens, cart adds); a heatmap would
  mostly tell us "people moved their mouse near the input," which we already
  know.

## Phase-2 polish queue — deferred but tracked

Items left intentionally rough for a future auth + account-surface land (the
account layer is parked in Phase-1 — see `CLAUDE.md` and
[account-backbone.md](account-backbone.md)). Not blockers; pick up when polish
matters more than scope.

- **Magic-link email template** — the Supabase default is functional but reads
  like a transactional service, not Intently. Customize at Supabase dashboard →
  Authentication → Email Templates → "Magic Link". Wants: editorial typography
  (match the Cormorant / DM Sans pair) and the Intently wordmark. Pair with a
  custom sender domain (Resend / Postmark / SES) before any real launch —
  `noreply@supabase.co` reads as spam to many MUAs.
- **Custom sender domain** — depends on above; needs DNS records for the chosen
  transactional provider. Out of scope until Intently has a domain it lives on.
- **Display-name editing on /account** — the shipped surface is read-only (set
  on first signin; no edit path after). Add an inline-edit affordance on the
  /account profile row.
- **Sign-out access from inside the discovery surface** — today the only sign-out is on
  /account. A signed-in user mid-session has no quick way to switch users.
  Likely a persistent header element (mounted in `ClientShell`), not a noisy
  entry-hero corner button.
- **Returning-user welcome message** — when a returning user signs in, the
  first reply can use the prior-context injection mechanism. The hero greeting
  itself stays static ("Welcome back, $name."). A subtitle that references the
  last session would be lovely but risks feeling stalker-y if mis-tuned — defer
  until we see real usage.
