# Intently Design Principles

This document holds the design and interaction decisions that should be
respected across the app. It exists so contributors don't have to
reverse-engineer the "feel" of Intently from the code — the rules below are the
shared vocabulary every section should speak.

- **Architecture and environment** live in `CLAUDE.md`.
- **Product direction** lives in `docs/roadmap.md`.
- **Design + interaction conventions** (this file) sit between those two:
  the *how it should feel* layer.

When a new pattern is invented, write it down here. When a rule is broken
in service of a better outcome, update this file with the reasoning — the
goal isn't dogma, it's a shared mental model.

---

## Motion & scroll

### Click-to-follow: the viewport respects the click

When a user clicks an element whose size changes as a result — expands,
reveals more content, toggles open — the element they clicked on must
remain visible after the change. The principle: *don't move the button
out from under the cursor.*

Concretely:

- If the clicked element's bounding box falls outside the viewport after
  expansion (top clipped above 0 OR bottom below the fold), smooth-scroll
  so its top sits ~80 px below the viewport top — enough breathing room
  that it reads as "near the top" rather than "pressed against the edge".
- Defer the scroll by one `requestAnimationFrame` so the CSS transition
  and React commit share frame 1 cleanly. Scrolling on the click handler
  competes with the transition and visibly stutters on Safari.
- Respect `prefers-reduced-motion`: use instant scroll
  (`behavior: 'auto'`) when the user has requested reduced motion. Same
  end state, no animation.
- Anchor on the element the user clicked (or its header), **not** the
  newly-revealed content. Anchoring on the new content can scroll the
  click target out of view entirely.

**Implementation:** use `useFollowOnExpand` from
`src/hooks/useFollowOnExpand.ts`. Reference call sites: any in-flow card
that grows on click (e.g. a product card) and the continue-shopping
affordance.

For UI that is *not* in-flow — overlays (`ProductDetail`, `CartDrawer`),
fixed-position bars (`StickyPrompt`, `DemoHint`) — the hook is not
needed, because those don't change in-flow layout when they appear.

### Reduced-motion is a site-wide contract

Every smooth-scroll, fade, or animated transition must check
`prefers-reduced-motion` before playing. The site should be fully usable
with motion off — every state transition still happens, the animation
just doesn't.

Patterns currently in use:

- `useFollowOnExpand` — scrolls instantly under reduced motion.
- `DualStreamSection`'s 180 ms right-stream lag — bypassed entirely
  under reduced motion (the lag exists to smooth an animation the user
  has asked us not to play).
- `ConversationSection` bottom-anchor scroll — instant under reduced
  motion.

When adding new motion, follow the same shape: detect at call time
(`window.matchMedia('(prefers-reduced-motion: reduce)').matches`), not
at module load — the system setting can flip while the page is open.

### Frame-aligned deferrals

When you need to defer work past the current commit, prefer the chain
`setTimeout(fn, N) → requestAnimationFrame(fn)` over a plain
`setTimeout`. Plain timers on Safari are coarse and unaligned to frame
boundaries; landing a state write mid-frame causes visible stutter. The
rAF wrapper snaps the write to the next real frame.

Reference: the right-stream swap deferral in
`src/components/sections/DualStreamSection.tsx`.

### Two-phase moments

When a transition deserves a held beat — order confirmation, milestone
reveal, anything where the destination content shouldn't appear in the
same instant the action completes — use a fixed-position overlay above
the destination rather than animating the destination in.

Shape:

- The destination renders behind the overlay from t=0 — there is no
  conditional mount tied to the celebration phase. Cheaper, and the
  destination's own approach animation can be coordinated with the
  overlay's fade.
- The overlay owns its own lifecycle: mount → animate (particles, copy,
  whatever) → hold → fade → call `onComplete`. The parent flips the
  visibility flag to `false` in `onComplete`, and the overlay unmounts.
- Overlay is `fixed inset-0 z-[60] pointer-events-none` and sits at a
  z-index above the destination's stacking context so it covers the
  full viewport irrespective of scroll position. No `window.scrollTo`
  juggling needed.
- Hold duration around 2.5–3s; fade-out around 600ms. Long enough for
  the moment to land, short enough that the user doesn't think the
  app froze.
- **Layered approach on exit.** The fade is not a flat opacity dip:
  the overlay's UI elements scale *outward* (label `scale(1) →
  scale(1.25)` while fading) — passing through the viewer — while the
  destination scales *inward toward 1* from a slightly smaller start
  (`scale(0.94) → scale(1)`) — approaching from behind. The relative
  scales are what create the dimensional layering; absolute values
  matter less than the differential. Apply the destination's approach
  via a class with `animation-delay` matching the overlay's hold
  duration so they crossfade in lockstep.
- `prefers-reduced-motion` skips the overlay entirely — the destination
  renders immediately. Detect at call time, both at the parent (so the
  overlay is never mounted) and again inside the overlay's mount
  effect (defence-in-depth, in case it gets mounted by mistake).

Reference: `src/components/ui/CelebrationOverlay.tsx`, mounted by
`src/components/sections/CheckoutSection.tsx` for the post-purchase
celebration.

### Animation properties: cheap things only

Transitions on width, height, top/left, font-size, padding, or
border-color all trigger Safari's layout/paint engine on every frame.
On a flex column that's already animating its `flex` ratio, layering
those costs causes dropped frames.

Rules:

- Animate `transform` and `opacity` whenever possible — both are
  compositor-only.
- For flex-ratio transitions, scope the property to `transition-[flex]`,
  not `transition-all`. `transition-all` is almost always a regression
  trap.
- If you must animate width or font-size (e.g. a product card's hero image
  growth), promote to a compositor layer with `transform: translateZ(0)`
  on the same element, and avoid stacking other animated properties on
  the same element in the same frame.

---

## UI conventions

### Flow-control buttons (expand / collapse / move / reveal)

Buttons that change the river's layout or reveal more content —
`adjust style`, `browse more results`, and any future peer affordance —
must use the same pill style so the river's interaction vocabulary stays
consistent:

```
px-3.5 py-1.5 rounded-full bg-white border border-intently-cloud
text-sm font-sans text-intently-slate
hover:border-intently-pebble hover:text-intently-ink transition-colors duration-300
```

Rules:

- Lowercase copy ("browse more results", "adjust style" — not "Browse
  More Results").
- Directional glyph optional but consistent: `↑` = go back, `→` = move
  forward, `↓` = reveal below.
- Center-aligned in their container, unless they are a return affordance
  bound to a specific section (`↑ adjust style` is right-aligned to its
  header because it's a back-up gesture on that header specifically).
- Reference implementations: `adjust style` and `browse more results` live
  on the discovery surfaces (`DiscoverySection.tsx` /
  `ConversationSection.tsx`).

### Consultation options (the tailor's A/B pills)

When the discovery layer asks a clarifying question (ask-before-offer, or the
non-blocking "sharpen it" beat alongside results), its options render as
tappable pills using the flow-control pill style above — lowercase labels,
2–4 options, always ending with a graceful escape ("surprise me — show your
picks", "you choose", "either, really").

Rules:

- **Typing always stays open.** Pills are an accelerator, never a gate; the
  reply input remains active while a question is pending. Every pill label is
  also written to parse if typed instead (the two input paths converge on the
  same canonical preference tokens — see `src/lib/discovery/attributes.ts`).
- **A blocking ask never navigates.** Question-without-results keeps the
  shopper in the conversation; only a reveal advances the river to discovery.
  No auto-scroll past the assistant's question.
- **Strictly forward-moving.** A question once shown — answered, escaped, or
  typed past — never reappears (judged A/B: a repeated options row reads as
  "it didn't listen"). Each turn brings a fresh question or none.
- **Only the latest assistant turn keeps live options** (plugin overlay):
  stale questions in the scrollback must not invite taps against a moved-on
  session.
- Copy voice rules (acknowledgment beat, never-feel-lacking framing, the
  honesty beat for absent garments) live in `src/lib/discovery/voice.ts` and
  the `intently-tailor-voice` skill.

Reference implementations: `ConversationSection.tsx` (river),
`NextExperience.tsx` `AiTurn` (plugin overlay).

### Complete-the-look rail (outfit completion)

When the situation justifies it, the shortlist carries up to two quiet
companion groups below the primary grid — a light layer for a cool evening,
the other half of an outfit, something to carry the kit. Rules:

- **The lead line carries the reason.** One italic sentence rooted in the
  shopper's situation ("Summer days run warm and the evenings won't — a
  light layer over it settles both."). If the line can't name why, the rail
  must not render.
- **Quieter than the main grid**: smaller cards, a hairline separator, muted
  per-piece whys. The rail is an offer, never a second pitch.
- **Never pushy:** max 2 groups, 2–3 pieces each; groups only render when the
  context calls for them, the catalogue genuinely fills them, and their
  categories aren't already in the primary grid. Restraint logic lives in
  `src/lib/discovery/companions.ts` — do not loosen it from the UI side.
- Add-to-cart on rail cards behaves identically to primary cards (plugin:
  same shared Medusa cart).

Reference implementations: `DiscoverySection.tsx` (river rail),
`NextExperience.tsx` canvas + `AiTurn` inline (plugin, `nx-addons`).

---

## Change log

- **2026-04-25** — Initial extraction from `CLAUDE.md`. Added the
  click-to-follow / reduced-motion / frame-aligned-deferral / animation-
  properties principles under § Motion & scroll. The flow-control button
  convention moved verbatim from `CLAUDE.md`.
- **2026-05-06** — Added the **two-phase moments** pattern under § Motion
  & scroll. Established by `CelebrationOverlay` for the post-purchase
  confirmation; documents the fixed-overlay-above-destination shape so
  future "moment" surfaces can reuse it without redesigning the
  lifecycle.
- **2026-06-10** — Added the **consultation options** pattern under § UI
  conventions. Established by the personal-tailor consultation layer
  (ask-before-offer + sharpen-it pills on both the river and the plugin
  overlay); documents the typing-stays-open, never-navigate-on-ask, and
  strictly-forward-moving rules.
- **2026-06-10** — Added the **complete-the-look rail** pattern (outfit
  completion): context-justified companion groups under the shortlist, lead
  line carries the reason, max 2 groups × 3 pieces, quieter than the main
  grid. Motivated by the rachel case — "evenings get cold" must offer a
  layer over the dress, not pretend dresses got warmer.
