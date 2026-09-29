---
type: concept
status: stable
updated: 2026-05-21
sources: [you-are-a-lead-stateful-teapot, tiered-ai-architecture]
tags: [ai, ranking, personalisation, cache, signals]
---

# deterministic-ranker

Phase 2 of the tiered AI path. A pure scoring function that pre-ranks products and recipes against the user's signals BEFORE the conversation reaches the LLM. Lives at `intently/src/lib/recommend/ranker.ts`.

## Why a deterministic ranker (vs letting the model decide)

Three reasons:

1. **Cost** — the LLM doesn't have to read the entire catalog to find what's relevant. The ranker culls to a top-12 / top-8 shortlist; the model sees a quality-sorted list with breakdown scores rather than 30 unscored products.
2. **Auditability** — every score has a four-component breakdown (`tasteAlignment / dishMatch / libraryAdjacency / editorialWeight`). When a user asks "why did you pick X?", the answer is fully traceable. The model's reasoning is necessarily opaque; ours isn't.
3. **Determinism** — same inputs always produce the same ranking. Critical for the eval harness (Phase 1c) which would otherwise have to tolerate model noise in regression checks.

## The formula

```
score(asset) =
    40 × tasteAlignment(asset.categories, user.signals)
  + 30 × dishMatch(asset, conversation.mentionedDish)
  + 20 × libraryAdjacency(asset.pairsWith, user.library)
  + 10 × editorialWeight(asset) / 100
```

Each component is normalized to `[0, 1]`; the coefficients are the caps. Sum is 100 so the score has an interpretable scale. Pinned by `RANKER_CAPS` constant + a test that asserts the sum is 100, so silent coefficient drift is impossible.

### Component semantics

| Component | Range | Meaning |
|---|---|---|
| `tasteAlignment` | 0 / 0.5 / 1 (products); 0 / 0.5 / 1 (recipes) | Overlap with `love` / `nope` signals on the 9-grid. Skip is treated as neutral. Mixed (love AND nope touch the asset) is 0.5 — love is the stronger signal but we don't escalate. |
| `dishMatch` | 0 or 1 | Substring match against `mentionedDish`. For products checks `intent.enablesDishes`; for recipes checks `title + summary + description`. Bidirectional substring so `"ramen"` matches `"tonkotsu_ramen"` and vice versa. |
| `libraryAdjacency` | Fractional [0, 1] | What fraction of the asset's `pairsWith` is already in the user's library. `"you have this, here's what completes it"` is the most actionable kind of recommendation. |
| `editorialWeight` | 0 to 1 (=score/100) | Curated base weight. Recipes have it as a real field; products use a default of 50 (no field today). Adding the field on products is a low-effort improvement; the formula already handles it. |

## How it plugs into the tiered orchestrator

`runOrchestrator` accepts `userSignals` + `ownedAssetIds` as optional args. When present:

1. Compute `mentionedDish` from the last user message via the existing `dishGroupFromText` heuristic.
2. Rank all products + all recipes against the `RankContext`.
3. Take top-12 products + top-8 recipes.
4. Build a `contextPacket` string (in `src/lib/recommend/context-packet.ts`) with the user's signals + library + ranked shortlist.
5. **Prepend** the packet as a user-role message BEFORE the live conversation. The system prompt stays unchanged.

The cache discipline:

```
[stable, cached: system prompt + catalog summary + tool schemas]
[dynamic: context packet — signals, dish, ranked shortlist]
[dynamic: live conversation messages]
```

The largest stable component (the catalog summary) is the part that hits the providers' prefix cache. The packet costs ~200-400 tokens per request but doesn't invalidate the cache prefix.

## The advisory contract

The packet is **advisory**, not restrictive. The tool-call enum still includes ALL catalog IDs — the model can recommend something outside the ranked top-K if it has a good reason. Pre-ranking biases the model's attention, doesn't constrain its choices. This matters for follow-up turns where the FIRST turn's ranking would be wrong for the SECOND turn's intent.

## What about scripted-ai?

The original plan called for "reuse the same ranker from scripted-ai.ts so the demo path also improves." After the 2026-05-17 cutover, `scripted-ai.ts` is `@deprecated` and frozen — no extensions, no new behaviour. The ranker module is built and importable from anywhere; if scripted ever gets resurrected, the ranker is sitting there ready. Deliberate trade-off: scope-creep avoidance over redundancy.

## Files

- `intently/src/lib/recommend/ranker.ts` — pure scoring + ranking
- `intently/src/lib/recommend/context-packet.ts` — packet renderer
- `intently/src/lib/ai/orchestrator.ts` — wiring; injects the packet before the user's message
- `intently/src/app/api/chat/route.ts` — accepts `userSignals` + `ownedAssetIds` in the body
- `intently/src/hooks/useChat.ts` — reads from the store and forwards on every send

## Related

- [[tiered-ai-architecture]] — the orchestrator this plugs into
- [[use-chat]] — the hook that reads signals from the store
- [[intently-store]] — owns the `tasteProfile.signals` + `library.ownedAssetIds` state
- [[ai-mode-toggle]] — the env-var that gates whether the tiered path even runs
