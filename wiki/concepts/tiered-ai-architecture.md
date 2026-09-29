---
type: concept
status: draft
updated: 2026-05-16
sources: [claude-md]
tags: [ai, chat, recommendations, deepseek, anthropic, grounding, cost]
---

# Tiered AI architecture

Intently's chat-driven recommendation engine uses a **tiered model architecture**: a cheap primary (DeepSeek-V4-Flash) does the bulk of generation, with Anthropic Claude reserved as a guardrail rather than the bulk worker. The goal is to keep per-conversation cost ~5× lower than all-Sonnet while preserving the strict-catalog promise — every product or recipe surfaced to the user is a real catalog item, never a hallucination.

This page documents how the architecture works **today (Phase 0.5 spike)** and what it will look like **at full scope**.

## Why tiered

The catalog is small (~30 products, 12 recipes) and editorial. The entire catalog fits in a single prompt, so no retrieval system is needed. The two real challenges:

1. **Hallucination risk** — the AI must never name a product or recipe outside the catalog. Without enforcement, even strong models will reach for plausible-sounding off-catalog items ("you might also like a Wüsthof santoku").
2. **Cost** — running every turn through Claude Sonnet is overkill when ~95% of turns are simple "pick from a list, write a sentence" generations that a cheaper model handles well.

The tiered split answers both: DeepSeek handles bulk generation cheaply; Claude is positioned where each provider is strongest — Claude as the truth-checker and last-resort regenerator, DeepSeek as the workhorse.

## How it works (Phase 0.5 spike — current state)

```
                       page mount
                            │
                            ▼
              POST /api/chat/session  ← fire-and-forget warmup
                            │
              ┌─────────────┴──────────────┐
              │ Builds catalog summary,    │
              │ sends to DeepSeek + Haiku  │
              │ to prime prompt caches.    │
              │ Returns sessionId.         │
              └─────────────┬──────────────┘
                            │
                       user types
                            │
                            ▼
              POST /api/chat { mode:'tiered', sessionId, messages }
                            │
              ┌─────────────▼─────────────────┐
              │ Tier 1 — DeepSeek-V4-Flash    │
              │ system prompt = catalog dump  │
              │ tool schemas with enum =      │
              │   live product/recipe IDs     │
              │ returns: prose + tool calls   │
              └─────────────┬─────────────────┘
                            ▼
              ┌─────────────────────────────────┐
              │ Tier 2 — deterministic validator│
              │ - tool inputs ∈ catalog?        │
              │ - prose scan vs denylist?       │
              └─────────────┬───────────────────┘
                            │ clean → return
                            │ flagged ↓
                            ▼
              ┌─────────────────────────────────┐
              │ Tier 3 — Claude Haiku 4.5       │
              │ Sees catalog + draft prose,     │
              │ answers JSON: { grounded,       │
              │ reasons }. False positives      │
              │ from Tier 2 get overturned here.│
              └─────────────┬───────────────────┘
                            │ grounded → return
                            │ not grounded ↓
                            ▼
              ┌─────────────────────────────────┐
              │ Tier 4 — Claude Sonnet 4.6      │
              │ Regenerates from scratch with   │
              │ an injected correction listing  │
              │ the off-catalog references.     │
              └─────────────────────────────────┘
```

Every response carries `meta.resolvedByTier` and `meta.validationReasons` so we can see which tier handled which turn. The expected distribution at steady state is ~80% Tier 2, ~15% Tier 3, ~5% Tier 4.

### Code map (Phase 0.5)

- `src/lib/ai/catalog-summary.ts` — builds the stable catalog string. Stable bytes = cache hits.
- `src/lib/ai/system-prompt.ts` — the system prompt preamble + catalog. Stable across requests by design. **The primary file you edit to tune tone, balance, and assertiveness — see the working guide below.**
- `src/lib/ai/tools.ts` — provider-neutral tool schemas. The `enum` on `productIds`/`recipeId` is populated from `getAllProducts()` / `getAllRecipes()` at request time.
- `src/lib/ai/validator.ts` — Tier 2 deterministic check (enum + denylist prose scan).
- `src/lib/ai/text-mentions.ts` — parser that finds recipe/product titles in free-form prose. Used by the route as a citation-inference fallback, and by the chat UI to render mentions as clickable links.
- `src/lib/ai/budget.ts` — dev-mode daily request caps per provider (see "Manual budget control" below).
- `src/lib/ai/providers/deepseek.ts` — fetch-based OpenAI-compat client. Contains the `temperature: 0.6` setting — secondary lever for assertiveness.
- `src/lib/ai/providers/anthropic.ts` — Haiku verifier + Sonnet regenerator + warmup helper.
- `src/lib/ai/orchestrator.ts` — runs the four tiers in order, returns a single result.
- `src/lib/ai/session-cache.ts` — in-process map of sessionId → warmedAt (spike-only; see future scope).
- `src/app/api/chat/session/route.ts` — warmup endpoint.
- `src/app/api/chat/budget/route.ts` — `GET` shows budget; `DELETE` resets it.
- `src/app/api/chat/route.ts` — extended with a `mode: 'tiered'` branch alongside the legacy `live` (Claude-only) and `scripted` paths. Returns HTTP 429 with budget details on cap-exceeded.
- `src/hooks/useChat.ts` — when `NEXT_PUBLIC_AI_MODE=tiered`, calls warmup once per page session and passes the sessionId on every subsequent chat call.
- `scripts/env-init.mjs` — `npm run env:init` copies `.env.example → .env.local` without overwriting.
- `scripts/ai-budget.mjs` — `npm run ai:budget` / `npm run ai:budget:reset`.

### Hallucination enforcement — three layers

1. **Tool-use enum** at the protocol level. `recommend_products.productIds` is typed `array<string, enum: [...catalogIds]>`. A properly behaved model cannot emit an ID outside the enum.
2. **Deterministic validator** as defense in depth. Catches any provider that ignores enum constraints, plus does a coarse denylist scan of prose for known off-catalog brand names.
3. **Haiku verifier** as the appeals court. Decides whether prose flagged by the regex is actually a leak (e.g. recommending an off-catalog item) versus an editorial mention (e.g. declining to recommend one).

Why layered: the protocol-level enum is the strongest stop, but DeepSeek's enum enforcement is less battle-tested than Anthropic's. The validator catches the small percentage of cases where DeepSeek slips. Haiku catches everything else and avoids regenerating on false positives.

### Citation inference — the "name-it, call-it" safety net

A separate failure mode: the model emits prose like "I'd go with **Nigiri Sushi**" but forgets to call `cite_recipe`. The recipe is named — visibly — but no structured tool call means the UI never pins it.

Two defenses, layered:

1. **Prompt rule**: `system-prompt.ts` explicitly tells the model "if you NAME a catalog recipe or product in prose, you MUST emit the matching tool call." This catches ~95% of cases.
2. **Server-side parser fallback** in `src/lib/ai/text-mentions.ts`. After the orchestrator returns, the route scans the prose for known recipe/product titles (longest-match wins, alias-aware, whole-word). If the model named a recipe but didn't call `cite_recipe`, the route auto-pins it and logs `citationInferred: true` so we can see the slip rate.

The same parser will power inline clickable links in the chat UI (Phase A of the linkified-prose feature) — one piece of code, two purposes.

## Invariant — conversation drives the listing

The recipe list under the chat is the **second line** of the same conversation. Three non-negotiable rules:

1. **Every asset named in the AI's response must appear in the recipe list.** No exceptions. If the AI says "Shrimp Tempura is the move," shrimp-tempura is in the visible list.
2. **The cited asset is pinned to position 0** of that list. The user shouldn't have to scan past unrelated dishes to find what was just recommended.
3. **Doubtful state shows no recipes.** When the conversation has produced NO signal (no dish keyword, no cited recipe, no taste-style preference), the recipe column renders nothing. Dumping the catalog on someone exploring buries their intent under 12 options. The chat does the narrowing first (themed `ask_clarifying` options); the list appears once intent crystallizes.

### Three states, three behaviours

| State | What "this state" looks like | List behaviour |
|---|---|---|
| **Doubtful** | User said something vague ("I don't know what to cook"). No dish keyword detected, no cited recipe, no taste style set yet. | **Empty.** AI's themed clarifying question carries the discovery; recipe column stays blank. |
| **Crystallized** | User named a dish family ("ramen sounds good") OR AI committed via `cite_recipe` OR user has ≥3 taste-grid love signals. | **Filtered.** Show that dish family only (or, with taste signals, show recipes ranked by style alignment). Pin the cited recipe to position 0 if there is one. |
| **Disagreement** | User said "sushi" but the AI committed to a tempura recipe. | **Cited recipe wins.** Filter to the cited recipe's group; the user's free-text is a hint the AI's commitment supersedes. |

**Precedence when the user's keyword disagrees with the AI's pick** (e.g., user says "sushi", AI cites `shrimp-tempura`): the **cited recipe wins**. The AI made the commitment; the listing reflects it.

### Implementation contract

Four pieces have to stay in sync for the invariant to hold:

| Where | Contract |
|---|---|
| [api/chat/route.ts](intently/src/app/api/chat/route.ts) | `dishGroup = recipeDishGroup(citedRecipe) ?? dishGroupFromText(lastUserMsg)` — cited recipe's group wins. Returned in `meta.dishGroup`. |
| [hooks/useChat.ts](intently/src/hooks/useChat.ts) — **store wiring lives here** | Every successful `sendMessage` call invokes `syncStoreSignals(result)` which sets `mentionedDish = result.meta?.dishGroup` and `citedRecipeId = result.recipeId ?? null` on the store. Call sites (EntrySection, StickyPrompt, ConversationSection) do NOT do this themselves. |
| [components/sections/RecipeList.tsx](intently/src/components/sections/RecipeList.tsx) — empty-state guard | Render nothing when `dishGroupFromText(mentionedDish) === null && !citedRecipeId && !tasteProfile.dominantStyle`. Doubtful state stays blank. |
| [components/sections/RecipeList.tsx](intently/src/components/sections/RecipeList.tsx) — cited-recipe failsafe | After dish-group filtering, if `citedRecipeId` is not in `visible`, hydrate it via `getRecipeById` and prepend it anyway. The filter never excludes the cited recipe. |

**Why the store wiring lives in `useChat`, not in each call site**: the invariant is "every asset named in chat appears in the recipe list." With wiring in each call site, you have N places to forget; the 2026-05-19 regression where the first message (sent through `EntrySection`) silently dropped `mentionedDish` is exactly the failure mode this prevents. `useChat` is the single funnel — adding a future call site automatically inherits the contract.

If you change any of these pieces, run the four regression tests that guard the invariant:

- `src/tests/api/chat.test.ts` — "dishGroup precedence: cited recipe wins over user keyword"
- `src/tests/text-mentions.test.ts` — "matches a recipe title containing parentheses"
- `src/tests/components/DualStreamSection.test.tsx` — "hides the recipe column when products are present but no conversational signal (discovery phase)"
- `src/tests/hooks/useChat.test.tsx` — "syncs mentionedDish + citedRecipeId to the store after a tiered response"

## Response composition — what comes out of the orchestrator

A single chat turn produces up to five pieces of structured output. The `/api/chat` route composes them into the response envelope:

| Tool / source | Carries | UI consumes as |
|---|---|---|
| Prose text (model's free output) | Voice, context, vivid detail | The chat bubble copy |
| `recommend_products` tool call | Catalog product ids + a one-sentence reason | Product chips in the discovery section |
| `cite_recipe` tool call | A recipe id + a one-sentence reason | Pins the recipe to position 0 in [[recipe-list]] |
| `ask_clarifying` tool call | A question + 3–4 short option strings | Inline bulleted options under the prose |
| `show_taste_grid` tool call | A one-sentence framing reason | Sets `activeSection: 'taste-grid'`; the 9-tile picker mounts |
| Server inferred (`text-mentions.ts`) | citedRecipeId when prose names a recipe but `cite_recipe` was missed | Same pinning as above; logged as `citationInferred` |

The response shape returned to the client is `{ text, products?, recipeId?, intent, meta: { resolvedByTier, validationReasons, dishGroup, showTasteGrid?, clarifying? } }`. When the model emits prose AND a clarifying tool call, the route stitches the question + options below the prose so users never see a dangling sentence.

### Scroll-target contract per tool call

Each tool-call type implies a different "where the viewport should land after the response." This is part of the response contract — every call site of `useChat.sendMessage` must honour it, or the user sees the right data in the wrong scroll position (see the 2026-05-19 "tiles below the fold" regression).

| Tool call | Actionable element | Scroll target |
|---|---|---|
| `recommend_products` | product chips | `conversation` (chips render under the chat — conversation answer is the headline) |
| `cite_recipe` | recipe card pinned in RecipeList | `conversation` (recipe column is below; users scroll naturally) |
| `ask_clarifying` | bulleted options inline under the prose | `conversation` (options ARE the prose continuation) |
| `show_taste_grid` | 9-tile picker with love/skip buttons | **`taste-grid`** — the section's internal chrome (eyebrow + heading + bowls + "Pick 3 styles" copy) consumes ~400px before any tile is interactive; anchoring on `conversation` puts tiles below the fold on short viewports |

The rule: target the **actionable element of the response**, not the prose. When in doubt, ask "what's the next thing the user clicks?" and make sure that's visible after the scroll settles.

### When show_taste_grid fires

For purely exploratory prompts ("inspire me", "surprise me", "not sure", "what should I cook"), the model is prompted to call `show_taste_grid` *instead of* `cite_recipe` / `recommend_products`. The grid is a calibration moment — users pick a cooking style visually, populating `tasteProfile.signals` and eventually `dominantStyle`, which feeds the recipe ranker via `STYLE_MATCH_BONUS`.

The route surfaces this as `meta.showTasteGrid: true` + `intent: 'browse'`. `EntrySection` and `StickyPrompt` consume `response.showTasteGrid` and call `setActiveSection('taste-grid')`. This is the SAME path the scripted fallback uses — single contract, single UI consumer.

Discrimination rule (in the system prompt): the model does NOT call `show_taste_grid` when the user has named a dish, technique, or occasion. Action wins for committed intent; the grid is for pure exploration. Verified across 5 runs: `"inspire me"` → 5/5 trigger the grid; `"I want ramen"` → 0/5 trigger the grid, all hit `cite_recipe`.

## Working guide — tone, balance, assertiveness

The three voice levers you'll keep coming back to. Each has a specific control surface, a way to test in isolation, and a failure mode at each extreme.

### The two files you'll edit

- **[intently/src/lib/ai/system-prompt.ts](intently/src/lib/ai/system-prompt.ts)** — `buildSystemPrompt(summary)` returns the static preamble that ships with every request. The Identity / Voice / Bias-toward-action / Grounding rules blocks live here. This is the **primary lever** for all three factors below.
- **[intently/src/lib/ai/providers/deepseek.ts](intently/src/lib/ai/providers/deepseek.ts)** — `temperature: 0.6` in the request payload. Lower (0.3) = more consistent across runs, slightly more robotic. Higher (0.8) = more variety, occasionally surprises. Secondary lever; tune second if prompt edits alone don't get you there.

Do NOT edit `buildCatalogSummary()` for voice — that's the data layer; mixing voice into it would couple two unrelated concerns.

### Factor 1 — TONE (voice character)

What the AI sounds like. Warm vs clinical, friendly vs corporate, casual vs formal.

**Where**: the `Tone:` line at the top of the prompt, plus the worked examples.

**The strongest lever**: examples. One concrete "User says X → Intently says Y" pair shapes voice more than three paragraphs of adjectives. The model copies what it sees.

**Anatomy of an effective tone block:**

```
Tone: warm, concise, like a friend who cooks seriously. Dish first, technique
second, tool third.

Voice examples — what works:
- "Tonkotsu is the most rewarding starter — long broth, real depth. Here's the kit."
- "Maki rolls are the welcoming entry — rolling at the table, everyone gets involved."

Voice examples — what to avoid:
- "You should definitely buy our Hangiri Sushi Bowl, it's the best!" (pushy, hard-sell)
- "I think maybe you might consider possibly trying…" (hedging, weak)
- "Sushi is a delicious Japanese dish enjoyed worldwide…" (encyclopedia, no voice)
```

**Failure modes**:
- Too friendly → "Hey friend! 🎉 Awesome question!!" (uses emojis, exclamation points; embarrassing)
- Too clinical → "The recommended preparation method for tonkotsu broth involves…" (instruction manual)

**Test prompt**: `"What's a good Sunday cook?"` — vague intent, model has to fill the space with voice. Run 3 times. If the tone is right across all three, the prompt is dialled in.

### Factor 2 — BALANCE (action vs clarifying)

How quickly the model commits to a recommendation vs asking for more info. Today's prompt biases hard toward action via the "BIAS TOWARD ACTION" block — but you can dial it either way.

**Where**: the "BIAS TOWARD ACTION" block and the "Use ask_clarifying ONLY when" block.

**Levers**:
- Add or remove worked examples in the action block. More examples → more action-bias.
- Tighten or loosen the "ONLY when" list for `ask_clarifying`. Tight list → model commits more; loose list → model asks more.
- Add a meta-rule: "When the user gives ≥3 specific signals (dish + occasion + style), do not ask — pick." Or the opposite: "When the user gives <2 signals, ask before recommending."

**Failure modes**:
- Too action-biased → model commits to maki sushi when the user is open to anything; feels like a recipe vending machine
- Too clarifying-biased → model asks 3 questions before recommending anything; feels like a survey

**Test prompts** for the balance dial:

| Prompt | What should happen |
|---|---|
| "I want to make ramen" | Commit (tonkotsu or shoyu) — clear dish, no ambiguity |
| "Something special for my anniversary" | Either ask (occasion-vague) OR commit boldly (sukiyaki at the table) — depends on where you want the dial |
| "What should I cook?" | Ask — too vague to commit usefully |

Run each 3 times. If the balance shifts in the wrong direction for the middle one, that's the prompt you're tuning.

### Factor 3 — ASSERTIVENESS (confidence when picking)

The difference between "Tonkotsu is the move" and "Maybe you might consider tonkotsu, if that sounds good?" Same recommendation, totally different feel.

**Where**: the "Voice — what to avoid" block in the prompt + the cadence rule.

**Hedge words to ban explicitly** (the strongest move):

```
Never use: "you should", "I recommend", "I'd suggest", "perhaps", "maybe",
"if you like", "definitely", "absolutely", or exclamation points.
Confidence comes from picking, not from pushing or hedging.
```

**Affirmative voice patterns the model can copy:**

```
✓ "Tonkotsu is the move."
✓ "Maki sushi evening — the welcoming start."
✓ "I'd go with the Staub Cocotte for this."
```

The third example uses "I'd go with" which is assertive-but-personal. It commits without instructing. That's the sweet spot for "polite and assertive, not pushy."

**Failure modes**:
- Too assertive → "Buy this. It's the right one." (commands, not conversation)
- Too hedged → "It might be worth thinking about whether you'd consider trying…" (no commitment, exhausting to read)

**Test prompt**: `"What knife should I get?"` — direct ask. The model should pick one and name a reason, in two sentences. If the response is three paragraphs of trade-offs or starts with "It depends!", assertiveness is too low.

### The editing & testing loop

```bash
# Terminal 1: dev server with all logging
LOG_LEVEL=debug NEXT_PUBLIC_AI_MODE=tiered npm run dev

# Terminal 2: same prompt × 3, look for tone/balance/assertiveness shifts
for i in 1 2 3; do
  echo "=== Run $i ==="
  curl -s -X POST http://localhost:3000/api/chat \
    -H 'Content-Type: application/json' \
    -d '{"mode":"tiered","messages":[{"role":"user","content":"I want to make ramen"}]}' \
    | jq -r '.text'
  echo
done
```

Run the same prompt **three times minimum**. One good response isn't proof a change worked; one bad response isn't proof it didn't. The model is non-deterministic — you're sampling a distribution, not testing a function.

Watch the structured log for the tool calls: `grep "tier-1 deepseek" .logs/ai.log | tail -3`. If the prompt is supposed to bias toward action but `toolCalls=["ask_clarifying"]` keeps showing up, the prompt isn't reaching the model with enough force.

### Cache invalidation when editing the prompt

Both DeepSeek and Anthropic hash the bytes of the system prompt for caching. Any edit — even whitespace — produces a fresh hash. The mechanics:

- Restart `npm run dev` after editing (Next.js doesn't hot-reload server modules in all cases for this kind of change).
- First request after restart pays full input cost (~$0.018 on cache miss vs ~$0.0045 on hit). One request, then back to cheap.
- Catalog data is the bulk of the prompt; editing voice rules is cheap because the catalog block is small relative to the whole string. The cost difference between full-miss and full-hit is real but per-edit, not per-request.

### Anti-patterns to avoid

- **Don't pile on "ALWAYS" rules.** Models slip on the 8th "ALWAYS"; three strong ones beat eight weak ones.
- **Don't add rules that contradict.** "Be brief" + "Explain the technique thoroughly" → the model picks one and you can't predict which.
- **Don't smuggle catalog details into the voice block.** Specific product pairings (e.g., "always pair gyuto with hinoki board") belong in `pairsWith` fields or recipe data, not the prompt. Otherwise you have two sources of truth.
- **Don't tune for one prompt.** A change that fixes "anniversary" might break "I want ramen". Test the change against 4–5 different intents before declaring it good.
- **Don't add long abstract definitions.** "Be polite" doesn't help the model. A two-line good/bad example does.
- **Don't fight non-determinism with prompt length.** If you're on the 100th-line of "ALSO ALWAYS REMEMBER…", drop the temperature instead.

### When prompt changes alone aren't enough

Sometimes the model is fundamentally unsure and prompt edits hit diminishing returns. Three escape hatches:

1. **Lower temperature** ([deepseek.ts](intently/src/lib/ai/providers/deepseek.ts)) — 0.6 → 0.3. Less variety, more reliable adherence to instructions.
2. **Pin specific behaviours server-side** — e.g., the `text-mentions.ts` parser pins recipes the model mentions even if it forgets the tool call. This is the architectural escape from "model usually does X but sometimes doesn't."
3. **Switch primary providers** for an intent class. The orchestrator supports DeepSeek-as-primary and could be re-pointed at Anthropic-as-primary; voice differs noticeably between them. Phase 1 will make this a single env-var flip.

## Warmup — how it works

The catalog summary (system prompt + product list + recipe list) is the **largest stable part** of every request — about 6,000 tokens. Resending it without caching means turn 1 of every conversation pays full input price. Both DeepSeek and Anthropic offer prompt caching with much cheaper cache-hit pricing (DeepSeek ~$0.07/1M vs $0.27/1M; Anthropic ~$0.30/1M vs $3/1M).

The warmup endpoint exploits this. On page mount, `useChat` fires `POST /api/chat/session`. The handler:

1. Builds the canonical catalog summary string (stable bytes — same every time).
2. Fires a tiny `ping` request at DeepSeek with that catalog as the system prompt. The provider's cache stores the bytes for hours.
3. Fires a tiny `ping` at Anthropic with `cache_control: { type: 'ephemeral' }` on the catalog block. Cache holds for ~5 minutes (or 1h on the extended tier).
4. Returns a `sessionId` plus diagnostics: which providers warmed, how many products/recipes are in the cached catalog.

When the user sends their first real message, the system prompt bytes match the cached version → cache hit → the actual input billed is just the user's question plus history. **First-turn TTFB drops from ~1.2s to under 500ms.**

Session continuity is then a function of identical-prompt-bytes, not of explicit "context-handle" APIs — both providers transparently hit the cache as long as the same prefix bytes are sent within the TTL. The `sessionId` is purely a correlation identifier for our logs; it's not passed to the model providers.

### What "session" means here

| Layer | Lifetime | Stored where |
|---|---|---|
| Catalog summary string | Server-process lifetime (rebuilt on boot) | RAM |
| DeepSeek context cache | Hours, opaque | DeepSeek edge |
| Anthropic ephemeral cache | 5 minutes (1h tier coming) | Anthropic edge |
| `sessionId` | Page lifetime | `useChat` module-level variable |
| Conversation messages | Page lifetime | Zustand `conversation` slice |

The "session" the user perceives is the page mount. Reload = new sessionId = new warmup. Idle for >5 minutes = cache miss on Anthropic side but DeepSeek likely still warm.

## User stories — what the user can do today

Each story below is a real exchange you can run against the spike with `NEXT_PUBLIC_AI_MODE=tiered`, `DEEPSEEK_API_KEY` set, and `ANTHROPIC_API_KEY` set for the guardrail tiers.

### Story 1 — Cook intent ("I want to make X")

> **User:** "I want to make tonkotsu ramen this weekend"
>
> **Intently:** "Great call — tonkotsu ramen is a weekend project worth every minute. Here's the recipe and the gear that makes it sing."
>
> [chips: Staub Cocotte 28, Mesh Skimmer, Ramen Bowl Set]
>
> `meta.resolvedByTier: tier-2-validator`

DeepSeek emits a `recommend_products` tool call with three real catalog IDs. The deterministic validator confirms the IDs are in the live catalog, the prose has no off-catalog brand mentions, and returns immediately. No Claude call needed.

### Story 2 — Tool discovery ("what knife should I buy?")

> **User:** "What knife is best for sashimi?"
>
> **Intently:** "For sashimi, the answer is clear: a yanagiba — the long, single-bevel blade designed specifically for that one clean slicing motion through raw fish."
>
> [chip: Yanagiba 270]
>
> `meta.resolvedByTier: tier-2-validator`

Narrow tool query; one-product answer. The system prompt's "dish first, technique second, tool third" rule keeps the response on the user's intent.

### Story 3 — Editorial honesty ("do you carry X?" where X is off-catalog)

> **User:** "Do you carry a Wüsthof santoku? I want a German knife."
>
> **Intently:** "We don't carry Wüsthof or any German-style knives. Our entire knife collection is Japanese: lighter, sharper, with thinner blade geometry. The closest in feel would be our Nakiri 165mm — flat, vegetable-focused, excels at the same push-cut motion. Or if you're open to a Japanese chef's knife, the Gyuto is the counterpart to a Western chef's knife."
>
> `meta.resolvedByTier: tier-3-haiku`
> `meta.validationReasons: ["prose mentions off-catalog term 'wusthof'"]`

This is the hardest case and the one that justifies the tier structure. The deterministic validator (Tier 2) sees "wüsthof" in the prose and flags it. But Haiku (Tier 3) reads the prose and sees the AI is *declining* the off-catalog item, not recommending it. Haiku returns `grounded: true` and Tier 4 is skipped. The user gets editorial honesty instead of a fabricated SKU.

### Story 4 — Ambiguous browse intent

> **User:** "I have a Sunday afternoon free. Inspire me."
>
> **Intently:** "What pulls you in right now — a long, hands-on weekend project (broths, breads), or something quieter and meditative (a single dish, a quiet technique)?"
>
> `meta.resolvedByTier: tier-2-validator`

DeepSeek calls `ask_clarifying` rather than guessing. No product chips render until intent is clear. This is the system prompt's "editorial honesty over fabricated breadth" rule kicking in.

## How it will work at full scope (Phase 1+)

The spike proves the architecture. The path from spike to full scope is well-defined:

### Phase 1 — production-grade orchestrator

- **Streaming (shipped 2026-05-21)** — `/api/chat` returns SSE when the client sends `Accept: text/event-stream`. The route emits `open` → `delta` (one per text chunk from the streaming primary call) → `final` (structured envelope) → optionally `error`. `useChat` pushes an empty assistant placeholder, appends deltas to it as they arrive, and replaces the content with the canonical `final.text` once the orchestrator finishes — the swap covers the rare Sonnet-regenerate correction case. Tier-3 verifier and Tier-4 regenerator don't stream; they're internal correction paths fast enough that user-visible streaming isn't a meaningful win. The blocking JSON path is preserved for test mocks and non-SSE callers (no Accept header → no stream).
- **Provider abstraction (shipped 2026-05-21)** — `ChatProvider` interface at `src/lib/ai/providers/types.ts`; selection at `src/lib/ai/providers/index.ts` driven by `AI_PRIMARY_PROVIDER` (default `deepseek`, also accepts `anthropic`). The orchestrator no longer imports concrete provider functions for the primary call; verifier (Haiku) and regenerator (Sonnet) stay direct imports because they have provider-specific signatures and no swap benefit.
- **Telemetry (shipped 2026-05-21)** — `src/lib/ai/telemetry.ts` records every turn (tier, duration, finishReason, validationReasons, guardrailDisabled) into a bounded in-memory ring. `/api/chat/telemetry` returns the snapshot: per-tier counts + percentages, p50/p95/p99 latency, top validation reasons. The route's per-call log line now includes `ip`, `approxInputTokens`, `approxOutputTokens`, `validationReasons`, `finishReason`, `durationMs`, and `primary`. Eyeball it via `curl localhost:3000/api/chat/telemetry | jq`. Multi-replica deployments will need a shared backing store — logged in prodprep.md when that day comes.
- **Eval harness (shipped 2026-05-21)** — `src/tests/recommend/grounding.test.ts`. 15-row golden set × `expectedTools` / `expectedProductIds` / `expectedRecipeIds` / `forbiddenSubstrings` / `forbiddenTier4`. Two halves: SHAPE tests always run in CI (assert the eval logic on mocked orchestrator responses); LIVE tests opt in via `RUN_GROUNDING_EVAL=1 + DEEPSEEK_API_KEY` and hit the real orchestrator. The seam from the provider abstraction lets the LIVE run A/B DeepSeek vs Anthropic by flipping `AI_PRIMARY_PROVIDER`.
- **Abuse mitigation (Phase 1a — shipped 2026-05-21)** — six caps in front of the orchestrator. Lives at `src/lib/ai/abuse.ts`. See "Phase 1a — abuse mitigation" below for the threat model and defenses.

### Phase 2 — deterministic ranker + personalisation

Today the orchestrator dumps the entire catalog into the system prompt. At full scope, a deterministic ranker in `src/lib/recommend/ranker.ts` pre-ranks based on:

```
score(product) =
    40 * tasteAlignment(product.category, user.tasteSignals)
  + 30 * dishMatch(product.intent.enablesDishes, mentionedDishes)
  + 20 * libraryAdjacency(product.pairsWith, user.ownedAssetIds)
  + 10 * editorialWeight(product) / 100
```

Only the top-12 products and top-8 recipes are passed to DeepSeek. Saves tokens, gives the model a quality-sorted shortlist, and exposes the score breakdown for a future debug overlay.

Personalisation pulls from the existing `AccountStore` (`listTasteSignals`, `getLibrary`, `listOrders`) — no new tables required.

### Phase 3 — persistence + the conversion loop

Two new Supabase tables:

- `chat_messages` — `{ id, user_id, session_id, role, content_jsonb, tool_calls_jsonb, created_at }`
- `recommendation_events` — `{ id, user_id, session_id, message_id, tool_name, asset_ids text[], created_at, clicked_at, ordered_at, resolved_by_tier }`

The `recommendation_events` table closes the loop on "which AI suggestions converted" — feeding into the editorial-weight tuning called out in `docs/roadmap.md`.

### Phase 4 — local M2 mode

A hybrid mode where the scripted ranker (deterministic) picks product IDs and a local Ollama model (Qwen 2.5 7B-Instruct, ~6GB Q4) only paraphrases. Keeps the catalog promise rock-solid (no LLM picks the IDs) while letting contributors hack without any API key. Falls back to pure scripted if Ollama is unreachable.

### Phase 5 — promoting `sessionId` to durable state

The current in-memory `session-cache.ts` is a spike convenience. At full scope:

- `sessionId` becomes the FK that ties `chat_messages` and `recommendation_events` together for analytics.
- Cache warmth becomes a function of identical bytes hitting provider caches; the server doesn't need to track it explicitly beyond logging.
- A scheduled job rebuilds the catalog summary on catalog edits and re-warms both providers (otherwise turn 1 after a catalog change pays full freight).

## Cost — current vs full scope

Per conversation, 5 turns, ~6k token catalog warmed at session start:

| Tier | Cost (Phase 0.5 today) | Cost (Phase 3 with ranker) |
|---|---|---|
| Tier 1 DeepSeek | ~$0.006 | ~$0.003 (smaller context after ranking) |
| Tier 3 Haiku verifier (~30% of turns) | ~$0.002 | ~$0.002 |
| Tier 4 Sonnet regenerate (~5% of turns) | ~$0.003 | ~$0.003 |
| **Per conv** | **~$0.011** | **~$0.008** |
| 1,000 conv/mo | ~$11 | ~$8 |
| 10,000 conv/mo | ~$110 | ~$80 |

Compare to all-Sonnet at ~$0.05/conv: the tiered architecture is ~5× cheaper without giving up the strict-catalog promise.

## Manual budget control (dev mode)

`src/lib/ai/budget.ts` is a per-provider, per-day request counter that runs **before every external AI call**. Counts persist to `.ai-budget.json` at the project root (gitignored, auto-resets at the date boundary). When a cap is hit, the provider call throws `BudgetExceededError`, the chat route returns HTTP 429, and the client falls back to scripted.

Caps come from env (defaults shown):

```
AI_DAILY_CAP_DEEPSEEK=100
AI_DAILY_CAP_HAIKU=50
AI_DAILY_CAP_SONNET=20
AI_DAILY_CAP_WARMUP=30
```

Operational surface:

| Action | CLI | HTTP |
|---|---|---|
| Show budget | `npm run ai:budget` | `GET /api/chat/budget` |
| Reset counts to zero | `npm run ai:budget:reset` | `DELETE /api/chat/budget` |
| Initialize `.env.local` | `npm run env:init` | — |

The `peek()` output is also embedded in every `POST /api/chat/session` response so the UI can display "you've used X/Y today" without an extra round-trip.

This is the **local** safety net. The authoritative spend limit should be set provider-side as well:

- Anthropic Console → Plans & Billing → Usage limits (monthly $ cap)
- DeepSeek Console → Quota (token/$ cap)

Belt-and-braces — local cap stops a runaway dev loop in seconds, provider cap stops a runaway *process* if the local cap is somehow bypassed (different machine, forgotten env override, etc.).

### Why caps are per-day, not per-session

Two reasons: development iteration spans many sessions but the bill is daily; and dev-server restarts shouldn't reset the counter (otherwise a crash loop would silently retry forever). Date-boundary reset means tomorrow you start fresh without any manual step.

## Failure modes — what to watch for in logs

A few distinct ways a turn can fail in tiered mode. Each has a different signature in `.logs/ai.log` and a different fix.

### Output truncation (`finishReason: "length"`)

**Symptom**: user sees an unhelpful fallback message ("Hmm — my answer ran longer than I have room for…") or, in older builds, just "…".

**What happened**: DeepSeek hit `max_tokens` mid-generation. When the cap fires while the model is writing a tool-call JSON arguments string, the OpenAI-compat API drops the partial tool call entirely rather than returning malformed JSON. Result: 500-800 output tokens billed, zero usable output reaches the route. The 2026-05-18 regression for "I want to make sushi" was exactly this — DeepSeek burned all 500 tokens writing a long `ask_clarifying` with several options and dropped the whole call.

**Log signature**:
```
"deepseek output truncated at max_tokens"   # WARN level
"orphan response — truncated at max_tokens" # WARN level (route fallback)
```

**Fixes, in order**:
1. Raise the cap: `AI_MAX_OUTPUT_TOKENS=1200` in `.env.local` (default is 800).
2. If hits stay frequent, the system prompt's examples have probably grown — shorten them so the model copies tighter responses.
3. As a last resort, drop `temperature` from 0.6 → 0.3 in `providers/deepseek.ts` for more terse generations.

**Why this design**: failing visibly with a useful retry message beats failing silently with "…". The WARN log captures every truncation so the rate is observable; if you see them clustered you know the prompt is drifting toward verbosity.

### Orphan response (no tool calls, no text, finishReason != length)

**Symptom**: user sees "…" with no other signals.

**What happened**: the model returned an empty `message.content` AND no `tool_calls`, but didn't hit the token cap. This is rare — usually a content-filter trigger on the provider side, or a model glitch. The fix is to retry the same prompt; if it keeps happening, drop the temperature.

**Log signature**:
```
"orphan response — no prose, no tool reasons, no products"
```

### Editorial-leak false positive (Tier 2 flag, Tier 3 overturns)

**Symptom**: nothing visible — the user sees a clean response. This is the system working.

**What happened**: the deterministic validator flagged a known off-catalog brand name (e.g., "Wüsthof") in the prose, but the AI was actually *declining* to recommend it ("we don't carry Wüsthof, here's the Gyuto"). Haiku reviewed the prose context, returned `grounded: true`, and the response shipped intact. Logged at `tier-3-haiku` resolution.

**Log signature**:
```
"escalating to tier-3"   # with reasons like ["prose mentions off-catalog term"]
"tier-3 haiku"           # grounded: true
"resolved" tier: tier-3-haiku
```

No action needed. If you see Tier 3 firing on responses that AREN'T editorially honest declines, the prompt or denylist needs tuning.

## Provider integration — checklist for any new tool-using LLM

Every time we add a new provider (or a new tool-using surface on an existing one), the same six checks apply. They emerged from real bugs — the 2026-05-18 "…" sushi regression was the canonical example, but each one represents a class of failure that's silent unless explicitly instrumented.

### The core principle

**Tool-using LLMs can produce zero-output runs that still bill at full input + max-output cost.** When the model is mid-way through a tool-call's JSON arguments and hits `max_tokens`, OpenAI-compat providers (DeepSeek, OpenAI, and others) drop the partial tool call entirely rather than returning malformed JSON. From the caller's perspective: empty `content`, empty `tool_calls`, full output-token bill. Anthropic behaves similarly when `stop_reason: 'max_tokens'` fires mid-tool-use.

The implication: a zero-output response is not necessarily a free response. It's the most expensive way to learn that your `max_tokens` is too tight.

### The checklist

When adding a new provider — or a new tool-using surface on an existing one:

1. **Log `finishReason` on every response.** Map the provider's vocabulary to our `FinishReason` type (`'stop' | 'length' | 'tool_calls' | 'content_filter' | 'other'`). Without this in the structured log, every other check is harder to verify.

2. **WARN on `finishReason: 'length'`.** Truncations are a financial signal, not a debug curiosity. The rate should be observable without grepping `debug` lines.

3. **Plumb `finishReason` from the provider → orchestrator → route.** Add the field to `ProviderResponse` and `OrchestratorResult`. The route's fallback logic needs to distinguish "model truncated" from "model returned nothing."

4. **Give cap-exhaustion a distinct user-facing fallback.** Empty output + `finishReason === 'length'` deserves an actionable nudge ("try a more specific question") not a generic `"…"`. Empty output from other causes is a different bug class and should surface differently.

5. **Size `max_tokens` against the realistic worst case, not the median.** Measure the longest expected output (longest prose + longest tool-call JSON + JSON overhead), multiply by ~1.5 for headroom. As the system prompt grows, recheck — examples in the prompt teach the model to copy that length. The 500 → 800 bump on 2026-05-18 was triggered by exactly this drift.

6. **Write a regression test for the empty-output + truncation path.** Mock the provider to return `{ text: '', toolCalls: [], finishReason: 'length' }` and assert the user-facing message is the actionable nudge, not "…". This is the single most useful test in the chat suite — the bug pattern recurs, and the test catches it the moment it would slip back in.

### Adjacent failure modes worth knowing about

Lower-frequency but each has cost the spike a debug session at some point:

- **Schema enforcement variance.** DeepSeek's `input_schema.enum` is OpenAI-compat but less strictly enforced than Anthropic's. The Tier 2 deterministic validator exists because of this. Other providers may slip differently — if you add one as a primary, verify against the validator's eval set before trusting the enum alone.
- **Token-counter drift.** Each provider has its own tokenizer; the same prompt costs slightly different amounts to each. Don't budget against one provider's count when planning a multi-provider tier structure.
- **Cache hash sensitivity.** DeepSeek's cache hashes the whole system-prompt string; Anthropic hashes block by block when `cache_control` is set explicitly. Mixing both means the same prompt edit invalidates differently on each side.
- **Streaming behaviour for tool calls.** When/if we add SSE streaming (Phase 1b), tool call arguments arrive incrementally. Partial JSON in a stream is a different bug class than truncated final responses — needs its own assembly + validation logic.

### Where this lives in code

- `FinishReason` type: [src/lib/ai/types.ts](intently/src/lib/ai/types.ts)
- DeepSeek mapping + WARN log: [src/lib/ai/providers/deepseek.ts](intently/src/lib/ai/providers/deepseek.ts) (`normalizeFinishReason`, `'deepseek output truncated at max_tokens'`)
- Anthropic mapping: [src/lib/ai/providers/anthropic.ts](intently/src/lib/ai/providers/anthropic.ts) (`mapAnthropicStopReason`)
- Route fallback split: [src/app/api/chat/route.ts](intently/src/app/api/chat/route.ts) (the `result.finishReason === 'length'` branch)
- Regression test: [src/tests/api/chat.test.ts](intently/src/tests/api/chat.test.ts) ("returns a useful retry nudge when the model is truncated")

## Known limits and trade-offs

- **DeepSeek enum enforcement** is less strict than Anthropic's. The deterministic validator is load-bearing. If eval shows DeepSeek's enum-failure rate creeping above ~5%, the orchestrator can be flipped to Anthropic-primary by setting `AI_PRIMARY_PROVIDER` (Phase 1+) — same architecture, different provider.
- **The prose denylist is coarse.** It catches common off-catalog kitchen-tool brand names but will miss niche terms. Haiku exists to cover what the denylist doesn't.
- **Catalog changes invalidate caches.** When a product is added/removed/renamed, the catalog summary string changes and caches must re-warm. Today this happens implicitly on the next request (which pays full freight). Phase 5 promotes this to an explicit invalidation hook.
- **Latency from EU/US to DeepSeek (China-hosted) can be variable** (200–800ms TTFB). If this becomes a real UX issue we'll measure and consider DeepSeek's regional endpoints or flip the primary to Anthropic for latency-sensitive intents.

## Phase 1a — abuse mitigation (shipped 2026-05-21)

The grounding work made the tiered path *safe* for content. Phase 1a makes it *safe for the wallet* — six caps that bound how much an attacker (or a runaway client bug) can spend.

Lives at [`intently/src/lib/ai/abuse.ts`](../../intently/src/lib/ai/abuse.ts). Throws typed errors that `/api/chat` and `/api/chat/session` catch and map to HTTP status. All state is in-memory and per-process — fine for single-replica deployments; production with >1 replica will need Redis-backed counters (logged in [prodprep.md](../../prodprep.md)).

### Threat model

| # | Attack | Defense | HTTP |
|---|---|---|---|
| 1 | Token-bomb prompt | `AI_MAX_PROMPT_CHARS` per-request rejection | 413 PROMPT_TOO_LONG |
| 2 | Conversation-length explosion | `AI_MAX_HISTORY_TURNS` + `AI_MAX_HISTORY_CHARS` | 413 PROMPT_TOO_LONG |
| 3 | Prompt flood from one tab | Rolling-window `AI_SESSION_PROMPTS_PER_WINDOW`/`_WINDOW_SECONDS` | 429 RATE_LIMITED + Retry-After |
| 4 | Sonnet-baiting (force Tier 4) | `AI_SESSION_SONNET_REGENERATES` per-session cap | orchestrator returns `meta.guardrailDisabled=true`; UI falls back to scripted |
| 5 | Session-recycle from one IP | `AI_SESSION_NEW_PER_IP_HOUR` warmup cap | 429 RATE_LIMITED + Retry-After (on `/session`) |
| 6 | Aggregate cost over a long session | `AI_SESSION_MAX_APPROX_TOKENS` token-meter (chars/4 heuristic) | 429 SESSION_EXHAUSTED |
| 7 | Bogus / replayed sessionId | `getSession()` validates against `session-cache` | 400 INVALID_SESSION |

### Defense layering

Together with the existing day-budget caps and provider-side spend limits, the layers stack so bypassing one still hits the next:

| Layer | Threat | When it fires | Scope |
|---|---|---|---|
| Phase 0.5 dev-mode budget | runaway dev loop | per-day | per **process** |
| Phase 1a session lifetime | one tab abusing for hours | per-session | per **sessionId** |
| Phase 1a session rolling window | rapid-fire spam | rolling 5 min | per **sessionId** |
| Phase 1a IP-warmup cap | session-recycling attack | rolling 1 hour | per **IP** |
| Phase 1b (later) IP-prompt cap | distributed flood | rolling minute | per **IP** |
| Provider-side console caps | catastrophic overspend | monthly | per **API key** |

### Worst-case cost ceiling

With the paranoid early-dev defaults shipped in `.env.example`:

- 40 prompts per session × ~$0.005 avg ≈ **$0.20 per session**
- 10 sessions per IP per hour × $0.20 ≈ **$2/hour/IP**
- Provider-side monthly cap is the only hard backstop; everything else exists so it never triggers.

### Two orchestrator hooks worth knowing about

- **`disableSonnet`** — `enforceLimits()` returns `sonnetExhausted: boolean`; the route forwards this as `runOrchestrator(..., { disableSonnet })`. When true, the orchestrator skips Tier 4 even if Haiku says the output is ungrounded, returns the Tier-1 text, and sets `guardrailDisabled: true`. The UI consumes `meta.guardrailDisabled` to silently fall back to scripted.
- **`recordOutcome()`** — called post-flight from the route with `(sessionId, resolvedByTier, outputChars)`. Increments the Sonnet-regen counter when Tier 4 fired, and refines the token-meter estimate with the actual response size.

### Test surface

[`intently/src/tests/abuse.test.ts`](../../intently/src/tests/abuse.test.ts) — 14 unit tests covering each typed-error path, both rolling-window edges, the Sonnet-regen counter, and the per-IP cap. `nowMs` is passed in explicitly so the tests don't depend on wall-clock.

Route-level mapping (typed-error → HTTP status, header presence, body shape) lives in [`intently/src/tests/api/chat.test.ts`](../../intently/src/tests/api/chat.test.ts) and [`intently/src/tests/api/chat-session.test.ts`](../../intently/src/tests/api/chat-session.test.ts).

### Why no IP-level prompt cap yet

Phase 1a only enforces IP at the `/session` chokepoint. Per-IP **prompt** rate limits ship in Phase 1b once we've collected real distribution from production traffic — sizing them blind would either be too tight (false positives) or too loose (no defense). The plumbing logs the IP on every request from day one so the data accumulates.

### What this does NOT cover

- Distributed enforcement across replicas (in-memory map). Add Redis when you grow past one Next.js process.
- Signed/HMAC sessionIds. The session-cache enforcement raises the bar; if it turns out to be bypassable in practice we add HMAC.
- CAPTCHA / proof-of-work. Out of scope until evidence of bot attacks.

## Related

- [[ai-mode-toggle]] — the original two-mode (scripted ↔ live) toggle. Tiered is the third mode added in Phase 0.5.
- [[use-chat]] — the hook that picks the mode and passes the sessionId through.
- [[supabase-over-medusa]] — the backbone choice that makes Phase 3 persistence cheap.
