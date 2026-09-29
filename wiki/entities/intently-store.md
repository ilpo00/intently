---
type: entity
status: stable
updated: 2026-05-16
sources: [claude-md]
tags: [state, zustand, central]
---

# intently-store

The single Zustand store for the entire app. File: `intently/src/store/intently-store.ts`. Hook: `useIntentlyStore`.

## Why it exists

Intently is a [[river-architecture]] — one scrolling page composes every section. Sections need to share state across the flow (conversation, taste preferences, cart, dual-stream layout) and there is no router to keep them isolated. The rule from `.cursorrules` is literal: **never prop-drill through more than 2 levels** — if state needs to cross 3+, it goes in this store.

## Shape

The store is split into slices but exposed as one hook. Slices (per [[claude-md]]):

- `conversation` — chat history and intent context
- `taste` — taste-grid preferences (the optional onboarding step). Includes the session-scoped `hasInteractedWithTaste` flag — see [[persistence-restores-data]] for why hydration must NEVER flip it.
- `cart` — items selected, checkout state
- `library` / `orders` — persistent user-scoped data routed through [[supabase-over-medusa]]'s AccountStore
- `flow` — `activeSection`, `discoveredProducts`, `selectedAsset`
- `dual-stream` — layout weights driven by [[ai-mode-toggle]]'s [[intent-scoring]]
- `waypoints` — see [[waypoints-slice]]; navigable history that makes destructive sticky-bar resets recoverable
- `session` — reset actions including `purgeLocalSession` for testing

Shapes themselves live in `intently/src/store/intently-store.ts` and shared types in `intently/src/types/index.ts`. Re-read the file when changing shapes — don't trust paraphrases.

## Conventions when editing

- Add new state to a slice, not a new store.
- Cross-slice reads are fine; circular writes are not — derive in selectors instead.
- Test changes via `npx jest src/tests/` — see [[claude-md]] for the test selectors.

## Don't delegate

The DeepSeek delegation rules in [[claude-md]] explicitly exclude this file. Edits here stay on Claude.

## Related

- [[use-chat]] — writes conversation slice
- [[river-architecture]] — explains why centralization
- [[ai-mode-toggle]] — the dual-stream slice consumes the AI-mode contract
- [[waypoints-slice]] — the in-river back path; uses the store's transition setters
- [[persistence-restores-data]] — the rule that gates auto-advance effects against hydrated state
