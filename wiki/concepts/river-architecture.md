---
type: concept
status: stable
updated: 2026-05-16
sources: [claude-md]
tags: [architecture, ux-flow, no-router]
---

# river-architecture

Intently is a single scrolling page. One `page.tsx` composes every section in order; the user flows through them like a river. There is no router navigation between sections — state transitions in the [[intently-store]] decide what renders.

## Flow

```
entry → conversation → (optional taste grid) → discovery → checkout
```

Each step is a `src/components/sections/*` component. The river is assembled in `intently/src/app/page.tsx`. Continuation flow uses `ContinueShopping` to loop back to discovery.

## Why no router

- A router would create a "back button" UX that doesn't fit a guided commerce flow.
- Cross-section state (intent, conversation, cart) is far simpler with one continuous page over one [[intently-store]].
- SEO / deep-link concerns don't apply — this is a demo / experience prototype, not a product catalog.

## Back-navigation inside the river

"No router" does NOT mean "no back path." The river can still bend: a sticky-bar prompt mid-discovery destroys the prior context, and users genuinely needed a way to recover it. Two mechanisms now coexist:

- **[[waypoints-slice]]** — a breadcrumb strip rendered inline beneath the sticky bar shows the last 4 contexts (e.g. "Inspire me · 2 styles" → "Ramen"). Clicking restores the snapshot. Auto-pushes on `setActiveSection` / `setDiscoveredProducts`; explicitly pushes in `StickyPrompt.handleSubmit` before the destructive `resetCurrentRiver`.
- **Commitment lock at the taste grid** — once 3 styles are loved, the cards become non-operational and only the in-grid "reset selection" remains active. Reset clears both signals AND the downstream discovery, so the cause-and-effect (your picks drive what's below) is visible.

Parallel rivers (forking, branches, multi-context shopping) were explored in a flagged spike and rolled back — see [[rivers-spike-rejected]] for the analysis and the trigger conditions to revisit.

## A persistence rule the river depends on

Any auto-advance effect inside the river MUST NOT fire as a side effect of hydrated data. Returning users with persisted taste signals were being auto-advanced into discovery on every page load with no escape. The codified rule lives in [[persistence-restores-data]] — every new section that ships needs to apply it.

## Implications

- All section state lives in [[intently-store]]. No per-section local state for anything cross-cutting.
- Reveals are scroll-driven. See `src/hooks/useRiverReveal.ts`.
- The `[[client-shell]]` (`src/components/ui/ClientShell.tsx`) mounts overlays (CartDrawer, ProductDetail, etc.) outside the river so they can appear at any flow stage without breaking layout.

## Don't delegate

[[claude-md]] excludes river-state-machine work from DeepSeek delegation. Keep edits to flow logic on Claude.

## Related

- [[intently-store]] — the state that drives transitions
- [[ai-mode-toggle]] — drives the conversation section
- [[waypoints-slice]] — back path inside the river
- [[persistence-restores-data]] — invariant the river depends on
- [[rivers-spike-rejected]] — the parallel-rivers direction tried and shelved
- [[next-overlay-ux]] — the proposed successor model (embeddable adaptive overlay; preview at `/next`)
- `intently/docs/design.md` (not yet ingested) — design conventions for motion and scroll
