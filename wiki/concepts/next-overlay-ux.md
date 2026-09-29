---
type: concept
status: draft
updated: 2026-06-16
sources: [snoopy-sonnet-plan]
tags: [ux-flow, overlay, embeddable, discovery, motion, preview]
---

# next-overlay-ux

The proposed successor to the [[river-architecture]]: an **embeddable, adaptive contextual-discovery overlay** that launches over a host store, understands a one-sentence situation, and returns a small *explained* shortlist the shopper refines in place. A scripted, no-AI preview lives at the route `/next` (`intently/src/app/next/`), built to be clicked through and themed — not yet wired to the [[intently-store]] or live AI.

Built from the plan `~/.claude/plans/this-is-the-next-snoopy-sonnet.md`. It exists because the river has three gaps the product needs closed: results and the refine input aren't co-visible; the river is a standalone full-page app, not an in-store overlay; and the upfront taste grid contradicts "context invited, never demanded."

## The five moments

`intent → conversation → explained products → refine → cart`, re-framed for an overlay:

1. **Invitation** — re-imagined 2026-06-16 as the [[landing-living-preview]]: a two-pane landing whose right side shows a calm, dimmed, cross-fading *example of the payoff* (best-match card + why-line + understood chips) so the explained-shortlist reward is visible before a word is typed; the left carries the hero input (present at t=0) + situation seeds. Replaces the old empty-canvas first impression ("pops up too empty"). Reads as discovery, not search.
2. **Understanding** — the parsed situation surfaces as quiet, removable **context chips** (`day hiking · active · layerable`) *before* products, so the shopper sees they were understood. Removing a chip = an exclusion.
3. **Explained shortlist** — 5 cards; the **why-this line is the hero of the card**, not a footnote. One `Best match` ring. Why-lines fade in a beat after the cards (perceived-latency trick).
4. **Refine (the re-rank diff)** — a chip or free text updates context and the results **re-rank in place**. This is the product's hero motion.
5. **Decision & handoff** — fly-to-cart + a two-phase "Handed to the store" celebration.

Cross-cutting states are first-class: a persistent refine input + start-over, a **no-match** state ("this range leans casual/outdoor — adjust, or browse?") that always offers a way back, and a complete reduced-motion path.

## Information architecture — one tree, two layouts

The whole overlay is one component (`NextExperience.tsx`); layout is CSS-driven, not a second codebase:

- **Desktop (≥860px):** conversation rail (left) + **pinned results canvas** (right). The canvas re-ranks in place; the rail does not scroll past the answer.
- **Mobile (<860px):** single-column canvas; each assistant turn carries its own grid inline (`.nx-inlinegrid`); the right canvas is hidden.

The five [[design-md]] motion rules are re-scoped from "no element exceeds the **viewport**" to "no element exceeds the **overlay bounds**"; click-to-follow operates inside the overlay's scroll container.

## The re-rank diff choreography

On a refinement the engine returns a `diff` (`added` / `removed` / `kept` ids). Desktop plays it in two phases (compositor-only `transform`/`opacity`): **leaving** cards fade + contract, then the set swaps — **entering** cards rise, **kept** cards settle — keyed by product id so React reuses the kept DOM. A `Swapped N · kept M` banner explains it. Mobile gets a fresh grid + the summary line instead of the in-place diff (the plan's split). Reduced-motion swaps instantly.

## The single response contract (scripted ↔ live parity)

`scripted.ts` returns the shape the plan defines so a future live path stays in lockstep (see [[ai-mode-toggle]], [[tiered-ai-architecture]]):

```
{ message, chips, results[], followUp, refineChips, diff, summary, noMatch }
```

`chips` = parsed context, `diff` powers the choreography, `followUp` powers the one smart question. The deterministic engine ([[deterministic-ranker]]) and [[enrichment-layer]] would feed this on the live path; the scripted route hand-authors two journeys.

## Scripted scenarios are dataset-honest

The picture bank (`intently/public/catalog/*.webp`, 292 images) is **casual basics + outerwear** — almost no formal dresses. So the hero journey is **"a weekend hike → it'll be cold in the evenings"** (the plan's marquee refinement, and the `useDiscover` outdoor chip), *not* the plan's wedding-dress example, which would look wrong with these images. A second "summer city weekend" journey and a `nomatch` path (tuxedo/gala) round it out. This is a deliberate candor trade: match the assets you have.

## Performance decisions

- The refine input lives **inside `RefineBar`**, so typing never re-renders the overlay or the image grid.
- `ExplainedCard` is `memo`'d and `addToCart` is a stable `useCallback`, so unrelated state (e.g. the thinking toggle) doesn't re-render cards.
- The host backdrop renders once (single tree, no remount on launch).
- All motion is `transform`/`opacity`; a local `flyTo` clone avoids coupling to the store-bound `useFlyToCart`.

## Cart handoff — mock here, shared cart in the real embed

`/next` mocks the handoff (a local `useState` bag → celebration). The **real** mechanism is the river's embedded mode and needs no data sync: `AddToCartButton` POSTs a `variantId` to `intently/src/app/api/cart/route.ts`, which reads/writes the **same `_medusa_cart_id` httpOnly cookie** and the same Medusa cart API the storefront uses, then fires `intently-cart-updated` for `EmbeddedNav` to update the count. The return trip is a cross-zone `<a href="/">` — the cart is already shared. The plan flags the embeddable **cart-adapter seam** as build-later.

## Files & deep-links

- `intently/src/app/next/NextExperience.tsx` — overlay shell + state machine + diff choreography.
- `intently/src/app/next/scripted.ts` — products, scenarios, the response contract, `diff` computation.
- `intently/src/app/next/theme.css` — design system + motion (see [[theming-tokens]]).
- Demo deep-links (dev only, gated): `?demo=invite|shortlist|refined|celebrate|nomatch` and `?theme=intently|og`.

## Related

- [[landing-living-preview]] — the redesigned pre-search landing (the Invitation moment, Concept B)
- [[river-architecture]] — the model this proposes to succeed
- [[theming-tokens]] — how the overlay is re-skinned per host
- [[ai-mode-toggle]] · [[tiered-ai-architecture]] · [[deterministic-ranker]] · [[enrichment-layer]] — the live path the scripted contract mirrors
- [[agent-skill-system]] — `mise-preview-plan` gates the browser verification of this surface
