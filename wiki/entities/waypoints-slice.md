---
type: entity
status: stable
updated: 2026-05-16
sources: []
tags: [state, zustand, navigation, ux]
---

# waypoints-slice

A breadcrumb history of contexts the user passed through, so destructive sticky-bar resets are recoverable. Lives at `intently/src/store/waypoints-slice.ts` (types) + inline impl in [[intently-store]] (`intently/src/store/intently-store.ts`). UI: `intently/src/components/ui/WaypointStrip.tsx` (renders inline beneath the sticky bar as a horizontal pill row).

## What problem it solves

The [[river-architecture]] is non-router. A new prompt in the sticky bar fires `resetCurrentRiver` and wipes everything (messages, taste profile, products) before the AI response routes the user somewhere new. Before this slice existed, that was destructive and unrecoverable — no browser back, no in-app back, no way to return to the prior context.

See [[rivers-spike-rejected]] for the alternative we tried (parallel branches) and why we landed here instead.

## Shape

```ts
type WaypointSnapshot = {
  messages, tasteProfile, intent, mentionedDish, activeSection,
  discoveredProducts, intentScore, expandedRecipeId
}
type Waypoint = { id, label, createdAt, snapshot }

WaypointsSlice = {
  waypoints: Waypoint[]                  // FIFO cap of 5
  pushWaypoint: () => void               // snapshot current; dedup'd
  restoreWaypoint: (id: string) => void  // hydrate live state from snapshot
  clearWaypoints: () => void             // called by resetSession only
}
```

`MAX_WAYPOINTS = 5` — strip shows the most recent 4 inline; the 5th is buffer in case a restore + new transition would otherwise drop the chip the user just left.

## Where pushWaypoint fires

Three sites — chosen so a snapshot lands BEFORE state mutates:

1. `setActiveSection(s)` auto-pushes when `s !== current` (most river transitions).
2. `setDiscoveredProducts(p)` auto-pushes when transitioning into or refreshing discovery.
3. `StickyPrompt.handleSubmit` explicitly pushes BEFORE `resetCurrentRiver` so the prior context is preserved across the destructive reset.

Two suppressions inside `pushWaypoint`:

- **Empty initial state** — `activeSection==='entry'` AND messages/products/signals all empty → skip. Nothing worth navigating back to.
- **Duplicate of last** — same `activeSection` + same lengths for messages/products/signals + same `mentionedDish` → skip. Prevents pile-ups when `setActiveSection` and `setDiscoveredProducts` fire in the same tick.

## Label derivation

`intently/src/lib/waypoint-label.ts` derives a short label from the snapshot:

- `checkout` → "Checkout"
- `discovery` → `mentionedDish` (capitalised) > "Discovery · N items" > "Discovery"
- `taste-grid` → "Inspire me · N styles" or "Inspire me"
- otherwise → last user message, truncated to 40 chars, or "Start"

`restoreWaypoint` does NOT remove the target from the list — clicking back twice returns to the previous prior, not a black hole.

## Tests

`intently/src/tests/waypoints-slice.test.ts` locks: empty-state suppression, dedup, FIFO cap, restore hydrates correctly, restore does NOT push the leaving state (prevents a loop), auto-push on `setActiveSection` / `setDiscoveredProducts`, `clearWaypoints` + `resetSession` both wipe history.

## Don't delegate

Same rule as [[intently-store]] — this slice is part of the river-state contract. DeepSeek can't touch it (per [[claude-md]]).

## Related

- [[intently-store]] — composes this slice
- [[river-architecture]] — explains why the non-router design needed an in-app history mechanism
- [[rivers-spike-rejected]] — the alternative that was tried and rolled back
- [[persistence-restores-data]] — separate but adjacent rule for the same UX concern
