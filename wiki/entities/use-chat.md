---
type: entity
status: stable
updated: 2026-05-21
sources: [claude-md, tiered-ai-architecture]
tags: [hook, ai, branching, streaming]
---

# use-chat

The only place in the app that branches between AI engines. File: `intently/src/hooks/useChat.ts`.

## Contract

Both code paths return the same shape:

```ts
{
  text: string
  products?: Product[]
  recipeId?: string
  showTasteGrid?: boolean
  meta?: {
    resolvedByTier?: string
    sessionId?: string | null
    dishGroup?: string | null
    showTasteGrid?: boolean
    clarifying?: { question: string; options?: string[] }
    guardrailDisabled?: boolean
    rateLimited?: { kind: string; retryable: boolean; retryAfterSeconds?: number }
  }
}
```

This is a hard contract. Components calling `useChat` must not be aware of which path executed. See [[ai-mode-toggle]] for why.

## Branches

- **Tiered (default)** — when `NEXT_PUBLIC_AI_MODE` is unset OR set to anything other than `scripted`. Posts to `/api/chat` with `Accept: text/event-stream`. The route streams Tier-1 deltas via SSE; useChat appends them to the assistant message placeholder; the final SSE event carries the structured envelope (products, recipeId, meta) and useChat replaces the message content with the canonical text. Falls back to JSON if the server doesn't honor SSE (test mocks). Requires `DEEPSEEK_API_KEY`; `ANTHROPIC_API_KEY` enables Tiers 3+4. See [[tiered-ai-architecture]] for the full picture.
- **Scripted (emergency / CI)** — when `NEXT_PUBLIC_AI_MODE=scripted`. Calls `intently/src/lib/scripted-ai.ts` directly — regex intent detection + curated response. No API keys needed. `@deprecated`; don't extend.
- **Auto-fallback to scripted** — tiered failures (5xx, missing key, network error, SSE `error` event) silently route to scripted. The user always sees an answer, never an error.

## What useChat owns vs what call sites own

Phase 1b.2 moved the assistant-message lifecycle into useChat:

- **useChat pushes** an empty `{ role: 'assistant', content: '' }` placeholder before the fetch, appends SSE deltas as they arrive, and replaces with the canonical final text when the `final` event lands. Also calls `setMentionedDish` + `setCitedRecipe` after every successful response — this is the [[intently-store]] signal-wiring invariant.
- **Call sites add the user message** (`addMessage({ role: 'user', ... })`) and own `setLoading`. They **must not** call `addMessage({ role: 'assistant', ... })` after awaiting `sendMessage` — that would duplicate the assistant message. The response object is still returned for side-effect routing (showTasteGrid → setActiveSection, intent → setIntent, etc).

## Why it matters

- Centralising the branch means components stay pure and the contract is enforced at one point.
- The scripted engine remains a **complete demo** so anyone can clone the repo and run the flow without secrets. CI runs with `NEXT_PUBLIC_AI_MODE=scripted`.
- The assistant-message lifecycle inside useChat means new call sites get streaming + signal wiring for free — no risk of forgetting to push the bubble or sync mentionedDish.

## Removed

- `NEXT_PUBLIC_AI_MODE=live` (Claude-only direct path) was removed when tiered shipped. The string is treated as tiered (per the `mode !== 'scripted'` check) and emits no warning.

## Related

- [[ai-mode-toggle]] — the env-var pattern this hook implements
- [[tiered-ai-architecture]] — the production engine: orchestration, warmup, abuse mitigation, telemetry, streaming
- [[intently-store]] — receives the conversation outputs
- [[claude-md]] — full architectural context
