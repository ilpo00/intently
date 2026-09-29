---
type: concept
status: draft
updated: 2026-06-16
sources: []
tags: [ux-flow, landing, discovery, overlay, motion, first-impression, mockups]
---

# landing-living-preview

The redesigned **pre-search landing** of the discovery overlay ([[next-overlay-ux]]): a two-pane first impression that replaces the empty results canvas with a calm, dimmed, cross-fading **example of the payoff**. Left = editorial invitation + the live input + situation seeds; right = a real catalogue card with its why-this line and "understood" chips, tagged *Example*. Built on branch `claude/fervent-hellman-e8fc4d` (2026-06-16): `intently/src/app/next/NextExperience.tsx` (`Landing` / `LandingInput` / `LivingPreview`) + `theme.css` (`.nx-landing`, `.nx-preview`).

## The problem it fixes

The pre-search state rendered the desktop two-pane split (`380px | 1fr`) with the right ~two-thirds as an empty `nx-canvas` (a faint compass + one line), and the only input pinned to the bottom of the left rail. The largest thing on screen was a void — it read as *not loaded* — the input hid, activation energy was high, and nothing showed why this beats the filters the shopper already abandoned. (Ilmari, 2026-06-16: "pops up too empty … not inviting.")

## The pattern

- **Don't render a void.** The empty canvas is not drawn pre-search; the two-pane *landing* takes its place. The post-search rail+canvas layout is untouched — the landing is gated on `started`, so submitting hands straight back to the existing conversation/results flow.
- **The input is the hero**, present and focused at t=0, ringed in the pine accent — never a footer bar.
- **Show the difference, don't claim it.** The right pane is a live, dimmed (`opacity .85`), `aria-hidden` preview that cross-fades (~4.2s) between two real journeys (hike / city) — each with the "best match" card, its **why-this line**, and the green **understood chips**. The explained-shortlist reward is visible before a word is typed, tagged *Example* so it never reads as the shopper's own results.
- **Keep the seeds.** The three situation seeds sit under the input as a row.

## Calm reveal — but CTA-first (the rule worth keeping)

Ilmari likes calmly-appearing suggestions; honoured here, with one edit made explicit: the **primary input and the promise are present at t=0**; only the *secondary* layer (seeds, the preview cross-fade) animates in. A filter-fatigued shopper is seconds from leaving — delaying the lifeline is the one place where "calm" and "broken" look identical. Reduced-motion: the cross-fade interval is guarded by `prefersReducedMotion()` *at call time*, and the global reduced-motion block in `theme.css` zeroes the rest → a single static example, no cycling (see [[theming-tokens]] and the [[design-md]] motion contract).

## Why B, of three directions explored

Three annotated mockups were built and reviewed, saved at `wiki/assets/landing-mockups/` (open `index.html` — it carries the research, the "before" diagnosis, and the side-by-side):

- **A · The Quiet Open** (centre, minimal) — no split, one centred input; safest, lowest "wow". **A's best parts were folded into B (2026-06-16):** the rotating situational placeholder + a quiet promise line (the mobile value anchor) + a slightly larger input — see `b-plus-a.html`. A's *centre layout* was deliberately **not** taken — it can't coexist with the side-by-side living preview.
- **B · The Living Preview** (left + breathing example) — **chosen and built.** The only direction that answers both failure modes Ilmari named: it isn't "a different way to the same results" (the explained shortlist is shown up front), and it isn't "a dead end people abandon for the PLP" (the pull runs toward typing).
- **C · The Tailor Opens** (right, guided) — greeting + concrete path-cards; reserved for *if* analytics show people landing and leaving **without typing** (it over-assists the decisive shopper).

Mapped to [[use-cases-personas]]: B serves the **filter refugee** and the **curious browser**; A the **constraint-stacker**; C the **blank-box freezer** / gift-giver.

## The dependency this rides on

The landing writes a cheque the **first message** must cash: "a curated few, each with a reason." If the first real shortlist looks like a 30-tile PLP, the preview makes the let-down *worse*. The first-message beat (the understood pause + first explained reveal, via [[tailor-consultation]]) is the next piece of work — and it's where this is actually won or lost.

## Verified (Preview, standalone dev :3100, 2026-06-16)

Landing renders faithfully; input present at t=0; living preview cross-fades real catalogue cards; submitting a seed transitions into the consultation and on to **12 explained results** with no dead-end; window does not scroll past the answer (rail keeps it in view); console clean; mobile (375px) collapses to the editorial column (preview hidden). `npm run typecheck` / `lint` / `test` all green.

## Known follow-ups (not regressions from this change)

- **Mobile** is functional but deferred to a focused pass (preview hidden < 860px).
- **Short-height desktop** clips the *decorative* preview pane (overflow hidden); the interactive left column scrolls and stays usable — no single element exceeds the viewport.
- **Live result images 404** in standalone dev (`/catalog/<id>.jpg` not in the curated `.webp` bank) — a pre-existing PIM→picture-bank gap ([[deployment-topology]], [[pim-strategy]]), unrelated to the landing.

## Related

- [[next-overlay-ux]] — the overlay this is the entry moment of (the "Invitation", re-imagined)
- [[theming-tokens]] — the tokens + motion the landing reuses
- [[use-cases-personas]] — the shopper situations the three directions map to
- [[customer-experience]] — where this sits in the order a person meets the product
- [[tailor-consultation]] — what happens after submit (the consultation the landing promises)
