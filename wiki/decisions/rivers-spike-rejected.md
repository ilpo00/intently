---
type: decision
status: stable
updated: 2026-05-16
sources: []
tags: [adr, ux, navigation, shelved, spike]
---

# rivers-spike-rejected

**Decision (2026-05-16):** Multi-river / branches navigation is **shelved**. The "drift" problem in the [[river-architecture]] is solved with a smaller mechanism — the [[waypoints-slice]] breadcrumb strip — plus a `lock-at-3-loves` commitment gate in the taste grid. The N=2 branches spike was built behind a flag (`NEXT_PUBLIC_RIVERS=on`) and rolled back without merging the flagged path into the default experience.

## Context

User feedback in 2026-05 surfaced two distinct UX bugs both initially framed as "the river is broken":

1. **Drift.** User clicks "inspire me" → picks 2 styles → types "I want ramen" in the sticky bar. The destructive `resetCurrentRiver` (then `resetConversation` + `resetTaste`) wiped the prior taste signals and message context. No back button. The user couldn't return.
2. **Parallel exploration desire.** Could a user shop *Italian for Tuesday* and *Japanese for Saturday* in the same session, with shared checkout? Speculative but strategically interesting (multi-context shopping is a defensible differentiator).

The proposal was a Git-like branches model: a `+` to fork the current state into a new river, a top-right "branches" overlay showing every river as a card, a shared cart across rivers, eventual session-save for logged-in users.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **A. History strip (waypoints)** | Small surface area. Solves drift. No new mental model. Ships in days. | Doesn't answer the parallel-shopping question. |
| **B. Two-river spike (N=2)** | Validates the strategic bet at minimum scope. | New UI metaphor. Replaces StickyPrompt with RiverBar. Cap of 2 still feels like a tab manager. |
| **C. Full branches (N=∞ + zoom-out canvas)** | The vision. | Too much scope before validation. Too Git-like for non-developer users. |

## Why A was chosen, why B was rolled back

The original push-back at planning time: **branches solve parallel exploration, but the user's example was drift.** Shipping branches to solve drift means building a tab manager for a problem that wanted a back button.

We shipped A (waypoint strip) AND built B (the spike) behind a feature flag, then evaluated. B was rolled back because:

- **Cognitive load.** Managing branches IS work — naming, switching, closing. The user has to think about which river they're in even when they only want one.
- **The drift problem went away once A shipped.** With waypoints in place, the failure mode the user originally described stopped occurring. Branches solved a need that no longer existed.
- **The mental model was developer-coded.** "Branches" → Git. The `+` button + `▾` chevron + zoom-out card view felt like power-user tooling, not a guided commerce flow.
- **The single-river constraint is doing work.** Forcing one active context per session keeps the UX focused — the recipes/tools relationship the [[claude-md]] vision is built on (one editorial surface, not three disconnected experiences) is strongest when the user is committed to one path at a time.

## What B taught us (kept even after rollback)

The spike wasn't waste — three pieces of code shipped to main as part of A's rollout:

- **`hasInteractedWithTaste` flag** (see [[persistence-restores-data]]) was discovered while building the spike. The auto-advance-on-hydration trap would have affected branches too, so we encoded the rule. Now codebase-wide.
- **`clearAll` + `clearTasteSignals` on the AccountStore** were built so the spike could "fork a fresh river" cleanly. Repurposed for the [[session-reset]] testing affordance.
- **`scripted-ai` lift of "inspire me" above the conversationLength gate** was discovered when the spike's RiverBar repeated the same chip handler — the bug was already present in StickyPrompt but invisible because the entry hero submission always had `conversationLength === 0`.

## Trigger conditions for revisit

Re-open this decision if:

- Real users (not me, not the bench) explicitly ask for "save this session and look at a different cuisine without losing it." Two anecdotes is not signal; a pattern in support / feedback is.
- Account auth lands (v0.2) and the use case becomes "saved meal plans across sessions" rather than "parallel shopping in one session." That's a different feature with different UX.
- The waypoint strip starts feeling cramped because users want to fork-and-return more than back-and-restore. (Likely a sign that drift solved → fork need emerging.)

## Implementation receipt (for forensics)

The rolled-back code lived in commit `7acbc6c` of branch `claude/pedantic-pasteur-d3a500`. It was reverted in the same branch before merging to main (commit `9278bde`). Files that existed and were removed: `rivers-slice.ts`, `RiverBar.tsx`, `BranchesButton.tsx`, `BranchesView.tsx`, `rivers-slice.test.ts`. The flag `NEXT_PUBLIC_RIVERS` is no longer documented in `.env.example`.

If revisiting, the snapshot/restore design (live state IS the active river, inactive rivers live in `rivers[]`) is a sound starting point. The hard problem isn't the state shape — it's the metaphor surface.

## Related

- [[waypoints-slice]] — the solution that shipped
- [[river-architecture]] — the design this decision protects
- [[persistence-restores-data]] — a rule discovered during the spike
