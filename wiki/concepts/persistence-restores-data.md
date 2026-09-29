---
type: concept
status: stable
updated: 2026-05-16
sources: []
tags: [persistence, hydration, gotcha, account-store, taste]
---

# persistence-restores-data

**Rule: hydration restores DATA, never navigates.** Any code path that would change `activeSection`, `discoveredProducts`, or any other "where am I" state as a side effect of restored data must gate on a session-scoped flag that hydration does NOT touch.

## The trap (and why this rule exists)

The [[intently-store]] persists taste signals to `intently.taste.v1` (via the [[account-store-local]] localStorage backend; see [[supabase-over-medusa]] for the account layer). On mount, `AccountHydrator` calls `hydrateTaste`, which loads the persisted signals back into `tasteProfile.signals`.

Before this rule was codified, the [[taste-grid-section]] auto-advance effect did this:

```
dominantStyle ← derive(signals)
if dominantStyle: setDiscoveredProducts(products)  // flips activeSection = 'discovery'
```

For a returning user with ≥3 love signals in localStorage, `dominantStyle` was truthy on the very first render. Side effect fired. `activeSection` became `'discovery'`. The assistant announce message collapsed the entry hero (`messages.length > 0`). `stickyActive` stayed `false` (only flipped after a user submission), so the sticky bar with the "start over" chip never mounted. **The user was trapped in a discovery view they could not escape.** Refresh re-hydrated the same state. Reboot didn't help.

## How the rule is enforced

A session-scoped flag `hasInteractedWithTaste: boolean` lives on the taste slice. Default `false`. Flipped `true` ONLY by `addTasteSignal` / `removeTasteSignal` — i.e. by genuine user interaction in this session. Explicitly NOT touched by `hydrateTaste`. Reset to `false` by `resetTaste`, `resetCurrentRiver`, and `resetSession`.

Two consumers gate on this flag:

- [[taste-grid-section]] render guard: `if (activeSection !== 'taste-grid' && !hasInteractedWithTaste) return null` — the grid only mounts when the user is actively in this session's flow, never just because old signals were hydrated.
- [[taste-grid-section]] auto-advance `useEffect`: bails immediately when `!hasInteractedWithTaste`, even if `dominantStyle` is truthy.

The "↑ adjust style" affordance in the discovery dual-stream is on the same flag — without it, a ramen-via-conversation flow would surface the button just because hydrated signals exist, misleading the user.

## Locking the contract

`src/tests/store.test.ts` describe block `hasInteractedWithTaste — persistence-restores-data invariant` pre-seeds `localStorage`, calls `hydrateTaste`, and asserts the flag stays `false`. If a future change to hydrate flips the flag, that test fails loudly.

## Recovery surface

[[session-reset]] is the always-visible escape hatch (bottom-left). It calls `accountStore.clearAll(DEMO_USER_ID)` (drops the three localStorage keys) then `resetSession()` then hard-reloads. Mounted from [[client-shell]]. Without this, users with corrupted localStorage have no UI path out — they need devtools.

## Future hazards (apply the same gate)

When new slice fields get persisted (library is already, orders soon, paths v0.3+), the same rule applies. Any auto-advance or visibility logic that keys on those slices must gate on a session-scoped interaction flag, NOT on the data itself.

## Related

- [[intently-store]] — where the flag lives
- [[waypoints-slice]] — separate but complementary; gives users a back path when destructive resets fire
- [[session-reset]] — the recovery affordance
- [[supabase-over-medusa]] — the persistence layer that necessitated this rule
