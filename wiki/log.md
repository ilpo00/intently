---
type: log
---

# MISE wiki — log

Append-only chronological record of ingests, queries, and lints. Each entry starts with `## [YYYY-MM-DD] <op> | <subject>` so it's grep-friendly: `grep "^## \[" log.md | tail -10`.

## [2026-05-05] init | wiki scaffold

Bootstrapped the wiki from the LLM Wiki pattern.

Created: [[AGENTS]] (schema), [[index]], this log, and seeded `entities/`, `concepts/`, `decisions/`, `sources/`.

## [2026-05-05] ingest | CLAUDE.md

First source ingested: project-root `CLAUDE.md`.

- Created [[claude-md]] (source summary).
- Created entities: [[intently-store]], [[use-chat]].
- Created concepts: [[river-architecture]], [[ai-mode-toggle]].
- Created decision: [[dependency-pinning]].
- 6 pages added to [[index]].

Pending (mentioned but not promoted to pages yet): `data-layer-swap`, `intent-scoring`, `scripted-ai-engine`, `live-chat-route`, `dual-stream-layout`, `client-shell`.

## [2026-05-09] decision | supabase-over-medusa

Account backbone branch landed (commits `cfb3ac0` → `eb9ca2e`, branch `claude/xenodochial-franklin-642f0c`). Resolves the open question about which backend MISE adopts for user-scoped data.

- Created [[supabase-over-medusa]] — Supabase (Postgres) for users / orders / library_items / taste_signals; Medusa deferred indefinitely with explicit trigger conditions for revisit.
- Source docs synced: `CLAUDE.md` "Data layer is swappable" section rewritten; `mise/README.md` "Upgrading to Medusa (v2)" section replaced with "Backend & data layer".
- [[index]] updated: new decision linked; the `data-layer-swap` pending entry removed (resolved by the ADR); replaced with `account-store` as a future promotion candidate.
- Technical reference (schema, AccountStore interface, mode toggle, security note, verification) lives at `mise/docs/account-backbone.md` — not in the wiki because it's how-to, not rationale.

Side note: the v0.1.x posture is RLS-off + hardcoded `'demo-user'`. Honest scaffolding, not accounts. Auth + RLS turn on in v0.2.

## [2026-05-16] retro | river non-linear navigation + commitment lock

Session resolved a long-standing UX trap (returning users auto-advanced into a stale discovery view with no escape) plus a clutch of related river issues, by adding a waypoint history strip and codifying a persistence rule. Also tried and rolled back a two-river / branches direction.

Commits: feat `7acbc6c` + merge `9278bde` on `main`. Branch `claude/pedantic-pasteur-d3a500` (deleted on remote).

- Created [[persistence-restores-data]] (concept) — hydration restores DATA, never navigates. The new codebase-wide invariant. `hasInteractedWithTaste` is the first instance of the session-scoped gate this requires.
- Created [[waypoints-slice]] (entity) — breadcrumb history with auto-push on `setActiveSection` / `setDiscoveredProducts` plus explicit push in `StickyPrompt.handleSubmit` before the destructive `resetCurrentRiver`. FIFO cap of 5; strip renders inline beneath the sticky bar.
- Created [[rivers-spike-rejected]] (decision) — N=2 branches direction built behind `NEXT_PUBLIC_RIVERS=on`, evaluated, rolled back. Drift was solved by the waypoint strip; branches were solving a problem (parallel shopping) that didn't survive contact with the spike. Trigger conditions for revisit documented.
- Updated [[intently-store]] to mention the new slice + the persistence-restores-data linkage.
- Updated [[river-architecture]] to call out the in-river back path (waypoints) and the explicit `lock-at-3` commitment.
- [[index]] updated: 3 new pages, 2 new pending pages (`session-reset`, `taste-grid-section`).

Also landed (no wiki page needed, just commit forensics): scripted-AI `inspire me` lifted above the `conversationLength === 0` gate (mid-conversation chip now triggers the taste grid); all auto-scrolls past the assistant answer removed (sticky-bar scrolls UP to conversation now); SessionReset bottom-left affordance for wiping localStorage + in-memory state without devtools.

## [2026-05-16] concept | tiered-ai-architecture (Phase 0.5 spike)

Landed a working spike of the tiered chat architecture: DeepSeek-V4-Flash primary + Anthropic Haiku verifier + Sonnet regenerator, with session-start catalog warmup. Smoke tests pass against the real DeepSeek API (cook intent, tool intent, off-catalog editorial-honesty case).

- Created [[tiered-ai-architecture]] — covers current spike state, code map, three-layer hallucination enforcement, warmup mechanics, user stories, and the full-scope roadmap (Phases 1–5).
- Added `mode: 'tiered'` branch to `src/app/api/chat/route.ts` next to the legacy `live` (Claude-only) and `scripted` paths.
- New endpoint `src/app/api/chat/session/route.ts` warms DeepSeek + Anthropic prompt caches with the catalog so turn 1 lands warm.
- New module `src/lib/ai/` with `catalog-summary`, `system-prompt`, `tools`, `validator`, `orchestrator`, `session-cache`, and `providers/{deepseek,anthropic}`.
- `useChat` extended: when `NEXT_PUBLIC_AI_MODE=tiered`, fires warmup once on first send and passes `sessionId` on every subsequent call.
- `.env.example` updated with `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL=deepseek-v4-flash` (matches the local helper scripts in `~/bin/deepseek-{read,write}`), and optional `ANTHROPIC_HAIKU_MODEL` / `ANTHROPIC_SONNET_MODEL` overrides.
- [[index]] updated: [[tiered-ai-architecture]] added under Concepts.

Smoke test outcomes (with `DEEPSEEK_API_KEY` set, no Anthropic key — guardrail tiers skipped):
- "I want to make tonkotsu ramen this weekend" → `recommend_products(staub-cocotte-28, ramen-bowl-set)` + warm prose. Resolved at tier-2-validator.
- "What knife is best for sashimi?" → `recommend_products(yanagiba-270)`. Resolved at tier-2-validator.
- "Do you carry a Wüsthof santoku?" → editorially honest "we don't carry Wüsthof, here's nakiri/gyuto" reply. Validator flagged the prose mention; with no Anthropic key, the flag returned in `meta.validationReasons` rather than being overturned by Haiku. Documents exactly the false-positive case the tier structure exists to handle.

## [2026-05-19] bugfix | inspire-me mid-conversation: taste grid tiles below the fold

User-reported: after a few-turn conversation, typing "inspire me" via the sticky bar produced the right prose response ("Let's find your cooking style first…") but "UI showed only couple of tools, no recipes and no taste grid." Logic-side I verified everything was correct — server returned `meta.showTasteGrid: true`, route surfaced it, useChat passed it through, StickyPrompt called `setActiveSection('taste-grid')`, the section rendered at 715px. So why did the user see no grid?

**Diagnosis via browser Preview** (mise-preview-plan, approved by user): captured viewport + element rects after the click. On a 575px-tall viewport:
- Conversation reply: y=42–231 (visible)
- "What kind of cook are you?" header: y=323 (visible)
- **First interactive tile: y=647 — below the fold (575)**

The taste-grid section's internal padding (eyebrow + heading + subhead + bowls + "Pick 3 styles" copy) consumes ~400px BEFORE any actionable tile. With the existing `scrollToSection('conversation')` anchoring on the conversation, the tiles ended up entirely below the fold on laptop viewports. The user saw the conversation reply + section header + 3 empty bowl icons peeking at the bottom — and the bowls were what they called "couple of tools."

The bug: not logic, not data flow — a **scroll-target choice that worked for product/discovery responses but failed for the taste-grid response** because the taste-grid section's internal layout differs (much more vertical chrome before the actionable element).

Fix: when `response.showTasteGrid` is true, scroll to the `taste-grid` section instead of `conversation`. The conversation reply is 2-3 sentences — the user reads it during the scroll animation, then lands on the actionable tiles. Applied in BOTH call sites:
- [StickyPrompt.tsx:88-117](mise/src/components/ui/StickyPrompt.tsx) — restructured the branch to set `scrollTarget` then call `scrollToSection(scrollTarget)` at the end.
- [EntrySection.tsx:78-94](mise/src/components/sections/EntrySection.tsx) — was relying on "user is at the top" with no scroll. For inspire-me-as-first-message on short viewports, same problem applies. Added `scrollToSection('taste-grid')` in the showTasteGrid branch only; other branches keep the no-auto-scroll behaviour.

Verified live in Preview: after fix, three taste tiles (Weekend project cook, Fast weeknight, Baking precision) all visible above the fold with the conversation reply just visible at the top. 325 tests pass; typecheck + lint + build green.

Learning, worth saving:

> **An auto-scroll target that's right for one response shape can be wrong for another.** The scroll-to-conversation rule was built around a typical response (2-3 sentence prose + product chips immediately below). When the response was a "see the section below" pointer (taste grid), the rule kept the pointer visible but hid the destination. **When designing a scroll-after-response rule, ask: what's the most actionable element of the response, and is it visible after the scroll?** If the response routes the user to a new section whose interactive content has significant vertical chrome (header, instructions, decoration), target the actionable element, not the section header.

Worth promoting to a permanent rule in [[tiered-ai-architecture]]'s "Response composition" section: every tool-call type has a "where should the viewport land" implication, and that's part of the response contract.

## [2026-05-19] bugfix | recipe-list signal wiring centralised in useChat

User report: AI responded "Tonkotsu is the one to start with…" but the recipe list was empty. Same bug class as the earlier "Shrimp Tempura missing from listing" — recipe named in chat, not in the listing — but a different root cause.

Root cause: only `ConversationSection` (the follow-up message path) called `setMentionedDish` + `setCitedRecipe` from the response. The FIRST message in any conversation goes through `EntrySection` (entry chip / hero input), and follow-ups via the sticky bar go through `StickyPrompt`. Both ignored `response.recipeId` and `response.meta?.dishGroup` → store stayed empty → RecipeList's empty-state guard (added 2026-05-19) hid the column.

The fragile shape: three call sites, three places to forget. Adding a 4th surface (hover-card click → chat? voice input?) would silently miss the wiring again.

Architectural fix (answers the user's question "How to ground this as an absolute rule?"):

**Move the universal store wiring INTO useChat itself.** New `syncStoreSignals(result)` runs after every successful response — both the tiered path and the scripted fallback. Call sites no longer touch `setMentionedDish` / `setCitedRecipe`; they're a contractual side effect of `sendMessage`. Any future call site automatically inherits.

- [useChat.ts](mise/src/hooks/useChat.ts) — added `syncStoreSignals(result)` invoked in all 4 return paths (tiered happy / tiered http-fail fallback / tiered exception fallback / scripted mode).
- [ConversationSection.tsx](mise/src/components/sections/ConversationSection.tsx) — removed the now-redundant manual calls. EntrySection / StickyPrompt unchanged (they never had the calls; now they don't need them).
- [useChat.test.tsx](mise/src/tests/hooks/useChat.test.tsx) — new regression test: mock /api/chat returns `{recipeId, meta.dishGroup}` → assert `useIntentlyStore.getState().citedRecipeId === 'tonkotsu-ramen'` and `.mentionedDish === 'ramen'`. Test does NOT render any component — proves the wiring is in the hook, not the view.

Wiki invariant section updated: the implementation contract table grew from 3 rows to 4. New row explicitly says "useChat owns the wiring; call sites don't." Cross-reference to the new regression test.

Pattern worth remembering: **side-effect-of-call beats "every caller must remember."** When N call sites need to do the same thing after the same operation, the operation should do it itself. The caller's job is to handle the call-site-SPECIFIC stuff (auto-scroll, layout, intent flag); the universal store updates are part of the operation.

325 tests pass (was 324).

## [2026-05-19] feat | taste grid back via show_taste_grid tool

User feedback: the "inspire me" chip lost the taste-grid trigger when we moved from scripted to tiered AI. The new BIAS TOWARD ACTION prompt pushed the model to commit immediately ("host a Maki Sushi Evening...") instead of deferring to the 9-tile style picker. The grid wasn't deleted — the conversational trigger was lost.

Decision (per plan, Phase 1.5): Option A — AI-driven via a new `show_taste_grid` tool. Options B (server-side keyword override) and C (persistent chip) documented as fallbacks if A's hit rate proves unreliable.

Implementation:
- New tool schema in [tools.ts](mise/src/lib/ai/tools.ts) with a single `reason` field. No catalog enum (the picker is a UI affordance, not a catalog reference).
- `ToolCall['name']` union widened; both provider tool-name guards updated (deepseek + anthropic).
- [validator.ts](mise/src/lib/ai/validator.ts) accepts the new tool via shape-only check.
- [system-prompt.ts](mise/src/lib/ai/system-prompt.ts) gained an EXPLORATORY section with two worked examples ("inspire me" → grid; "I don't know what to cook" → grid) AND an explicit non-trigger rule: "do NOT call show_taste_grid when the user has named a dish, technique, or occasion."
- [route.ts](mise/src/app/api/chat/route.ts) detects the tool call → sets `meta.showTasteGrid: true` and `intent: 'browse'`. Uses `tasteGridTool.input.reason` as the prose fallback when text is empty.
- [useChat.ts](mise/src/hooks/useChat.ts) prefers `data.meta.showTasteGrid` over the brittle text-content inference (kept as fallback for transition).
- EntrySection / StickyPrompt unchanged — they already consumed `response.showTasteGrid` and called `setActiveSection('taste-grid')`.
- Test added in [chat.test.ts](mise/src/tests/api/chat.test.ts): mock orchestrator returns show_taste_grid → assert `meta.showTasteGrid === true`, `intent === 'browse'`, no products, no recipeId.

Live verification with real DeepSeek (`temperature: 0.6`):
- "inspire me" × 5 runs → 5/5 fired `show_taste_grid`, all `intent: browse`, prose was the framing line.
- "I want to make ramen" → 0/5 fired the grid; hit `cite_recipe(tonkotsu-ramen)`. Discrimination rule works.

[[tiered-ai-architecture]] response-composition table expanded from 4 to 5 outputs; new "When show_taste_grid fires" subsection documents the discrimination rule and verification numbers.

324 tests pass (was 323).

## [2026-05-19] rule | recipe list stays empty in doubtful/discovery state

User feedback: when they typed "I do not know what to cook", the list showed all 12 recipes. Wrong behaviour — doubtful state should not dump the catalog. The chat should ask themed clarifying options first ("hands-on weekend?", "quick comforting bowl?"), and the list should only appear once intent crystallizes.

Reinterpreted my earlier (wrong) interpretation of "if user is doubtful, various kinds can be shown" — the user did NOT mean "show all 12." They meant the chat presents themed options until the user picks one.

Fix in [RecipeList.tsx](mise/src/components/sections/RecipeList.tsx): early-return empty recipes array when `dishGroupFromText(mentionedDish) === null && !citedRecipeId && !tasteProfile.dominantStyle`. The existing `if (recipes.length === 0) return null` guard then collapses the column entirely. Discovery phase = no recipe list; once any of the three signals appears, the list reactivates.

[[tiered-ai-architecture]] invariant section rewritten — now states **three** non-negotiables (was two): every named asset appears + cited asset pinned + **doubtful state shows nothing**. Three-state table (Doubtful / Crystallized / Disagreement) makes the behaviour explicit.

DualStreamSection.test.tsx updated: the existing "renders the recipe + tools columns when products are present" test now also sets `setMentionedDish('ramen')` because the realistic post-chat state always includes a dish signal. Added new test: "hides the recipe column when products are present but no conversational signal (discovery phase)" — guards against future regression.

## [2026-05-19] bugfix | recipe listing missed AI-cited asset when user keyword disagreed

User-reported: AI response said "Shrimp Tempura (Ebi)" but the recipe listing didn't show that recipe at all. Root cause was structural: the route derived `dishGroup` with the wrong precedence — `dishGroupFromText(userMsg) ?? recipeDishGroup(citedRecipe)`. When the user said something containing "sushi" and the AI committed to a tempura recipe, dishGroup became 'sushi', `RecipeList` filtered to sushi-only, and shrimp-tempura was dropped. The existing `citedRecipeId` pin logic was a no-op because the cited recipe wasn't in `visible` to begin with — `find` returned undefined, no error surfaced, the listing rendered without the mentioned asset.

Two-layer fix:
1. **Inverted dishGroup precedence in [api/chat/route.ts](mise/src/app/api/chat/route.ts)**: `recipeDishGroup(citedRecipe) ?? dishGroupFromText(userMsg)`. The AI's commitment is the strongest conversational signal; the listing should reflect that.
2. **Belt-and-braces in [RecipeList.tsx](mise/src/components/sections/RecipeList.tsx)**: if `citedRecipeId` is missing from the filtered `visible` list, hydrate it via `getRecipeById` and prepend anyway. The filter never excludes the cited recipe. Pure failsafe.

Tests:
- Regression in `src/tests/api/chat.test.ts` ("dishGroup precedence: cited recipe wins over user keyword") — user says "I want sushi", AI cites shrimp-tempura, assert `meta.dishGroup === 'tempura'`.
- Parser test for the parenthetical title `Shrimp Tempura (Ebi)` in `src/tests/text-mentions.test.ts`.
- Full dish-group taxonomy coverage in `src/tests/recipes.test.ts` — every seed recipe classifies cleanly, no nulls in the catalog.

Promoted the rule to a permanent **"Invariant — conversation drives the listing"** section in [[tiered-ai-architecture]], stating the two non-negotiables (every named asset appears, cited asset is pinned) and the implementation contract between the route and RecipeList. Future-me reading the wiki will not re-derive this.

315 → 322 tests pass.

## [2026-05-18] bugfix | DeepSeek output truncation produced "…" replies

User-reported: `"I want to make sushi"` → response was just `…`. Forensic in `.logs/ai.log` showed `finishReason: "length"`, `outputTokens: 500`, `toolCallNames: []`, `textLen: 0` — DeepSeek hit the `max_tokens: 500` cap mid-generation while writing an `ask_clarifying` tool call with several options. OpenAI-compat APIs drop partial tool calls on truncation, so the whole turn arrived empty for full price.

Root cause: the 500-token cap was set when the system prompt was leaner. As we added BIAS TOWARD ACTION examples and the name-it-call-it rule, the model started copying longer responses, and 500 became too tight for the realistic worst case (long clarifying option list + 2-3 sentences of prose + tool-call JSON).

Fix:
- Default `max_tokens` bumped 500 → 800 in [providers/deepseek.ts](mise/src/lib/ai/providers/deepseek.ts) (`DEFAULT_MAX_OUTPUT_TOKENS`).
- Exposed via `AI_MAX_OUTPUT_TOKENS` env var so it can be tuned per-deployment without a code change.
- `FinishReason` type added to [types.ts](mise/src/lib/ai/types.ts); plumbed through `ProviderResponse` → `OrchestratorResult` → route response.
- New WARN log "deepseek output truncated at max_tokens" fires on every truncation so the rate is visible without grepping debug.
- Route fallback split: when text is empty AND `finishReason === 'length'`, the user now sees `"Hmm — my answer ran longer than I have room for. Try a more specific question, like '…'"` instead of `…`. The generic orphan fallback only fires when the truncation isn't the cause.
- Regression test in `src/tests/api/chat.test.ts` covers the empty-output + `length` case explicitly.
- New [[tiered-ai-architecture]] section "Failure modes" documents the three visible failure signatures (truncation, orphan, editorial-leak false positive) with log signatures and concrete fixes.

Learning: tool-using models can produce zero-output runs that still bill at full input + max-output. Always log `finishReason`; always have a separate fallback path for `"length"` vs other empty-output causes. The OpenAI-compat protocol's "drop partial tool calls" behaviour is silent — without explicit logging it's invisible.

Promoted the learning to a permanent **"Provider integration — checklist for any new tool-using LLM"** section in [[tiered-ai-architecture]]. Six checks (log finishReason, WARN on length, plumb through layers, distinct cap-exhaustion fallback, size against worst case, regression test) plus a "core principle" framing and four adjacent failure modes (schema enforcement variance, token-counter drift, cache hash sensitivity, streaming partial tool calls). This becomes the read-once-when-adding-a-new-provider reference.

## [2026-05-18] update | tiered-ai-architecture conversation guide

Wiki refreshed with the latest tiered-AI behaviour, plus a working guide for tuning tone, balance, and assertiveness (the three voice factors the user asked about).

- [[tiered-ai-architecture]] additions:
  - **"Citation inference — the name-it, call-it safety net"** section documents the `text-mentions.ts` server-side parser that auto-pins a recipe when the model names it in prose but forgets `cite_recipe`. Same parser will power the Phase A clickable-links feature.
  - **"Response composition — what comes out of the orchestrator"** table breaks down how prose + tool calls + inferred citations are stitched into the final response envelope. Demystifies why the UI sometimes shows extra options below the prose.
  - **"Working guide — tone, balance, assertiveness"** replaces the older "Tuning the AI voice" stub. Three named factors (Tone = voice character, Balance = action-vs-clarifying, Assertiveness = confidence when picking), each with: the file/line to edit, the strongest lever, an anatomy-of-an-effective-block snippet, failure modes at both extremes, a specific test prompt, and an editing-and-testing loop.
  - Mentions the `temperature: 0.6` setting in `deepseek.ts` as a secondary lever — lower for consistency, higher for variety.
  - Anti-patterns list expanded with "don't tune for one prompt" and "don't fight non-determinism with prompt length — drop the temperature instead."
  - Three escape hatches when prompt-tuning hits diminishing returns: lower temperature, pin behaviour server-side (parser model), switch primary providers.
- Code-map entry for `text-mentions.ts` added; system-prompt.ts annotated as the primary tuning file.

This is the canonical guide for tone iteration going forward. The user is doing active testing; they want to keep editing the prompt without needing to ask "where do I change X?" every time.

## [2026-05-17] cleanup | scripted soft-deprecation + live deletion

Tiered AI is now the default; the legacy `NEXT_PUBLIC_AI_MODE=live` (Claude-only) path is deleted. Scripted mode is `@deprecated` but kept functional as the emergency fallback for CI and offline contributors.

- `useChat` defaults to tiered; the `isLive` branch and all its code paths are gone.
- `/api/chat/route.ts` stripped of the legacy `<products>` regex path, the hardcoded `SYSTEM_PROMPT`, the standalone `Anthropic` client, and the `getAllProducts`/`buildAgentCatalog` direct imports. All traffic now routes through the orchestrator.
- `src/lib/scripted-ai.ts` marked `@deprecated` at file and function level with a directive that new conversational behaviour goes to the tiered system prompt + tool schemas.
- `.env.example` reordered: `NEXT_PUBLIC_AI_MODE=tiered` is the default value; the legacy `live` value is documented as removed.
- `CLAUDE.md` updated — the "scripted ↔ live" toggle description rewritten to describe the new tiered-default reality.
- [[ai-mode-toggle]] rewritten for the new shape.
- [[tiered-ai-architecture]] gained a "Tuning the AI voice" section: where to edit `system-prompt.ts`, what invalidates the cache, prompt-engineering anti-patterns to avoid. Addresses the user's question about adding tone directives (e.g., "polite and assertive, not pushy").

302 tests still pass — scripted-ai is functionally unchanged, the only deletion is the legacy live branch that wasn't covered by tests.

Added a per-provider daily request cap on top of the spike. Every external AI call (DeepSeek, Haiku, Sonnet, warmup) now runs `checkAndRecord` before firing. Counts persist to `.ai-budget.json` (gitignored, daily auto-reset). Cap-hit returns HTTP 429 and `useChat` falls back to scripted.

- New `src/lib/ai/budget.ts` with `BudgetExceededError`, `checkAndRecord`, `peek`, `reset`.
- New `GET /api/chat/budget` (status) and `DELETE /api/chat/budget` (reset) endpoint.
- New `scripts/env-init.mjs` — `npm run env:init` copies `.env.example → .env.local` without overwriting.
- New `scripts/ai-budget.mjs` — `npm run ai:budget` shows status table; `npm run ai:budget:reset` zeroes today's counts.
- Wired budget checks into `callDeepSeek`, `haikuVerify`, `sonnetRegenerate`, `haikuWarm`; warmup endpoint counts both warm calls under the `warmup` provider so reload-spam doesn't burn the main DeepSeek budget.
- `.env.example` now ships with `AI_DAILY_CAP_DEEPSEEK=100 / HAIKU=50 / SONNET=20 / WARMUP=30` defaults (deliberately tight; raise via `.env.local`).
- [[tiered-ai-architecture]] updated with a "Manual budget control" section and a clarification that the local cap complements provider-side spend limits (Anthropic Console → Plans & Billing → Usage limits; DeepSeek Console → Quota).

## [2026-05-20] skill-round | three new Claude skills installed

Round of agent-skill development. Three new internal skills shipped at `~/.claude/skills/`:

- **`mise-preview-plan`** — structured Preview verification plan template; enforces the ASK-FIRST rule from [[claude-md]] § Browser verification before any browser MCP invocation. Iteration-2 added a pre-check section ("would reading the code obviate the Preview run?") that surfaced a false-premise refactor in eval-2 and let a static `will-change-transform` fix preempt a Preview run in eval-1. Full skill-creator eval loop run, iteration-1 → iteration-2.
- **`mise-motion-polish`** — applies design.md's five non-negotiable motion/scroll rules + persistence-gate reminder; composes with `mise-preview-plan` via required handoff. Vibe-evaled 3/3.
- **`mise-tiered-ai`** — forces Tier 0 (deterministic) / Tier 1 (DeepSeek) / Tier 2 (Claude verifier) proposals for AI features; honestly says "don't tier this" when the feature is too small. Vibe-evaled 3/3.

Created [[agent-skill-system]] (concept) documenting the active skill set, triggers, deferred candidates, and the round process. [[index]] updated.

Deferred: `mise-section-scaffold` (waiting for the next section), `mise-retro-adr` (overlap with wiki-ingest), open-source split of `mise-preview-plan` (until internal version is stable). Flagged but not addressed: the [[task-observer]] log is empty across sessions — the 2026-05-20 round generated skills from inferred patterns rather than logged observations. Fixing the observation pipeline is the lead candidate for the next round.

Process artifacts: `~/.claude/skills/mise-preview-plan-workspace/iteration-{1,2}/`, `~/.claude/skills/mise-motion-polish-workspace/iteration-1/`, `~/.claude/skills/mise-tiered-ai-workspace/iteration-1/`. Plan file at `~/.claude/plans/help-me-to-enhance-expressive-quail.md`.

Worth noting on the rebase: while this round was running, main landed [[tiered-ai-architecture]] (2026-05-16 → 2026-05-19) — the actual tiered-AI implementation the `mise-tiered-ai` skill was designed to nudge toward. And the [[mise-preview-plan]] skill was already in real production use on 2026-05-19 for the inspire-me/taste-grid scroll-target bugfix. So two of the three skills now document and enforce systems that have either landed (tiered AI) or have proven their value in a real diagnosis (preview-plan). The concept page is updated to reflect this.

## [2026-05-21] feat | Phase 1a abuse mitigation shipped

Cost-correctness gate for the tiered AI. The grounding work made the path safe for content; this makes it safe for the wallet.

New `mise/src/lib/ai/abuse.ts` with three typed errors (`PromptTooLongError`, `RateLimitedError`, `SessionExhaustedError`) + `InvalidSessionError` + `enforceLimits()` + `enforceWarmupForIp()` + `recordOutcome()`. Six caps in front of the orchestrator:

- per-request: `AI_MAX_PROMPT_CHARS` (2000), `AI_MAX_HISTORY_TURNS` (20), `AI_MAX_HISTORY_CHARS` (8000) → 413
- per-session: `AI_SESSION_PROMPTS_PER_WINDOW` (8) in `AI_SESSION_WINDOW_SECONDS` (300), `AI_SESSION_PROMPTS_LIFETIME` (40), `AI_SESSION_MAX_APPROX_TOKENS` (30000) → 429
- per-session Sonnet cap: `AI_SESSION_SONNET_REGENERATES` (2) → orchestrator returns `meta.guardrailDisabled=true`; UI falls back to scripted
- per-IP: `AI_SESSION_NEW_PER_IP_HOUR` (10) at the warmup chokepoint → 429

Wired into both routes. `/api/chat` validates the sessionId against `session-cache` (400 INVALID_SESSION when missing/bogus) before running `enforceLimits()`, then forwards `disableSonnet: sonnetExhausted` to the orchestrator. After the orchestrator returns, `recordOutcome()` bumps the Sonnet-regen counter when Tier 4 fired and refines the token-meter with the real output size.

Orchestrator extended with `disableSonnet?: boolean` arg and `guardrailDisabled?: boolean` result. When the cap kicks in, Tier 4 is short-circuited; the Tier-1 text is returned with a validationReason marker.

`useChat` surfaces `meta.rateLimited` to the fallback ChatResult so a future toast can read it without changing visible chat behaviour. Rate-limited responses don't immediately retry-as-scripted (calling again would just re-hit the wall) — the next user-typed prompt routes through tiered as normal.

Worst-case ceiling with these defaults: ~$0.20 per session × 10 sessions per IP per hour ≈ **$2/hour/IP**. The provider-side monthly cap remains the only hard financial backstop; these exist so it never triggers.

14 new unit tests in `src/tests/abuse.test.ts` covering each typed-error path, both rolling-window edges, the Sonnet-regen counter, and per-IP cap. Route-level tests in `src/tests/api/chat.test.ts` (4 new) + new `src/tests/api/chat-session.test.ts` (2). Full suite: **345 passing**, typecheck clean, lint clean, build green.

Updated [[tiered-ai-architecture]] with a Phase-1a section (threat model + defense layering table + worst-case ceiling + what's NOT covered). Phase 1b adds IP-level prompt-rate limits once the IP plumbing accumulates real distribution; signed sessionIds and Redis-backed state stay deferred until evidence demands them.

## [2026-05-21] refactor | Phase 1b provider abstraction shipped

The orchestrator's Tier-1 primary call now hides behind a `ChatProvider` interface. Verifier (Haiku) and regenerator (Sonnet) stay direct imports — they have provider-specific signatures and no swap benefit. The seam that's actually useful is the bulk-generator one, and that's the one this PR builds.

- New `mise/src/lib/ai/providers/types.ts` — `ChatProvider` interface with `{ name, call(args) }`. Minimal on purpose: anything more is dead weight that future providers would have to implement without benefit.
- New `mise/src/lib/ai/providers/index.ts` — `getPrimaryProvider(config)` + `getPrimaryProviderName()` resolves `AI_PRIMARY_PROVIDER` (default `deepseek`, also accepts `anthropic`). Unknown values log a warning and fall back to deepseek; case-insensitive.
- `providers/deepseek.ts` gained `makeDeepSeekProvider(config): ChatProvider`. `callDeepSeek` export kept so the warmup endpoint can pass `budgetProvider:'warmup'` directly.
- `providers/anthropic.ts` gained `callAnthropicPrimary` (mirror of `sonnetRegenerate` minus the correction message; uses Sonnet, counts against the `sonnet` daily budget) + `makeAnthropicProvider(config): ChatProvider`. When flipping to Anthropic-primary you'll want to raise `AI_DAILY_CAP_SONNET` from 20 — the default is sized for the verifier-only role.
- `orchestrator.ts` no longer imports `callDeepSeek` directly. Constructs the primary via `getPrimaryProvider()` and logs `tier-1 ${primary.name}` so escalation telemetry distinguishes the path. The `if (!config.deepseek) throw` guard moved up into `getPrimaryProvider` where it can take the chosen provider into account.
- `/api/chat` key check is now provider-aware: when `AI_PRIMARY_PROVIDER=anthropic`, missing `ANTHROPIC_API_KEY` returns 503 `NO_ANTHROPIC_KEY` (and `DEEPSEEK_API_KEY` becomes optional). The default-primary path still 503s with `NO_DEEPSEEK_KEY` exactly as before.
- `.env.example`: documented `AI_PRIMARY_PROVIDER` and the implication for `DEEPSEEK_API_KEY` (optional under Anthropic-primary).

8 new tests in `src/tests/providers.test.ts` (selection + missing-key error paths + unknown-value fallback + case-insensitive parsing) + 1 new test in `src/tests/api/chat.test.ts` (NO_ANTHROPIC_KEY route response when primary=anthropic). All 354 tests pass; typecheck, lint, build green. The `providers.test.ts` file runs in node environment because anthropic.ts imports the Anthropic SDK which expects a node runtime — same pattern as the existing chat route tests.

This is the seam the Phase 1c eval harness will exploit to A/B DeepSeek vs Anthropic against the same prompts. Phase 1b's remaining sub-track — SSE streaming — is held until we decide whether to verify the rendered surface change via Preview MCP, per CLAUDE.md's ask-first rule.

## [2026-05-21] feat | Phase 1c telemetry + grounding eval harness

Observability. The wedge of Phase 1c is "is the tiered AI healthy?" answerable at a glance instead of by greppinig `.logs/ai.log`.

- New `mise/src/lib/ai/telemetry.ts` — `recordTurn({tier, durationMs, validationReasons, guardrailDisabled, finishReason, sessionId, primary})` + `snapshot()`. In-memory ring buffer capped at 200 samples; counters keep counting beyond the buffer. Computes p50/p95/p99 latency from the ring; tallies the top-10 recent validation reasons; counts truncatedAtLength and guardrailDisabled events.
- New `GET /api/chat/telemetry` — returns the snapshot as JSON. Sibling to `/api/chat/budget`. Hit it with `curl localhost:3000/api/chat/telemetry | jq` during dev to see the tier-resolution distribution and whether DeepSeek is hitting the 80/15/5 target.
- `/api/chat` per-turn log line now carries the fields the plan called for: `ip`, `resolvedByTier`, `primary`, `approxInputTokens`, `approxOutputTokens`, `validationReasons`, `finishReason`, `guardrailDisabled`, `durationMs`, plus the existing recipe / product / clarifying fields. Token approximations use chars/4 — same heuristic the abuse meter uses. When Phase 1c-2 lands we'll refine with real provider usage.
- New `src/tests/recommend/grounding.test.ts` — the eval harness the plan promised. Two halves: **SHAPE tests** always run (6 cases) and verify the harness's own logic (tool-match, recipeId allowlist, productId allowlist, forbidden-substring scan, forbiddenTier4 escalation guard, golden-set coverage of all 4 tools). **LIVE tests** opt in via `RUN_GROUNDING_EVAL=1 + DEEPSEEK_API_KEY`; otherwise skipped (so we never accidentally burn budget in CI). 15 golden rows covering committed-dish (ramen/sushi/tempura/udon), browse (inspire/surprise/not-sure), tool discovery (knife/fish-knife), editorial honesty (Henckels/Wüsthof off-catalog), ambiguous, library-pairing, and the "sharpen this" general-advice drift. Per-row tests + a distribution test that asserts ≥80% Tier-2, ≤20% Tier-3, ≤5% Tier-4 across the set.
- New `src/tests/telemetry.test.ts` (7 cases) and `src/tests/api/chat-telemetry.test.ts` (2 cases) covering counter advance, percentile correctness, ring-buffer cap, recent-validation-reasons tally, and route shape.

Full suite **370 passing + 15 skipped** (the live grounding rows) · typecheck clean · lint clean (6 preexisting warnings, none from these changes) · build green.

A/B running the grounding eval is now one env-var flip apart:
```
RUN_GROUNDING_EVAL=1 AI_PRIMARY_PROVIDER=deepseek  npx jest grounding
RUN_GROUNDING_EVAL=1 AI_PRIMARY_PROVIDER=anthropic npx jest grounding
```

Updated [[tiered-ai-architecture]] with the telemetry + eval-harness bullets under Phase 1. Remaining Phase 1 work: 1b.2 (SSE streaming, requires Preview verification) and 1d (cleanup of `<products>`-tag remnants).

## [2026-05-21] feat | Phase 1b.2 SSE streaming shipped (code only — Preview verification pending)

The tiered AI now streams. `/api/chat` returns SSE when the client sends `Accept: text/event-stream`; the blocking JSON path is preserved for test mocks and non-SSE callers. Code lands, full check pipeline green; **rendered-surface verification via Preview MCP is held pending the user's approval per CLAUDE.md ASK-FIRST rule.**

Wire format — SSE event sequence on a normal happy-path turn:
- `event: open` — `{ sessionId, primary }`. Lets the client know the server is processing.
- `event: delta` — `{ text }`. One per text chunk from the streaming primary call. Many of these.
- `event: final` — the structured envelope `{ text, products, recipeId, intent, meta }`. Exactly one. UI replaces the streamed text with `final.text` (covers the rare Sonnet-regenerate correction case).
- `event: error` — `{ error, kind?, ... }`. Emitted instead of a 4xx if the orchestrator throws mid-stream (we've already committed to a 200 response by then). Client maps to scripted fallback.

Architectural pieces:
- **ChatProvider gained optional `callStream`** — orchestrator uses it when both `onTextDelta` is provided AND the chosen primary implements streaming. DeepSeek implements `callStream`; Anthropic doesn't yet (the Tier-1=anthropic swap still works, just blocking).
- **`callDeepSeekStreaming`** — OpenAI-compat SSE parser. Buffers partial frames across `reader.read()` boundaries; accumulates tool-call argument JSON by index across deltas (model emits args in pieces); normalises finish_reason; emits the same `length`-truncation WARN as the blocking variant.
- **`runOrchestrator` gained `onTextDelta`** — opt-in. Tier-3 (Haiku verifier) and Tier-4 (Sonnet regenerator) don't stream — they're internal correction paths fast enough that user-visible streaming isn't a meaningful UX win, and Anthropic streaming would be a bigger refactor for a 5%-of-turns benefit.
- **`/api/chat` SSE branch** — `ReadableStream<Uint8Array>` writer that pumps `delta` events as the orchestrator's `onTextDelta` fires, then a `final` event with the result of `buildEnvelope(result, messages)`. 15-second SSE comment heartbeats keep intermediate proxies from reaping the connection during slow tier escalations. `X-Accel-Buffering: no` defeats Nginx batching.
- **Envelope builder + telemetry helper extracted** — the post-processing (recipe inference, prose composition, dishGroup derivation, structured log line, telemetry recording) is now a pure function shared by both JSON and SSE paths. Identical structured payloads, only the wire format differs.
- **Store gained `appendToLastAssistantMessage` / `replaceLastAssistantMessage`** — the streaming buffer's UI lifecycle. `useChat` pushes an empty `{ role: 'assistant', content: '' }` placeholder before sending, appends deltas to it as they arrive, and replaces the content with the canonical final text.
- **Call sites simplified** — `EntrySection`, `StickyPrompt`, `ConversationSection` no longer call `addMessage({ role: 'assistant', ... })` after awaiting `sendMessage`. useChat owns the assistant-message lifecycle now. The response object is still returned for side-effect routing (showTasteGrid, intent setting).
- **`useChat` SSE consumer** — fetch with `Accept: text/event-stream`, ReadableStream reader, frame buffering, event parsing. Falls through to JSON if the server doesn't honor SSE (test mocks). On `error` event, falls back to scripted exactly like the JSON path.

Sonnet-regenerate UX caveat (documented honestly): when Tier-4 fires (~5% of turns), the streamed deltas show Tier-1's draft text, which then swaps to the Sonnet-corrected text when `final` arrives. Brief flash visible to the user. Acceptable for v1; can be smoothed later with a "pending" visual state on the bubble during validation.

Tests added (29 new):
- `src/tests/streaming.test.ts` (6): callDeepSeekStreaming SSE parser, tool-call accumulation, length-truncation, split-frame buffering, error-on-non-2xx, runOrchestrator routing through callStream when onTextDelta is present.
- `src/tests/api/chat-stream.test.ts` (4): SSE event sequence (open + delta + final), pre-flight 413 still returns JSON (not SSE), mid-stream error → streamed error event, no-Accept-header falls back to JSON.
- `src/tests/store.test.ts` (+4): appendToLastAssistantMessage, replaceLastAssistantMessage, no-op-on-user-message edges.

Pipeline: typecheck clean · lint clean (6 preexisting warnings, none from these changes) · 384 passing + 15 skipped · build green.

**Held**: rendered-surface verification via Preview MCP. The token-by-token rendering and the Tier-4 swap UX are the things only the eye can confirm — proposing the verification plan now and awaiting user approval before any browser session spins up.

## [2026-05-21] verify | Phase 1b.2 streaming — Preview MCP verification PASSED

User approved the Preview run + fix-anything-found. Three flows exercised against the dev server (DEEPSEEK + ANTHROPIC keys live), one JSON-fallback curl smoke. Zero issues, zero fixes needed.

- **Test A** (entry chip "I want to make ramen"): SSE response carried 43 `delta` events + 1 `final` event. Network response Content-Type was `text/event-stream`. The conversation bubble settled to the canonical text; recipe list filtered to Tonkotsu Ramen pinned as Editor's pick; product cards (Staub cocotte, mesh skimmer, ramen bowl set) appeared at end-of-turn. No console errors.
- **Test B** (entry chip "inspire me"): SSE stream produced "Let's find your cooking style first…" prose, then `final` event carried `meta.showTasteGrid=true`. Page transitioned to the taste-grid section; 6 style tiles rendered above the fold (scrollY=157, page height collapsed from 3032px to 1042px because discovery is hidden in the doubtful state). No console errors.
- **Test C** (sticky-bar reply "what knife should I use for ramen?"): sticky bar expanded to input on click, submission triggered SSE stream, assistant bubble filled with "For ramen, the Gyuto Chef's Knife 240mm is your best bet…", recipe list stayed filtered to ramen recipes. No console errors.
- **JSON fallback** (curl without `Accept: text/event-stream`): blocking JSON envelope returned correctly with `recipeId: vegetable-tempura`, `meta.dishGroup: tempura`, `meta.resolvedByTier: tier-2-validator`. The non-streaming path is intact.

`/api/chat/telemetry` after the live runs reported: 5 turns, 100% tier-2-validator (perfect distribution — DeepSeek-V4-Flash + the validator handled every prompt without escalation), p50 5130ms, p95 6341ms, 0 truncated-at-length events, 0 guardrail-disabled events. The structured log line in `.logs/ai.log` carried `primary=deepseek`, `approxInputTokens`, `approxOutputTokens`, `validationReasons=[]`, `finishReason=tool_calls` as designed.

Budget cost of verification: 4 DeepSeek requests + 2 warmup increments (one warmup × two providers). Both well under the paranoid daily caps.

Observations worth keeping:
- DeepSeek-V4-Flash streaming returns the first delta in ~200-400ms and completes a typical (~200-token) response in well under a second. For short responses the typewriter effect is barely perceptible; the win shows up on longer responses (>5s of streaming). This is an honest UX — for the kind of crisp answers MISE wants, instant arrival is feature, not bug.
- React batching means each `delta` doesn't necessarily produce its own paint, but the wire-level stream is correct and the user sees progressive text on slower responses. If we ever need to FORCE per-delta paints we'd add `flushSync` around `appendToLastAssistantMessage`; not warranted today.
- The Sonnet-regenerate-swap UX caveat wasn't observable in any of the 3 flows because all 5 prompts resolved at Tier-2. Future verification when Tier-4 fires (e.g., a deliberate off-catalog prompt with both keys live) can confirm the swap-on-final behavior; the test in `chat-stream.test.ts` already covers it at the wire level.

Phase 1b is now FULLY shipped. Remaining Phase 1 work is just 1d (cleanup of `<products>`-tag remnants), which is cosmetic.

## [2026-05-21] cleanup | Phase 1d — stale-docs sweep

Closing out Phase 1. The actual scope shrank from what the plan implied: the `<products>`-tag regex code is already gone (was stripped in the 2026-05-17 tiered cutover), and the legacy `live` branch in `/api/chat` is also gone. What was left was stale **documentation** still pointing at those removed paths.

- **`mise/README.md`** rewritten "Enabling real Claude AI (optional)" → "Enabling tiered AI (optional)". Now describes the DeepSeek + Anthropic tiered setup, env vars, SSE streaming, and the three cost-control layers (per-day budget, abuse mitigation, provider-side console caps). The `NEXT_PUBLIC_AI_MODE=live` instruction is gone. Tech-stack table updated: "AI (demo) / AI (live)" → "AI (default) — tiered with SSE / AI (fallback) — scripted". Project-structure tree mentions the new `lib/ai/` subtree and the `api/chat/{session,budget,telemetry}/` siblings. The disabled Vercel block was kept (commented) but its env-var lines updated.
- **`mise/src/tests/hooks/useChat.test.tsx`** — `describe('useChat (live mode)')` → `describe('useChat (tiered mode)')`, and `NEXT_PUBLIC_AI_MODE = 'live'` → `'tiered'`. The string `live` silently maps to tiered (per CLAUDE.md), so the test was still passing under the old name; it was just lying about what it exercised.
- **`wiki/entities/use-chat.md`** rewritten end-to-end. The page was from 2026-05-05 and claimed scripted was the default and live was a branch — both wrong post-tiered. New page describes: the streaming SSE consumer, the assistant-message lifecycle moved into useChat (Phase 1b.2), what call sites must NOT do (no manual `addMessage({role:'assistant'})` after `sendMessage`), and the auto-fallback contract. Also fixed the contract shape — old version said `{text, products?, showTasteGrid?}` missing `recipeId` and the entire `meta` envelope.

Tiny typecheck fix that surfaced from the test pipeline: `src/tests/api/chat.test.ts` and the new `chat-stream.test.ts` both declared `const mockRunOrchestrator` at module top, and TS treated them as scripts (no top-level imports) so they collided in the global namespace. Added `export {}` to both — the canonical empty-module trick.

Pipeline: typecheck clean · lint clean (6 preexisting warnings, none new) · 384 tests passing + 15 skipped · build green · no production code changed.

**Phase 1 is complete.** Five commits since `0dee669`:

```
0a00685  feat:     Phase 1a abuse mitigation
8198845  refactor: Phase 1b provider abstraction
335450d  feat:     Phase 1c telemetry + grounding eval
bb99834  feat:     Phase 1b.2 SSE streaming
6c23c66  docs:     Phase 1b.2 Preview verification passed
+1 imminent for this Phase 1d cleanup
```

Plan's full-scope item list for Phase 1 (`grounding rewrite + tiered + abuse + streaming + provider-abstraction + eval-harness + telemetry`) is now all shipped and verified. The next milestone is Phase 1.5 (taste-grid back-in-the-conversation — already done via `show_taste_grid` tool, verified again on 2026-05-21), and after that the larger Phase 2 ranker work.

## [2026-05-21] feat | Phase 2 deterministic ranker + context packet shipped

The orchestrator's Tier-0 step. Before any LLM call, a pure scoring function ranks every product and recipe against the user's taste signals + library + the conversation's mentioned dish. The top-12 products + top-8 recipes are rendered into a compact "personalisation hints" packet and prepended to the conversation as a user-role message BEFORE the user's actual prompt. The system prompt stays unchanged so the providers' prompt caches keep hitting on the (large, stable) catalog summary.

The formula (each component normalised to [0, 1], coefficients are the caps):
```
score = 40 × tasteAlignment + 30 × dishMatch + 20 × libraryAdjacency + 10 × editorialWeight
```

Pinned by a `RANKER_CAPS` constant and a regression test that asserts the sum is 100 so silent coefficient drift is impossible.

New files:
- `mise/src/lib/recommend/ranker.ts` — pure scoring. Per-component functions exposed (`tasteAlignmentForCategories`, `tasteAlignmentForRecipe`, `dishMatchForProduct`, `dishMatchForRecipe`, `libraryAdjacency`), top-level `scoreProduct` / `scoreRecipe`, and `rankProducts` / `rankRecipes` rank-and-take helpers with deterministic id-ASC tiebreak.
- `mise/src/lib/recommend/context-packet.ts` — renders the ranked top-K + signals + library hints into an LLM-friendly markdown-ish string. Empty string when there's no useful signal to carry, so the token cost is zero in the no-signals case.
- `mise/src/tests/recommend/ranker.test.ts` — 36 unit tests pinning every component, the coefficient contract, the rank-take + tiebreak behaviour.

Modified:
- `mise/src/lib/ai/orchestrator.ts` — `RunArgs` gained `userSignals` + `ownedAssetIds`. Tier-0 ranks all products + all recipes against the context, builds the packet, prepends as a user-role message when non-empty. Both the streaming and non-streaming primary calls (and the Tier-4 Sonnet regenerate) see the same `messagesForProvider`.
- `mise/src/app/api/chat/route.ts` — both branches (SSE + JSON) accept `userSignals` + `ownedAssetIds` from the body and forward.
- `mise/src/hooks/useChat.ts` — reads `tasteProfile.signals` + `library.ownedAssetIds` from the store at send-time (via `useIntentlyStore.getState()`, not closure, so it reflects the latest hydrated state) and includes them in the request body.

Auditability is the win that mattered most to me. Every recommendation now has a four-component breakdown: which signal contributed, how much, and why. The model's reasoning is still opaque; the ranker's isn't.

Scripted-ai integration deferred deliberately. The plan called for "reuse the same ranker from scripted-ai.ts so the demo path also improves." After the 2026-05-17 cutover, `scripted-ai.ts` is `@deprecated` and frozen — the file header explicitly says don't extend. The ranker module is built and importable from anywhere; if scripted ever gets resurrected, the ranker is sitting there ready. Scope-creep avoidance over redundancy. Decision documented in the new concept page.

Pipeline: typecheck clean · lint clean (6 pre-existing warnings, none new) · 420 passing + 15 skipped · build green · no UX-visible change unless the user has signals/library (which the demo flow accumulates naturally).

New concept page: [[deterministic-ranker]]. [[index]] updated.

Phase 2 is shipped. Next milestones per the plan are Phase 3 (persistence + conversion loop via Supabase `chat_messages` + `recommendation_events` tables) and Phase 4 (local M2 mode with the scripted ranker picking IDs + Ollama paraphrasing).

## [2026-05-22] feat | Phase 3 chat persistence foundation shipped

Every `/api/chat` turn now writes to an audit log. User message, assistant message (with `tool_calls` JSONB + `resolved_by_tier`), one `recommendation_events` row per tool call. The two new Supabase tables live behind the AccountStore interface so demo mode (localStorage) and Supabase mode share a single contract.

New:
- `mise/supabase/migrations/0003_chat_history.sql` — `chat_messages` + `recommendation_events` tables. Indexes match the access patterns: `(user_id, session_id, created_at)` for replay; `(user_id, created_at desc)` for browse; partial index on `clicked_at is not null` for the conversion-rate query. RLS designed (committed but commented) per the 0001 pattern; explicit `disable row level security` for v0.1.x matching 0002.
- AccountStore interface gained 4 methods + 4 record types: `appendChatMessage`, `listChatMessages`, `recordRecommendationEvent`, `listRecommendationEvents`. Implemented in both `account-store-local.ts` (new `mise.chat.v1` + `mise.rec-events.v1` keys) and `account-store-supabase.ts` (insert + select against the new tables). `clearAll()` wipes the new keys too.
- `mise/src/types/supabase.ts` — manually extended the generated Database types with the two new tables. Comment at the top says regenerate after applying migrations; until then this is the source of truth for the typed Supabase client.
- `/api/chat` route: `persistTurn()` helper writes user msg → assistant msg → N rec events after the orchestrator returns. **Fire-and-forget** (`void persistTurn(...)`) so persistence latency / failure doesn't delay the SSE close or 5xx the JSON response. WARN log on failure; user always gets their response.
- `useChat`: sends `userId: DEMO_USER_ID` in the request body. Route defaults to DEMO_USER_ID if absent so external callers (curl, future webhooks) still get attributed under a single bucket. v0.2 swaps for the real auth sub.

Tests added (14 new):
- `src/tests/account-store-local.test.ts` (+9): chat-message append/list with session scoping (oldest-first replay vs newest-first browse), rec-event append/list, asset_ids:[] for ask_clarifying / show_taste_grid, clearAll wipes the new keys.
- `src/tests/api/chat-persistence.test.ts` (5): persistTurn called with correct shape for the happy path, ask_clarifying produces a rec_event with empty asset_ids, persistence failure doesn't 5xx the response, userId defaults to DEMO_USER_ID when omitted.

Full pipeline: typecheck clean · lint clean (6 pre-existing warnings, none new) · 434 tests passing + 15 skipped · build green.

What's deliberately NOT in this phase:
- **Click / order conversion tracking.** Columns exist (`clicked_at`, `ordered_at`); the SQL is ready. UI side — calling `markRecommendationClicked` from ProductDetail click handler + `markRecommendationOrdered` from CheckoutSection — needs to thread the rec_event id through to the product card. Adds multiple UI surface touches. Deferred to Phase 3.5 so the foundation lands clean.
- **Session replay UI.** Data is there; surfacing it is Phase 3.5+.
- **RLS enforcement.** Designed in the migration, disabled today, flips on with auth in v0.2.

New concept page: [[chat-persistence]]. [[index]] updated.

## [2026-05-22] feat | Phase 3.5 conversion loop closed

The columns existed since 0003; this phase wires the UI to stamp them. Two new AccountStore methods + one new endpoint + two surgical client hookups.

`markRecommendationClicked(userId, sessionId, assetId)` — session-scoped. Picks the most recent un-stamped rec_event whose `asset_ids` contains the asset; no-op when the click came from the catalogue rather than a recommendation. The session scope matters: a click should attribute to the conversation that actually surfaced the asset, not an unrelated earlier session.

`markRecommendationOrdered(userId, assetIds[])` — crosses session boundaries. A user can order something they saw in a previous chat. For each asset id in the order, stamps the most recent un-stamped rec_event. Idempotent — already-stamped rows are left alone.

Wire:
- New `mise/src/lib/ai/client-session.ts` — module-level `activeSessionId` getter/setter. `useChat` publishes the warmed session id on resolution; the store reads it without creating an import cycle.
- `intently-store.ts` `selectAsset(asset)` — when a non-null asset is selected and an active session exists, fire `markRecommendationClicked`. Fire-and-forget.
- `CheckoutSection.tsx` — after `createOrder` succeeds, fire `markRecommendationOrdered` with the order's asset ids. Fire-and-forget so the celebration overlay doesn't wait on the write.

New endpoint `GET /api/chat/conversion` — aggregates per-tool conversion rates. Returns `{ totalEvents, totalClicked, totalOrdered, overallClickRatePct, overallOrderRatePct, perTool: [{ tool, events, clicked, ordered, clickRatePct, orderRatePct }] }`. Supports `?sinceMs=<ms>` for time-windowed queries. The aggregation is in-memory (list-then-bucket) — fine for v0.1.x demo; will swap to a server-side `select count(*) ... group by tool_name` push-down once event volume justifies it.

Tests added (13 new):
- `src/tests/account-store-local.test.ts` (+9): mark-clicked picks the most-recent matching event, session-scoped no-op on wrong session, doesn't re-stamp already-clicked rows; mark-ordered crosses sessions, idempotent on repeat, empty-array no-op, no-match no-op.
- `src/tests/api/chat-conversion.test.ts` (4): zero-state shape, per-tool bucket math (4 events / 3 clicked / 2 ordered → 75% click / 50% order), sinceMs window filter, 500 on store read failure.

Full pipeline: typecheck clean · lint clean (6 pre-existing warnings, none new) · 447 tests passing + 15 skipped · build green. `/api/chat/conversion` is now in the route table.

Try it locally:
```
1. npm run dev
2. send a few prompts so rec events accumulate
3. click some product cards in the discovery section
4. place a checkout
5. curl localhost:3000/api/chat/conversion | jq
```

Phase 1 → 3.5 is done. The data pipeline is end-to-end: every chat turn writes a transcript + rec events, every UI click + order stamps the corresponding rec_event, the conversion endpoint reads them back. Editorial-weight tuning loop is now data-driven instead of guesswork — once a few hundred events accumulate.

Remaining roadmap chunks:
- **Session replay UI** — `listChatMessages(userId, sessionId)` is wired; surfacing "your previous conversations" is the next discrete UI piece.
- **RLS enforcement** — designed in 0003, commented; flips on with auth in v0.2.
- **Phase 4** — local M2 mode (scripted ranker + Ollama paraphraser).

## [2026-05-22] fix | post-review fixes — systemAddendum + supabase-only docs + suggestion batch

Round of fixes from the Phase 2–3.5 self-review.

**Critical #4 — context packet attribution.** Previously the orchestrator prepended the ranker hints as a `role: 'user'` message before the user's actual prompt, so the model could mis-read editorial directives ("Avoid suggesting these...") as the user's words. Fixed by extending `ChatProvider` with an optional `systemAddendum?: string` and routing the packet through it. DeepSeek (OpenAI-compat) injects it as a second `role: 'system'` message after the cached one; Anthropic uses an array-shaped `system` field with two text blocks (the first marked `cache_control: ephemeral` so the prompt-prefix cache still hits the long stable block). `messagesForProvider` is gone — `args.messages` is sent verbatim. Two new regression tests in `streaming.test.ts` pin the wire shape (`first two messages must be role:system`, `user-role messages stay one`).

**Critical #1 + #2 — local-mode persistence.** `persistTurn` and `/api/chat/conversion` run server-side where `LocalAccountStore` can't reach `localStorage`; both silently no-op. Rather than fix (per user direction — local mode is being deprecated for new feature dev), documented the limitation explicitly: warning comments in both route files, a "Requires `NEXT_PUBLIC_DATA_MODE=supabase`" section in the [[chat-persistence]] concept page, updated `.env.example` notes.

**prodprep.md additions** for items that need attention before any auth/prod deployment:
- `/api/chat/conversion` is unauthenticated and accepts arbitrary `userId` in the query string. PII disclosure vector once real users land.
- `/api/chat` trusts `userId` from the request body. Will be replaced with the JWT's `sub` post-auth.
- `selectAsset` over-fires `markRecommendationClicked` from non-recommendation contexts (CartDrawer, AssetDetail cross-links). Session-scoped no-op keeps it correct but wasteful; add an optional `from` enum when polish-time comes.

**Suggestion batch:**
- `dishMatchForProduct` now guards underscore-only / single-char needles (was a vacuous-match risk).
- `PRODUCT_DEFAULT_EDITORIAL_WEIGHT` TODO clarifies the migration path when Product gains an `editorialWeight` field.
- `/api/chat/conversion` capped at 5000 rows (configurable via `?limit=`), reports `scanCapped: true` when hit. Now also breaks out `recommendationOnly: { events, clicked, ordered, clickRatePct, orderRatePct }` so `ask_clarifying` and `show_taste_grid` don't deflate the headline rate. `INFORMATIONAL_TOOLS` constant captures the split.
- Rec-event inserts in `persistTurn` now run via `Promise.all` instead of sequentially — N round-trips collapse into a single network burst on Supabase.
- New `__resetClientSessionForTesting()` helper on `client-session.ts` to mirror the abuse / telemetry reset pattern.
- Race-window comment on `markRecommendationClicked` (supabase) expanded with the inflated-count failure mode.

**False alarm:** `getAllProducts()` hoisting was suggested but the function returns a constant module-level array — there's no per-request cost to "hoist."

Skipped (deliberate trade-off, documented):
- Server-side test for `LocalAccountStore` no-op behavior — local mode is being deprecated for new feature work; not worth pinning behavior we're stepping away from.
- Single-query supabase batch for `markRecommendationOrdered` — needs an RPC; deferred until concurrency justifies it.
- Deterministic test clock — pragmatic flakiness mitigation only; not worth the test refactor.

Pipeline: typecheck clean · lint clean (6 pre-existing warnings, none new) · 449 tests passing + 15 skipped · build green.

Files: `src/lib/ai/providers/{types,deepseek,anthropic}.ts`, `src/lib/ai/orchestrator.ts`, `src/lib/recommend/context-packet.ts`, `src/lib/recommend/ranker.ts`, `src/lib/ai/client-session.ts`, `src/lib/account/account-store-supabase.ts`, `src/app/api/chat/route.ts`, `src/app/api/chat/conversion/route.ts`, `mise/.env.example`, `src/tests/streaming.test.ts`, `src/tests/api/chat-conversion.test.ts`. Wiki: `[[chat-persistence]]` updated; `prodprep.md` gained three entries.

## [2026-05-24] v0.2 auth land — magic-link Supabase Auth, RLS on, conversation memory

Branch `claude/auth-memory-v02`, 12 commits. Closes the v0.1.x "auth provider undecided" hole and turns RLS on for every user-scoped table.

- Picked Supabase Auth (magic-link only) over Clerk and roll-your-own. New ADR [[supabase-auth-over-clerk]] captures rationale + trigger conditions for revisit.
- Login surface: `/auth/login` → magic link → `/auth/callback` → first-signin `/account/welcome` → river. `useAuth()` hook is the single auth source; `getActiveUserId()` is the sync mirror non-React callers read.
- Replaced `DEMO_USER_ID` at 18 seams (11 store sites + useChat + 2 CheckoutSection + 2 server routes). Local mode preserves the demo flow exactly.
- `/api/chat` + `/api/chat/conversion` now server-extract `auth.uid()` from the session cookie in supabase mode; reject anonymous POSTs with 401. Closes the `prodprep.md:94-107` security TODOs.
- Conversation memory via the existing `chat_messages` table — no new schema. `/api/chat` fetches the user's last 10 messages from prior sessions, the orchestrator folds them into `systemAddendum` (per-user channel, outside the cached catalog prefix). New helper `buildPriorContextBlock` in `src/lib/ai/system-prompt.ts`.
- `/account` page: profile header + orders list + sign-out. Entry-hero personalization: "Welcome back, $name" / "Returning · Sign in" gated on supabase mode.
- localStorage → Supabase migration on first signin (`migrate-from-local.ts`), idempotent via `mise.migrated.v1` marker.
- Two new migrations: `0004_auth_v02.sql` (profile columns) + `0005_enable_rls.sql` (the security flip, wrapped in BEGIN/COMMIT after a partial-apply postmortem caught a non-atomic failure mode).
- Bug fix during verification: "Multiple GoTrueClient instances" warning silenced by giving the headless AccountStore client a unique `storageKey`.

Pipeline (post-Phase 9, pre-tests/docs): typecheck clean · lint clean (6 pre-existing warnings, none new) · 449 tests passing · build green. RLS verified end-to-end in dashboard (9/9 tables row_security=true; 9 policies).

Files: `src/lib/auth/{supabase-browser,supabase-server,active-user}.ts`, `src/hooks/useAuth.ts`, `src/middleware.ts`, `src/app/auth/login/{page,LoginForm}.tsx`, `src/app/auth/callback/route.ts`, `src/app/account/{page,AccountOrdersList,SignOutButton}.tsx`, `src/app/account/welcome/{page,WelcomeForm}.tsx`, `src/lib/account/{account-store,account-store-local,account-store-supabase,account-store-factory,migrate-from-local}.ts`, `src/store/intently-store.ts`, `src/hooks/useChat.ts`, `src/components/sections/{EntrySection,CheckoutSection}.tsx`, `src/lib/ai/{system-prompt,orchestrator}.ts`, `src/app/api/chat/{route,conversion/route}.ts`, `supabase/migrations/{0004_auth_v02,0005_enable_rls}.sql`, `docs/roadmap.md`. Wiki: new `[[supabase-auth-over-clerk]]`; `[[index]]` updated.

## [2026-05-24] feat | entry-hero redesign + chip-entry-strategy Phase 1

Branch `claude/hopeful-margulis-400c4e`. Two interleaved threads:

**Entry hero redesign.** Stripped to wordmark + headline + input; subhead dropped. Wordmark dot is now `mise-moss`. Headline switched from `font-display` (Cormorant 4xl/5xl, ink) to `font-sans` (Inter, text-2xl/3xl, light, slate) — quieter, less editorial-magazine. System font swapped DM Sans → Inter (`src/app/layout.tsx`). First-paint reveal: dot → "mise" → headline → input over ~720ms, easing per [[design.md § Motion & scroll]]. Placeholder muted (`placeholder:text-mise-stone placeholder:italic placeholder:text-sm`) so it can't be confused for real text. Defensive focus styling against UA outline rendering as a square (`appearance-none focus:rounded-2xl focus:ring-0`). Chip cascade absolutely positioned below input so revealing chips never shifts the input position.

**Chip-entry-strategy Phase 1.** New [[chip-entry-strategy]] page captures the full pattern. 25-chip pool in `src/lib/chips/pool.ts` (1 anchor + 24 across cookTonight/tools/flavor buckets); per-session deterministic sampling in `src/lib/chips/select.ts`; sessionStorage UUID seed in `src/lib/chips/session.ts`; fire-and-forget impression + click logging in `src/lib/chips/track.ts`. Two-table schema in `mise/supabase/migrations/0006_chip_events.sql`: `chip_events` (signed-in, RLS by user_id) + `chip_events_anon` (anon, insert-only-for-anon, service-role for reads). EntrySection wires it all together — anchor at slot 0, three stratified samples at slots 1-3, immediate cascade for signed-in / returning users, 5s idle threshold otherwise with 2s gaps. roadmap.md gained a new § Analytics section (chip CTR is the seed; section gathers analytics topics across MISE).

Pipeline: typecheck clean · lint clean (no new warnings) · 469 tests passing + 15 skipped. Migration is committed but not yet applied to live Supabase. supabase.ts types are hand-added; regenerate after `apply_migration`.

Files: `src/components/sections/EntrySection.tsx`, `src/app/layout.tsx`, `src/lib/chips/{pool,select,session,track}.ts`, `src/types/supabase.ts`, `supabase/migrations/0006_chip_events.sql`, `src/tests/chips.test.ts`, `src/tests/components/EntrySection.test.tsx`, `docs/roadmap.md`. Wiki: new `[[chip-entry-strategy]]`; `[[index]]` updated.

## [2026-05-24] feat | chip-entry-strategy Phase 2 — CTR dashboard

Server-rendered analytics page at `/admin/analytics/chips`. Renders per-source (anonymous vs signed-in) impression / click / CTR tables with a date range selector (24h, 7d, 30d, 90d, all-time). Status indicator per row cross-references the current chip pool — retired chips with historical data stay visible alongside in-pool chips.

- New service-role Supabase client in `src/lib/auth/supabase-service.ts`. Required because `chip_events_anon` has no SELECT policy for anon/authenticated — analytics reads bypass RLS via service role. Env var: `SUPABASE_SERVICE_ROLE_KEY` (no NEXT_PUBLIC_ prefix — never inlined to browser bundle).
- Aggregation split into a pure function (`aggregateChipEvents`) and a thin fetch wrapper (`fetchChipAnalytics`) in `src/lib/chips/analytics.ts` so the math is independently testable. 9 unit tests cover count, CTR rounding, sort order, ties, defensive handling of orphan clicks and unknown event types.
- Auth gate: any signed-in user. The dashboard URL isn't linked from anywhere; admin allowlist deferred until non-admin signed-in users land.
- Local mode renders a friendly "not available — set NEXT_PUBLIC_DATA_MODE=supabase" notice instead of a stack trace.
- Wiki [[chip-entry-strategy]] phasing table updated; mise/docs/roadmap.md § Analytics updated to reflect Phase 2 shipped.

Pipeline: typecheck clean · lint clean (no new warnings) · 482 tests passing + 15 skipped.

Files: `src/lib/auth/supabase-service.ts`, `src/lib/chips/analytics.ts`, `src/app/admin/analytics/chips/page.tsx`, `src/tests/chips-analytics.test.ts`, `docs/roadmap.md`. Wiki: `[[chip-entry-strategy]]` Phase 2 section appended.

## [2026-05-25] fix | AccountStore browser client missing auth context (taste_signals 42501)

Browser AccountStore was using the headless `@supabase/supabase-js` anon-key client (no cookies), so `auth.uid()` resolved to NULL on every PostgREST call. After `0005_enable_rls` shipped (2026-05-24), every user-scoped write was rejected — `taste_signals` was the loudest because the grid click fires a write immediately. Postgres logs confirmed three matching `42501` errors in the minutes before the report.

Fix: in `src/lib/account/account-store-factory.ts`, the browser branch reuses the existing `getSupabaseBrowser()` singleton (same client `useAuth` uses). One auth-aware client per page = cookies flow + no GoTrueClient instance collision. Server branch unchanged (still headless anon-key — server-side `/api/chat` writes against user-scoped tables remain latent until they're routed through service-role or per-request auth-aware server clients).

Captured the rule + the trap in new concept page [[account-store-auth-aware-client]] so this can't drift back.

Files: `src/lib/account/account-store-factory.ts`. Wiki: new concept page `[[account-store-auth-aware-client]]`, indexed.

Pipeline: typecheck clean · lint clean (no new warnings) · 482 tests passing + 15 skipped.

## [2026-05-25] update | admin panel Phase 0 + 1a — allowlist gate, shell, recommendation conversion analytics

Extended the admin surface beyond the standalone `/admin/analytics/chips` page (shipped 2026-05-24). Two phases of the admin-panel plan landed together: the foundation (gate + shell) and the first new analytics surface.

**Phase 0 — Shell + gate**
- New `src/lib/auth/admin-allowlist.ts` (pure helpers: `parseAdminUserIds`, `isLocalDataMode`, `isAdminGateEnabled`, `isAdminUserId`).
- New `src/lib/auth/admin-guard.ts` (server-only `requireAdmin()` → throws `notFound()` 404 not 403; `assertAdminApi()` for route handlers).
- New `src/app/admin/layout.tsx` (gate + wordmark + nav with planned-but-unbuilt sections rendered as dimmed text).
- New `src/app/admin/page.tsx` (dashboard landing with status cards per surface).
- New `src/components/admin/RangePicker.tsx` (extracted from chips/page.tsx — `RANGES`, `sinceFor`, `parseRange`, `<RangePicker>`).
- Chips page refactored to use the shared shell + range picker; stale gate-trigger header comment replaced with pointer to `admin-allowlist.ts`.
- `.env.example` documents `ADMIN_USER_IDS` and `ADMIN_AUTH_ENABLED` (default off — matches gateless dev disposition; flip true once SMTP via Resend lands).
- `prodprep.md` records the "set `ADMIN_AUTH_ENABLED=true` before any public deploy" guardrail.

**Phase 1a — Recommendation conversion analytics**
- New `src/lib/recommendations/analytics.ts` (pure `aggregateRecommendationEvents` + thin `fetchRecommendationAnalytics` wrapper).
- Any-touch attribution: per-row `clicked_at`/`ordered_at` credit every asset in the event's `asset_ids[]`. Caveat documented in module header and surfaced in the page subheader.
- New `src/app/admin/analytics/conversion/page.tsx` — two tables (Products / Recipes), display names via `getProductById`/`getRecipeById`, range picker, local-mode notice.
- Nav + landing wired (Conversion now linked + status flipped to shipped).

**Wiki**
- New [[admin-zones]] concept page — MISE/Medusa partition governing every admin surface. Cross-linked from [[index]].

Auth model decision (env-var allowlist over `is_admin` column) recorded in [[admin-zones]] + already in `docs/roadmap.md` polish queue.

Pipeline: typecheck clean · lint clean (no new warnings) · 51 suites / 514 passing + 15 skipped · build clean. New routes: `○ /admin` · `ƒ /admin/analytics/conversion`.

Files (new): `src/lib/auth/{admin-allowlist,admin-guard}.ts`, `src/app/admin/{layout,page}.tsx`, `src/components/admin/RangePicker.tsx`, `src/lib/recommendations/analytics.ts`, `src/app/admin/analytics/conversion/page.tsx`, `src/tests/{admin-allowlist,recommendation-analytics}.test.ts`. Files (modified): `src/app/admin/analytics/chips/page.tsx`, `.env.example`, `prodprep.md`. Wiki: new `concepts/admin-zones.md` + `index.md` link.

## [2026-05-25] update | admin panel Phase 1c + 1b — AI tier telemetry, session funnel, dev:localsetup

Phase 1 of the admin panel is now feature-complete (chips already shipped 2026-05-24; conversion shipped earlier today; AI tiers and sessions land here). Phase 2 (campaigns) is next.

**Phase 1c — AI tier telemetry**
- New migration `0007_ai_telemetry_events.sql` — durable backing for the in-memory ring in `src/lib/ai/telemetry.ts`. Applied to live Supabase via MCP. Service-role-only access (no anon/authenticated policies — even INSERTs go through service_role; we don't want forged tier-1 rows from the browser).
- Generated column `truncated_at_length` derived from `finish_reason = 'length'` so the dashboard doesn't have to filter at read time.
- `src/lib/ai/telemetry.ts` now fires fire-and-forget `writeTelemetryEvent` after every `recordTurn`. Failures warn-log; never block the response. The in-memory ring remains the hot cache + backstop.
- New `src/lib/ai-telemetry/analytics.ts` (pure `aggregateAiTelemetry` + service-role fetch wrapper). 10 unit tests. Unknown tier values bucket under `'unknown'` rather than throwing — a future fifth tier won't blow up the dashboard.
- New `/admin/analytics/ai` — tier distribution table with on-target/warning highlights from the healthy-distribution thresholds (≥80% validator, ≤20% haiku, ≤5% sonnet), latency card (p50/p95/p99), flags card (guardrail-disabled, truncated-at-length), top-10 validation reasons.
- Regenerated `src/types/supabase.ts` to include the new table.

**Phase 1b — Session funnel**
- New `src/lib/sessions/analytics.ts` (pure `aggregateSessionFunnel` + 4-table service-role fetch). 11 unit tests.
- Funnel stages: entry (chip session) → first-input → conversation (≥2 user msgs) → discovery → click → order.
- **Documented the chip-session vs chat-session namespace caveat** as a first-class field on every stage (`crossesNamespace`) and surfaced in the page subheader. Sessions in `chip_events*` and `chat_messages` use different IDs; cross-stage "% of entry" is an estimate, not deterministic per-session retention.
- New `/admin/analytics/sessions` — funnel table with sessions, step retention, cross-namespace warning glyph, simple bar visual.

**dev:localsetup**
- New `scripts/dev-localsetup.sh` + `npm run dev:localsetup`. Sources `~/.zshenv` defensively, fills gaps from `.env.local`, asserts the four required keys (DEEPSEEK + 3× Supabase), warns if Anthropic absent, forces `NEXT_PUBLIC_DATA_MODE=supabase` + `NEXT_PUBLIC_AI_MODE=tiered`, runs the service-role sanity check, then `exec`s `next dev -p 3000`. One-command "live everything on localhost" entry point.

**Admin nav + landing**
- Nav links enabled for `/admin/analytics/sessions` and `/admin/analytics/ai`.
- Landing cards for both flipped to `status: 'shipped'`.

**Verification**
- typecheck clean · lint clean (no new warnings) · 53 suites / 535 passing + 15 skipped · build clean. New routes: `ƒ /admin/analytics/ai` and `ƒ /admin/analytics/sessions`.
- Migration applied via Supabase MCP `apply_migration` — verified table exists with all columns + RLS enabled + zero anon policies.

Files (new): `supabase/migrations/0007_ai_telemetry_events.sql`, `src/lib/ai-telemetry/analytics.ts`, `src/lib/sessions/analytics.ts`, `src/app/admin/analytics/{ai,sessions}/page.tsx`, `src/tests/{ai-telemetry,sessions}-analytics.test.ts`, `scripts/dev-localsetup.sh`. Files (modified): `src/lib/ai/telemetry.ts`, `src/types/supabase.ts`, `src/app/admin/{layout,page}.tsx`, `package.json`.

## [2026-05-25] update | admin panel Phase 2 — campaigns (editorial banners + AI prompt-bias)

Phase 2 of the admin-panel plan. Two new tables, one discriminated union, three integration points. All MISE-zone — Medusa-zone surfaces (discounts, promo codes) explicitly deferred per [[admin-zones]].

**Schema**
- Migration `0008_campaigns.sql` — single table for both campaign types. RLS permits anon SELECT on currently-active rows only (so SSR / `/api/chat` can read without elevation); admin CRUD goes through service_role. Filtered index on `(active_from, active_until) WHERE status = 'active'` keeps the active-fetch hot path tiny. updated_at trigger so callers don't have to pass it.
- Migration `0009_admin_audit_log.sql` — append-only generic audit table (`action / target_table / target_id / payload`). Service-role-only access. Future write surfaces (PIM authoring, allowlist promotion) plug in via the action namespace without schema changes.
- Both applied to live Supabase via MCP `apply_migration`.

**Lib** — `src/lib/campaigns/`
- `types.ts`: discriminated union `Campaign = BannerCampaign | PromptBiasCampaign`. `campaignFromRow(row)` is the only place jsonb → union narrowing happens; defensive on unknown type/status/payload shape (returns `null`). `mergePromptBiasCampaigns()` collapses multiple active prompt-bias campaigns into one `{ systemAddendum, rankerBoosts }`.
- `active-resolver.ts`: `unstable_cache` (60s TTL, tag `campaigns:active`) fronts a single service-role fetch. `getActiveBannerCampaign(surface)` picks most-recent `activeFrom` when multiple overlap; `getActivePromptBiasCampaigns()` returns all. Mutations invalidate via `updateTag` (Next 16's single-arg replacement for `revalidateTag(tag, profile)`).
- `store.ts`: service-role CRUD. Every mutation writes audit log + busts cache.
- `src/lib/admin/audit-log.ts`: generic append-only writer. Fire-and-forget — never blocks the underlying admin action.

**Integration: Entry banner**
- `src/app/page.tsx` is now async, awaits `getActiveBannerCampaign('entry_hero')`, passes optional `bannerOverride` prop to `EntrySection`.
- Headline priority: banner override > personalised "Welcome back, X." > default. Editorial intent wins because that's the entire point of running a campaign.
- Subheading renders below headline with adjusted margins so distance-to-input stays constant. CTA fields accepted in the type but **not rendered in v1** — don't disturb the just-shipped entry-hero redesign without explicit editorial demand.

**Integration: tiered AI**
- `/api/chat/route.ts` calls `getActivePromptBiasCampaigns()` once per request (non-fatal; failures warn-log + skip), merges, passes through to both streaming and blocking `runOrchestrator` calls.
- `orchestrator.ts` gains two `RunArgs` fields: `campaignAddendum` (folded into existing `systemAddendum` channel alongside `buildPriorContextBlock`; cached system prefix stays intact) and `campaignBoosts` (passed to `RankContext`).
- Addendum is wrapped with literal `--- Active editorial campaigns ---` header so the model can identify it.

**Integration: deterministic ranker**
- `src/lib/recommend/ranker.ts` gains a fifth scoring component: `RANKER_CAPS.campaignBoost = 15`. Deliberately smaller than `tasteAlignment` (40) — campaigns can flip a tie / surface a candidate but **can't override a clear taste signal**.
- v1 boost is id-list membership only (`+15` when `product.id ∈ campaignBoosts.productIds`). Tags are accepted in the type for forward-compat but silently ignored.
- Existing `ranker.test.ts` invariant "sum of caps = 100" updated to "BASE components sum to 100" + explicit pin that `campaignBoost = 15` is additive.

**Admin UI** — `/admin/campaigns/`
- `page.tsx`: list view with type chip + status chip + window. + New button to create.
- `new/page.tsx`: type picker → conditional form (banner: surface + heading + subheading; prompt-bias: addendum + id-list boosts).
- `[id]/page.tsx`: edit + status toggle via `StatusBar`. Type fixed at create time (no banner → prompt-bias migration).
- `CampaignForm` shared between create/edit; `actions.ts` translates FormData → typed input → store call. Light client-side validation; DB CHECK constraints catch the malformed cases.

**Tests** — 25 new passing
- `campaigns-types.test.ts` (17): row parsing, union narrowing, merge dedup.
- `ranker-boosts.test.ts` (8): boost magnitude, taste-signal override safety, tie-flipping, no-op on missing boosts.

**Wiki** — new [[campaigns]] entity page. Linked from this log.

**Verification**: typecheck clean · lint clean (0 errors, 7 pre-existing warnings unchanged) · 55 suites / 560 tests passing (+25) · build clean. New routes: `ƒ /admin/campaigns`, `ƒ /admin/campaigns/[id]`, `ƒ /admin/campaigns/new`. The home route `/` is now `Revalidate 1m` (the cached banner fetch — by design).

Files (new): `supabase/migrations/000{8,9}_*.sql`, `src/lib/campaigns/{types,active-resolver,store}.ts`, `src/lib/admin/audit-log.ts`, `src/app/admin/campaigns/{page,new/page,[id]/page,actions,CampaignForm,StatusBar}.tsx`, `src/tests/{campaigns-types,ranker-boosts}.test.ts`, `wiki/entities/campaigns.md`. Files (modified): `src/lib/recommend/ranker.ts`, `src/lib/ai/orchestrator.ts`, `src/app/api/chat/route.ts`, `src/components/sections/EntrySection.tsx`, `src/app/page.tsx`, `src/app/admin/{layout,page}.tsx`, `src/types/supabase.ts`, `src/tests/recommend/ranker.test.ts`.

## [2026-05-25] update | admin panel Phase 3 + 4 — user inspector, read-only PIM, operator guide, PIM strategy proposal

Three threads land together: the user inspector (Phase 3), the read-only PIM viewer (Phase 4 minimum), and the wiki documentation an operator can actually navigate by.

**Phase 3 — User inspector (read-only)**
- New `src/lib/admin/user-reader.ts` — narrow service-role accessors for each tab (profile / taste signals / library / orders / chat / rec events / chip events). Deliberately separate from `AccountStore` whose contract is user-scoped (calling user reading their own data); admin reads other users' data on behalf of an admin, so the boundary stays clean.
- New `/admin/users` — paginated list (50/page), search by email / display_name / id with PostgREST `or` ilike across all three. Click row → `/admin/users/[id]`.
- New `/admin/users/[id]` — six panels load in parallel (`Promise.all` against the user-reader). Each panel caps at 200 rows. Chat messages render grouped by role (assistant rows in moss-tinted background). Tier resolution shown when present.
- **Strict invariant** encoded throughout: no write helpers exist in user-reader.ts; no edit affordances render in the UI. The only admin write touching users (allowlist promotion) is an env-var change, not a UI action — deliberate guard against fat-finger.

**Phase 4 (minimum) — Read-only PIM viewer**
- New `/admin/pim/products` — searchable card grid over `getAllProducts()`. Image + name + id + price + tagline + categories. 32 products today.
- New `/admin/pim/products/[id]` — full attribute display: tagline, why-it-matters, categories, tags, pairs-with, included-with, attributes, policies, intent. Image preview + alt-text + image URL inspection. Raw JSON dump at the bottom for forward-compat with attribute additions.
- New `/admin/pim/recipes` + `/admin/pim/recipes/[id]` — same shape applied to `getAllRecipes()`. Card grid → detail with cuisine / dish-type / style / servings / timing / skill / effort / editorial weight + ingredients + steps + image references + raw JSON.
- Both PIM surfaces read from the runtime catalogue (`getAllProducts` / `getAllRecipes`) so what the admin sees IS what the AI sees. No DB queries, no separate cache, safe in all futures.

**Wiki**
- New [[admin-panel-guide]] — operator how-to: gate setup (`ADMIN_USER_IDS` + `ADMIN_AUTH_ENABLED`), every page's purpose, common workflows ("launch a spring banner", "bias the AI toward knives", "audit who changed what"), production hardening checklist. Distinct from [[admin-zones]] which is architecture/decisions.
- New [[pim-strategy]] (draft decision) — argues for **products → Medusa, recipes → MISE forever**. Three options compared (MISE editor with DB source-of-truth flip; MISE editor with `data.ts` round-trip; Medusa adoption). Recommended: Option C + recipe editor in MISE. Read-only PIM viewer ships today regardless because it's safe in all futures.
- [[index]] updated with both new pages.

**Verification**
- typecheck clean
- lint clean (no new warnings; 7 pre-existing unchanged)
- 55 suites / 560 tests passing (no test additions this phase — read-only surfaces over typed catalogue / typed DB reads; no aggregator pure logic to test)
- production build clean
- new routes: `ƒ /admin/users`, `ƒ /admin/users/[id]`, `ƒ /admin/pim/products`, `ƒ /admin/pim/products/[id]`, `ƒ /admin/pim/recipes`, `ƒ /admin/pim/recipes/[id]`

**Open decision pending operator call**
The PIM strategy doc is `status: draft`. Operator picks the path (products → Medusa + recipes in MISE recommended, vs tactical MISE editor for products with `data.ts` round-trip, vs full DB-flip MISE editor). Once chosen, the page promotes to `stable` with a dated rationale header and [[admin-zones]] updates to reflect the call.

Files (new): `src/lib/admin/user-reader.ts`, `src/app/admin/users/{page,[id]/page}.tsx`, `src/app/admin/pim/{products,recipes}/{page,[id]/page}.tsx`, `wiki/concepts/admin-panel-guide.md`, `wiki/decisions/pim-strategy.md`. Files (modified): `src/app/admin/{layout,page}.tsx`, `wiki/index.md`.

## [2026-05-25] decide+ship | PIM strategy ratified; recipe editor lands

Two threads close out the admin-panel arc: the PIM strategy decision is ratified (Option C — Medusa for products + recipe editor in MISE forever), and the recipe editor implementation lands as a first-class authoring surface.

**PIM strategy decision (ratified 2026-05-25)**
- [[pim-strategy]] promoted from draft → stable with the dated rationale header. Products go to Medusa when adopted; recipes stay in MISE forever. No MISE product editor will be built (Options A and B explicitly rejected).
- [[admin-zones]] updated with the resolved PIM split.
- [[supabase-over-medusa]] updated with an "Update 2026-05-25 — adoption decision" section noting the trigger fired early (operator pain became "edit products without code commits" before the variants/inventory/payments thresholds were met).
- During the Medusa migration window: product edits stay in `src/lib/data.ts` with `/admin/pim/products` as the visibility surface. Medusa adoption is tracked as a separate, larger milestone.

**Recipe editor — Phase 4 first authoring slice**
- New `src/lib/admin/recipe-writer.ts` — two-target write: Supabase `recipes` mirror upsert + source-of-truth JSON seed file rewrite (`src/lib/recipes/data/<id>.json`). Audit log entry per edit.
- Localhost-only by design: the seed file is canonical (runtime `getAllRecipes()` reads it at module init), so the fs write needs a writeable filesystem. Vercel's read-only runtime fs returns a structured error rather than crashing.
- Path-traversal guard on the file path: id must match `[a-z0-9][a-z0-9-]*` AND the resolved path must stay under `SEED_DIR`. Defends against malformed ids reaching `fs.writeFile`.
- New `src/lib/admin/recipe-form-merge.ts` — pure form-data → Recipe merge. Critical: the only place "which fields are editable vs which pass through" is decided. Defensive on JSON array parsing (collects errors AND preserves original values so partial failure doesn't lose data). 11 unit tests covering scalars, enums (unknown → fallback), JSON validation, hero-image clear (empty → null), badge clear, and non-edited-field preservation.
- New `/admin/pim/recipes/[id]/edit` — full authoring form: title, summary, description, locale, taxonomy (cuisine / dishType / primaryStyle), serving+competence (servings / total+active minutes / skill / effort / editorial weight), images (thumb + hero URL + alt with live preview tiles), badge JSON, ingredients/steps/tools as JSON textareas with row counts sized to content.
- Server action in `actions.ts` runs `requireAdmin()`, merges, validates, saves, revalidates the three affected paths, redirects back to the read-only view.
- Edit button added to `/admin/pim/recipes/[id]`.

**Verification**
- typecheck clean
- lint clean (no new warnings; 7 pre-existing unchanged)
- 56 suites / 571 tests passing (+11 from `recipe-form-merge.test.ts`)
- production build clean
- new route: `ƒ /admin/pim/recipes/[id]/edit`

**What's next (queued, not started)**
- Medusa adoption — separate, larger milestone. Spec + estimate + execute as its own project, not part of the admin-panel plan.
- Recipe editor enhancements: richer ingredient / step editors (replacing JSON textareas), draft/published lifecycle (status field is currently locked to `'published'` in the type), image upload (Supabase Storage).

Files (new): `src/lib/admin/{recipe-writer,recipe-form-merge}.ts`, `src/app/admin/pim/recipes/[id]/edit/{page,actions}.ts(x)`, `src/tests/recipe-form-merge.test.ts`. Files (modified): `src/app/admin/pim/recipes/[id]/page.tsx` (edit-button), `wiki/decisions/{pim-strategy,supabase-over-medusa}.md`, `wiki/concepts/admin-zones.md`, `wiki/index.md`.

## [2026-05-25] feat | recipe editor v2 + "cooking a recipe" roadmap + Medusa handoff

Three threads close out today's admin work: the recipe editor moves from JSON-textarea v1 to structured-row v2, the "guided cooking" vision lands in the roadmap as the long-term diamond, and a self-contained Medusa-adoption handoff doc is ready for the next session.

**Recipe editor v2**
- `RecipeStep` gains optional `imageUrl` + `imageAlt` (schema-additive). `Recipe` gains optional `videoUrl` + `videoTitle`. Both backward-compatible — existing seed JSON stays valid.
- Three client-side array editors replacing the v1 JSON textareas: `IngredientsEditor`, `StepsEditor`, `ToolsEditor`. Each manages local state, renders structured rows with up/down/delete controls, and serialises to a hidden JSON input — so the server action + `mergeRecipeFromForm` see the exact same shape they did under v1. Position fields auto-derived from row order on serialise so operators don't see or type them.
- Per-step image fields (URL + alt with live preview tile) inside `StepsEditor`. Tied explicitly to the future guided-cooking surface in the field label.
- Top-level video URL + title section on the edit form; blank-clears, omitted-preserves.
- Read-only recipe view rewritten: ingredients render as a typed list (position · name · qty unit · note · optional flag), steps render as a numbered list with title / text / duration / tools / tip / image figure, video section shows the URL + title with a "placeholder — not embedded today" note pointing at the roadmap entry.

**Roadmap — "Cooking a recipe" guided surface (v0.3+)**
- New subsection under [[#My Kitchen (the future user-facing surface)]] in `docs/roadmap.md`.
- Captures the long-term vision: mobile/tablet-first, step-by-step guidance with per-step images, inline timers per step, recipe video reference, ingredient checklist, per-cook notes, tool surfacing (with buy-the-tool moment), done flow with rating + share + photo.
- Explicit "what to avoid" section: don't build desktop-first, don't conflate with `/recipes/[id]`, don't ship without wake-lock + reliable timers, don't try to be smart-kitchen IoT on day one.
- Data layer is mostly in place already (library_items, steps with images, video placeholder) — the work is mostly the UI route + state machine + timer reliability.

**Medusa handoff doc**
- New `mise/docs/medusa-handoff.md` — self-contained for a cold-start session.
- Covers: TL;DR, recommended reading order, current data-source map, target architecture diagram, the sync-layer design (the hard part), seven open questions to resolve in the spec, eight migration phases (A–H) with concrete steps, what NOT to do, success criteria.
- Closes with branch hygiene, escalation path (operator owns the architecture decisions), and a recap.

**Verification**
- typecheck clean
- lint clean (no new warnings; 7 pre-existing unchanged)
- 56 suites / 571 tests passing — `recipe-form-merge.test.ts` still passes against the v2 form (the editors produce the same JSON shape, so the merge layer didn't need changes beyond the new videoUrl/videoTitle fields)
- production build clean

Files (new): `src/app/admin/pim/recipes/[id]/edit/{IngredientsEditor,StepsEditor,ToolsEditor}.tsx`, `docs/medusa-handoff.md`. Files (modified): `src/types/index.ts` (step image + recipe video fields), `src/lib/admin/recipe-form-merge.ts` (video field merge), `src/app/admin/pim/recipes/[id]/edit/page.tsx` (structured editors + video section), `src/app/admin/pim/recipes/[id]/page.tsx` (typed ingredient + step rendering, video section), `docs/roadmap.md` (My Kitchen guided cooking).

## [2026-05-31] write | enrichment-layer concept page

Wrote [[enrichment-layer]] documenting how the enrichment layer works end-to-end:
the PIM → buildEmbedText → embedder → vector store → search pipeline, each box as
a swappable env-selected interface.

- Embedder: Xenova `all-MiniLM-L6-v2` (384-dim, local, no key) vs deterministic;
  documented the read-only-`env` reassignment crash fixed 2026-05-31.
- Vector store: LocalJSON (`.enrichment/`) vs Supabase pgvector (`0010`), incl. the
  `operator(extensions.<=>)` schema-qualification gotcha.
- PIM: the Medusa mock (`pim/`) + the new catalogue-aligned adapter (R5) that makes
  the inspector and the river share one product set / ids.
- The `DISCOVERY_RETRIEVAL=vector` seam: discovery seeds via the same `syncAll()`
  the inspector uses, then searches → maps ids → deterministic prefilter/explain.

Cross-linked to [[river-architecture]], [[supabase-over-medusa]], [[pim-strategy]],
[[deterministic-ranker]], [[tiered-ai-architecture]]. Added to index.md (Concepts).

## [2026-06-05] update | new /next overlay UX + themeable token system

Built a scripted, no-AI preview of the proposed successor to the river — an
embeddable adaptive contextual-discovery overlay — at the route `/next`
(`intently/src/app/next/`), and documented it.

- Wrote [[next-overlay-ux]]: the five moments re-framed for an overlay, the
  one-tree/two-layout IA (desktop rail + pinned canvas; mobile inline grids),
  the explained card (why-this as hero), the re-rank diff choreography
  (leave/stay/enter), the single response contract for scripted↔live parity,
  the dataset-honest scenario choice (hike + cold-evenings, not the plan's
  wedding dress — the webp bank is casual basics/outerwear), perf decisions,
  and the cart handoff (mock here vs the real shared-Medusa-cart embed).
- Wrote [[theming-tokens]]: CSS-custom-property theming scoped under
  `[data-intently-theme]`; signature vs themeable split; the separate
  comprehension accent (`--nx-chip-accent`) so a host can colour chips/diff
  independently of CTAs; worked "OG company inc" theme (orange CTAs + green
  comprehension layer, Fraunces/Space Grotesk, AA-safe orange #b5470a).
- Cross-linked both into [[river-architecture]] (Related) and added both to
  index.md (Concepts). Code review of /next applied perf fixes (input localised
  to the refine bar, memoised cards, single host backdrop) and confirmed the
  real storefront↔Intently cart round-trip is a shared cookie, not a sync.

## [2026-06-05] update | Enrichment Studio (merchandiser workspace + attribute provenance)

Built a PM-facing workspace over the enrichment layer at
`/admin/enrichment/studio` (non-destructive; classic inspector kept) and
documented it.

- Wrote [[enrichment-studio]]: the four PM questions (ready? weak? why not
  surfacing? what to change?) → pipeline ribbon + catalogue-health, product
  list with a derived enrichment-quality score, per-product anatomy
  (raw → enriched → embedText → vector), discovery preview (same searchByText
  the river uses, selected product flagged), and an embed-text what-if.
- Centrepiece for this session's question: **attribute provenance**. Made
  explicit that NO image analysis happens — every attribute is text-derived
  (pattern ← regex on the title; style/formality ← usage lookups; occasion ←
  rule set; fabric/silhouette ← left blank = vision-only). Cited
  `derive-attributes.ts` / `pim-to-product.ts`. Motivates the vision roadmap.
- Cross-linked into [[enrichment-layer]] (Related) and added to index.md
  (Concepts). Reuses the existing /api/enrichment/* reads; quality + provenance
  are pure client-side functions, no new persistence.

## [2026-06-05] feature + doc | vision enrichment v1 (image analysis)

Built the first version of image analysis for the enrichment layer and
documented it.

- `scripts/vision-enrich.mjs`: offline batch that sends each product photo to
  Claude Haiku 4.5 (DeepSeek has no vision API — honest deviation) and runs a
  Tier-0 validator over the JSON (clamp formality, intersect the 9-archetype +
  season vocab, flag corrections). Token-accounted.
- Ran full-scale on 10 real photos (with thin synthetic PIM stubs), reviewed,
  iterated the prompt (v2: full-range formality rubric, in-prompt controlled
  vocab, situational occasions, NEW discoveryQueries), re-ran the same 10.
- Wrote [[vision-enrichment]]: tiered design, where it runs, measured cost
  (~760 tok v1 / ~930 tok v2 ≈ $0.0018/product), and the v1→v2 findings —
  worked: discoveryQueries, vocab adherence, colour specificity, vision
  catching camo/stripe/graphic + materials the PIM lacked; didn't: formality
  stayed flat at 1, styles cluster. Honest scope: not yet wired to the live
  82-product discovery catalogue (different dataset / missing photos).
- Studio surface `/admin/enrichment/studio/vision` separates PIM-sourced vs
  vision-enriched context + discoveryQueries + cost; linked from the Studio.
- Cross-linked into [[enrichment-studio]] and [[enrichment-layer]]; added to
  index.md (Concepts). Not committed this round (per request: document + stop).

## [2026-06-07] feature + doc | real vision catalogue → live demo + solution overview

Unified the work onto one real, image-backed catalogue and made the consumer demo live.

- scripts/build-vision-catalog.mjs: projects the 292-photo vision run →
  committed src/lib/catalog/vision-catalog.json (river Product shape, real webp
  images, fabric+silhouette from vision, rich embeddingText). data.ts switches
  the whole app onto it with NEXT_PUBLIC_CATALOG=vision.
- Vector store seeded over the vision catalogue; DISCOVERY_RETRIEVAL=vector →
  semantic discovery ("a warm layer for a cold evening" → navy parka / hoodie).
- /next now calls real /api/discover (src/app/next/live.ts) with a scripted
  offline fallback — real photos, real situational matching, real explanations.
- Wrote [[demo-solution-overview]] (end-to-end, with screenshots in wiki/assets/
  + catalogue distribution charts + the runbook) and [[situation-match]] (the
  soft situation model). scripts/run-demo.sh boots the whole demo + prints URLs.
- Cross-linked + indexed. Honest scope: 292 vision catalogue replaces the Kaggle
  demo set; formalwear/winter gaps are real (a buying signal); personalization
  deferred per [[project-demo-first-phase]].

## 2026-06-09 — PM action loop (curate + needs-attention queue)
- Shipped the two missing halves of the merchandiser loop on the vision
  catalogue, both as non-destructive runtime overlays (mirrors
  situation-overrides): [[product-overrides]].
  - #1 Curate attributes in the Studio detail → Save & re-embed → before→after
    rank; reaches live /api/discover via the override-merge seams
    (pim adapter, retrieve.resolve, catalog/load).
  - #3 Needs-attention work queue (/admin/enrichment/studio/attention): Fix
    (deep-links into the curate editor) / Resolve / Dismiss; reasons recomputed
    over override-merged catalogue so a fix auto-leaves the open list.
- Fixed a stale Studio panel: attribute provenance is now **mode-aware**
  (vision → read from the photo by Claude Haiku; text fallback → text-derived),
  resolving the contradiction with the new fabric editor. Updated the
  [[enrichment-studio]] index entry accordingly.
- Wrote [[product-overrides]]; extended [[demo-solution-overview]] with the PM
  loop + a 5-minute test walkthrough + the attention-queue screenshot
  (wiki/assets/studio-attention-queue.png). run-demo.sh: added the attention
  URL + the curate hint, fixed the stale ?theme=og → NEXT_PUBLIC_THEME env var.
- Gotcha recorded: on the clean n=292 vision catalogue the discrete attention
  reasons match ~zero products; the queue is driven by the relative "weakest
  situation fit" lane.

## 2026-06-09 — Medusa storefront plugin + conversation handoff
- Booted the full old-vs-new demo: Medusa (Docker :9000, 292 products) +
  storefront (:8000) + Intently as the /discover plugin (:3000, basePath).
  Verified live: storefront "Shop by situation" → proxied Intently discovery
  over the SAME Medusa catalogue (real products + images), and "Add" → the
  storefront's SHARED Medusa cart (cookie). Intently keeps no cart of its own;
  checkout stays in the store. Cart button opens a product summary; "Review cart
  in store →" deep-links to /dk/cart.
- Demo refocus (separate pass): removed theming, the fake /next storefront, the
  classic enrichment inspector; admin nav → Studio + Analytics; catalogue
  "flight levels" → Overview/Coverage/Segments/Action list/Products.
- Wrote intently/docs/conversation-architecture.md — the handoff for refining the
  conversation: full text-in→text-out pipeline, the deterministic Tier-0 reality
  (no LLM in the live path), the AI tiers + where they'd plug in, the parameters,
  and a ranked list of refinement levers (the parser is #1).

## 2026-06-10 — personal-tailor consultation layer (+ eval harness)

- Built the ask-before-offer consultation on `feat/tailor-discovery`:
  `consult.ts` (info-gain-gated question bank, ≤2 blocking asks, mark-on-ask,
  concluding escapes), `voice.ts` (acknowledgment beats, curation framing,
  the honesty beat), `attributes.ts` (canonical preference tokens shared by
  taps, typed text, and the prefilter). Engine returns optional `question`;
  wired through river (pendingQuestion slice + pills) and `/next` overlay
  (TurnAsk pills, unified runTurn). 26 new tests; suite at 103.
- New wiki page: [[tailor-consultation]] — decisions (formality question
  rejected by info-gain math; structured patches over NL parsing; strictly
  forward-moving questions; honesty beat CONTESTED vs the LLM judge and held),
  plus the judge-variance → fleet-means lesson.
- Eval harness `scripts/tailor-eval.eval.ts`: DeepSeek personas (Tier 1),
  deterministic playback + structural bars (Tier 0), Haiku judge (Tier 2,
  ~$0.012/run). Session LLM spend ≈ $0.09. Updated index, design.md
  (consultation-options pattern), sed default scripted AI mode into jest setup.

## 2026-06-10 — outfit completion ("complete the look")

- Ilmari's review of the rachel transcript exposed a false claim ("leaning
  warmer" over an all-dress catalogue) and the missing tailor instinct:
  dress the OCCASION — layer over the dress for cold evenings, toes-to-hair.
- Built `companions.ts` (slot templates layer/pair/carry/shade, `when` gates,
  occasion synonyms, ≤2 groups × 3, no-duplication, palette-opposition drop),
  primary/companion split with honest substitutes (jeans → trousers, suit →
  shirt+trousers), token-pattern palette matching (vision colour vocabulary
  broke exact lists), addOns wired through API → river rail + /next overlay.
- Updated [[tailor-consultation]] (companions section + data-vocabulary
  gotcha), design.md (complete-the-look rail pattern). Eval: vision-catalogue
  persona replay + judge upsell axis — rachel 5/5/5/5/5, "consultative, not
  transactional". 116 unit tests green.

## 2026-06-11 — LLM-driven conversation (Tier-1 comprehension + generation)

- Ilmari's direction: get the scripted regex answers out of the live path, keep
  them only as the error/CI/no-key fallback; the tiered-AI conversation is now a
  core element. Built on `feat/tailor-discovery`.
- Tier-1 PARSE (parse-llm/parse-context/vocabulary): free text → validated
  ContextPatch, clamped to canonical vocabulary, merged regex-first; exclusion
  safety rule (hard filter → known set only). Tier-1 GENERATE (generate-llm):
  re-voice the spoken prose, deterministic faithfulness gate, template fallback,
  zero engine/voice/UI changes (route re-voices the engine output).
- Provider finding (measured): deepseek-v4-flash ~4s/⅓-runaway → unfit live;
  deepseek-chat ~1.5s reliable; Haiku ~1.0s. Discovery uses a path-specific
  DISCOVERY_DEEPSEEK_MODEL. Logged as task-observer obs #13 (measure latency
  before binding a tier on a latency-bound path).
- New wiki page [[tiered-conversation]]. Eval: scripts/parse-eval.eval.ts
  (per-field P/R, regex vs LLM). 147 tests green; flag-off path byte-identical.

## 2026-06-12 — landscape streamline + security/MISE sweep

- /code-review (security/perf): key-leak boundary clean (server-only path),
  prompt injection structurally contained; applied the `server-only` guard on
  llm-client.ts. Deferred: parallelize the two vector retrievals (perf),
  replace the regex-on-own-message gap-garment extraction with a structural
  field (maintainability) — see prodprep.
- MISE references swept from live src (comments neutralised); stale doc path
  mise/public/catalog → intently/public/catalog fixed. New [[deployment-topology]].
- Endpoint streamline: retired the standalone "river" (page.tsx → NextExperience
  only; 8 river-era components → _parked; ClientShell shrank to the embedded
  nav). /discover→/discovery, plugin :3000→:3017, storefront proxy/middleware/
  url-strippers/nav updated. 154 tests green, build clean.

## [2026-06-15] update | one demo launcher + vision↔Medusa catalogue bridge

Consolidated the demo to a single canonical `intently/scripts/run-demo.sh`: the storefront-plugin topology with the **tiered AI on by default** (`DISCOVERY_PARSER=DISCOVERY_GENERATION=deepseek`), a `DEEPSEEK_API_KEY` preflight warning, and a fresh-build every run (deps refresh + `.next` clear + vector re-seed). Deleted the standalone `run-plugin-demo.sh`; `.env.local` now ships the tiered-AI flags on.

Fixed the catalogue tradeoff: the storefront topology needs `PIM_SOURCE=medusa` (shared cart) but that catalogue is attribute-thin. Added `getProductByArticleNo` ([[deployment-topology]]) so a Medusa vector hit (`k<n>`) resolves to the vision-enriched product (`cat-<n>`) by H&M article number; `retrieve.ts` overlays only the Medusa commerce fields (variant + exact price). `pim-medusa.ts` also reuses the vision embed text for retrieval recall. Dormant without `NEXT_PUBLIC_CATALOG=vision`.

Updated: [[deployment-topology]], [[demo-solution-overview]], [[tiered-conversation]]. +4 tests (158 green), typecheck/lint/build clean.

## [2026-06-15] update | customer-experience revamp + value/ROI + persona pages

Reorganised the wiki around the **customer experience** and quarantined stale pages.

- New [[customer-experience]] — every live component explained in the order a person meets it (shopper → business user) with *why each layer exists*. The new "start here".
- New [[use-cases-personas]] — shopper profiles (occasion / undecided / specific / functional) + business roles (catalogue manager [primary], merchandiser, e-commerce, returns/CX, buyer, data lead), each mapped to the surface it touches. Heavily cross-referenced.
- New [[value-proposition]] — the cost case (AI inference ~$0.003/conversation, ~$14/mo at 150/day, hard-capped by `LLM_DAILY_CAP`) and the value case (worked ROI for a €20M-GMV fashion retailer: top-line conversion+AOV and bottom-line returns reduction; base ~€300k/yr benefit vs <€1k AI cost). All ROI coefficients flagged as pilot-validate assumptions.
- [[index]] rebuilt into the experience frame (Start here → shopper → under-the-hood → Studio → deploy → decisions) with a **Historical / superseded** section quarantining the retired MISE river + parked Phase-2 pages (river-architecture, tiered-ai-architecture, deterministic-ranker, use-chat, chat-persistence, chip-entry-strategy, waypoints-slice, campaigns, admin-zones, admin-panel-guide, account-store-auth-aware-client) so no stale page reads as current.

Audit fix: [[tiered-conversation]] flag table said `DISCOVERY_DEEPSEEK_MODEL` defaults to `deepseek-chat`; corrected to `deepseek-v4-flash` (matches llm-client.ts + the page's own body). Flagged (not changed): `docs/recipe-data-model.md` + `docs/design-mockup.html` are MISE cooking-era residue; `wiki/log.md` `:3000`/`/api/chat` mentions are historical and left intact.

## [2026-06-16] update | discovery landing redesign (Concept B "Living Preview")

Reworked the discovery overlay's empty pre-search first impression (Ilmari: "pops up too empty … not inviting"). Explored three annotated landing directions (simple / inviting / assisting — saved at `wiki/assets/landing-mockups/`, see `index.html`), chose and built **B · The Living Preview**: a two-pane landing that replaces the empty `nx-canvas` with a calm, dimmed, cross-fading *example of the payoff* (best-match card + why-line + understood chips, tagged "Example"); the input is present at t=0 and the situation seeds are kept. The post-search rail+canvas is untouched — the landing is gated on `started`.

- New [[landing-living-preview]] — the pattern, why B over A/C, the **CTA-first calm-reveal rule**, and the first-message dependency the landing rides on.
- Updated [[next-overlay-ux]] — the "Invitation" moment now points to the landing.
- Code: `intently/src/app/next/NextExperience.tsx` (`Landing`/`LandingInput`/`LivingPreview`) + `theme.css` (`.nx-landing`, `.nx-preview`). typecheck/lint/test green (158 tests); Preview-verified on `:3100` (landing → consultation → 12 explained results, window does not scroll past the answer, console clean, mobile collapses to the editorial column).
- Follow-ups (not regressions): fold in Concept A's centring next; focused mobile pass; live result images 404 in standalone dev (`/catalog/<id>.jpg` not in the curated `.webp` bank — pre-existing PIM→picture-bank gap).

## [2026-06-16] update | landing — folded A's best parts into B

Built the B+A merge (Ilmari approved the `b-plus-a.html` mock): **rotating situational placeholder** (empty input cycles real situations across fashion/outdoor, occasion/function/gift — the blank-box cure), a **quiet promise line** ("A curated few — each with the reason it fits. Not a wall of results to scroll." — also the value anchor on mobile, where the preview is hidden), and a **slightly larger input** (17px). A's *centre layout* was deliberately NOT taken — it can't coexist with B's side-by-side living preview. `NextExperience.tsx` (`LandingInput` rotating placeholder via DOM ref, no re-render; reduced-motion holds still) + `theme.css` (`.nx-landing__promise`, input bump). typecheck/lint/test green (158); Preview-verified on :3100 (placeholder cycles desktop+mobile, promise line shows, preview images load). Mock saved: `wiki/assets/landing-mockups/b-plus-a.html`. Next: landing → first-message transition (2 directions being explored).

## [2026-07-05] update | tiered AI live on Vercel + colour-inversion fix

Wired the real DeepSeek key into the deployed app (tiered comprehension +
generation now live at intently-red.vercel.app; ~$0.003/conversation;
Anthropic deliberately skipped — 10× cost, not needed by the discovery path).
First live verification caught the **colour-inversion trap**: "a black dress"
parsed as `addExclusions:["black"]` — documented in [[tiered-conversation]]
(Comprehension § the inversion trap), fixed two-layer (prompt contrast example
+ `dropInvertedExclusions` deterministic guard), 171 tests green, verified 3/3
on the live URL. Also: OpenAIEmbedder (384-dim, batched syncAll) shipped so
the Studio's sync/search can run on Vercel once the OpenAI key lands; customer
demo script at `intently/docs/demo-script.md`.

## [2026-07-06] update | the blind tailor — audience + build visual asks

Ilmari's brief: Intently "suggests clothes with minimal confidence — practically guessing"; a top-notch tailor reads gender/build at a glance, so blind Intently must ASK, with fast visual selections in the empty right pane. Built + deployed same day:

- New [[blind-tailor-consultation]] — the pattern and its non-obvious decisions: sketches depict the person / labels speak about the clothes ("easy through the middle"), build tokens ride the preference rails, audience as a scalar with the 'for him' hard line + requested-garment override, the 'for her' info-gain asymmetry, escapes never echoed ("As you wish."), declining ≠ concluding.
- Data check first: zero per-item gender in the vision catalogue → category is the only honest line (dress/skirt/heels); `silhouette` (boxy/a-line/fitted/…) genuinely supports build bias.
- UI: `VisualAsk` sketch tiles render blocking asks in the desktop canvas; rail pills hide ≥860px; mobile unchanged; typing stays open.
- Verified: 181 jest (10 new against the real catalogue), eval:tailor transcripts read end-to-end (caught two voice warts), browser walk (12 results, zero womenswear for 'for him'), live prod probe with DeepSeek re-voicing the new prompts. Known residual (camisole-under-'top') in prodprep.md with the vision-enrichment fix path.
- Updated [[tailor-consultation]]-adjacent docs: demo-script Act 1 now walks the sketch beats; [[index]] entry added.

## 2026-07-15 — scripted mode removed; complexity gate + grounding verifier + OpenAI provider

- [[ai-mode-toggle]] rewritten as a retirement stub: `NEXT_PUBLIC_AI_MODE` removed; discovery live-only; CI keyless-deterministic via route tests + fetch-stubbed hook tests.
- [[tiered-conversation]] gained three sections: the complexity gate (escalate.ts — per-turn LLM escalation on negation/length/low-vocab-coverage), the grounding verifier (verify.ts — rejects unshown-product mentions and unsupported capability claims; replaced the never-built "Sonnet verifier" design target), and the provider update (openai/gpt-5.4-nano added — 5× cheaper than gpt-5.6-luna; Studio model bench at /admin/enrichment/studio/models).
- [[index]] entries updated accordingly.

## 2026-07-16 — analytics shipped (Phase 0 + 1, local); Studio pipeline rework

- New [[analytics]] — the event stream (TurnEvent/CartEvent → EventSink JSONL), the three lenses (commerce/conversation/budget), and the non-obvious decisions: mutable usage meter instead of a return-type change, cart events bypassing the Medusa route so standalone counts, purchase honestly absent, tiered cost precision (exact tokens, labeled price estimates), hermetic sink path from birth.
- Studio nav split into pipeline (Cockpit·Catalogue·Enrichment·Situations·Needs attention) + tools (Models·Configuration); a PipelineStatus stepper (PIM→Enrich→Index→Situations→Discovery with live counts + next action) renders on every Studio page; the cockpit's old ribbon removed.
- Analytics nav enabled; migration 0012 written (not applied — cloud merge).

## 2026-07-17 — cloud stores live (Supabase + Upstash); security contract documented

- New [[security-key-management]] — the secrets inventory + rules (no secret in repo; `NEXT_PUBLIC_` never on a service-role/LLM key; `server-only` guards; RLS-on despite service-role; fail-soft on every absent key; rotation/incident steps; the zshenv→.env.local→Vercel name mapping).
- Cloud store swaps shipped behind `INTENTLY_STORE=supabase`, local files still the dev/CI default: `supabase/rest.ts` (PostgREST, service-role, fail-soft) + `store/doc-store.ts` (runtime_kv for config/situations) + the Supabase EventSink in `analytics/events.ts`. The four doc stores and the analytics read path went **async**; every call site (discover route, situations/config pages+APIs, PipelineStatus) awaits.
- Guardrail counters wired to Upstash (`guardrails-shared.ts`) — verified live (PONG + INCR); replica-safe caps replace the cap×N in-memory behaviour.
- Supabase: the live project is `<supabase-project-ref>` (the one the zshenv key targets; restored from paused, carries migrations 0001–0015). Applied 0012 (analytics turn/cart/order + arm) and 0013 (runtime_kv). Verified round-trip through the app's own store code.

## 2026-07-18 — cloud demo deployed + documented; serverless degradation pattern

- New [[cloud-demo-deployment]] — the cloud topology as its own page (it is **not** [[deployment-topology]]): Intently standalone on Vercel `fra1`, Medusa dropped on monthly cost, the `INTENTLY_STORE=supabase` swap table (runtime_kv + analytics tables + Upstash counters vs local files), and why shared atomic counters are the only honest cap on serverless (in-memory caps multiply by replica count).
- **The serverless constraint, stated once:** anything that spawns a child process or writes to disk cannot run on Vercel. Vision enrichment hit both and crashed as an opaque 500. Established the degrade-legibly pattern — route answers `501` with an actionable sentence, *and* the control disables itself before it can fire (`enrichable={!process.env.VERCEL}` from a server component, so the flag never ships to the browser). Rules-of-hooks gotcha noted: the disabled early-return must sit after every hook.
- **Verification-without-leaking:** the Studio's Basic-Auth password must not enter an agent transcript, so cloud checks split by where the difference lives — localhost for UI/layout, unauthenticated API probe for cloud-gated behaviour, human-opened preview deployment for cloud-only visuals. Cross-linked from [[security-key-management]] thinking.
- Studio nav lost its pipeline row (superseding the 2026-07-16 split): it duplicated the PipelineStatus stepper in a *different order*. Nav is now Studio·Analytics + Tools(Models·Configuration); the pipeline navigates in pipeline order, once. Verified on localhost — stepper links cover every removed surface, situations click-through confirmed, zero console errors.
- Stale facts corrected: [[deployment-topology]] scoped explicitly to local + pointed at the cloud page; [[index]] analytics entry updated (migrations 0012/0013 applied, no longer "pending cloud merge"); [[vision-enrichment]] gained its "cannot run on serverless" section.
- Residue tracked (not blocking the demo): vector store still local JSON in the cloud build → Enrichment/Catalogue Studio pages read a prebuilt cache; steps #4/#5 in `intently/docs/cloud-demo-plan.md`.

## 2026-07-18 (later) — vision enrichment rebuilt to run on serverless; tiered demo reset

- Ilmari asked how to run enrichment on the cloud (the button was disabled) and for a way to clear enriched data so a demo can run start-to-finish. Chose **rebuild over degrade**: "watch the catalogue enrich itself" is the demo, so a disabled button was the wrong final answer.
- [[cloud-demo-deployment]] gained the framing that matters: there are only **two honest responses** to a platform constraint — degrade legibly (when the capability belongs on a laptop) or rebuild to fit (when a demo audience needs to see it run) — plus the three constraint→decision pairs (in-process core, chunked cursor, Supabase rows) and the **`public/` is not in the function bundle** trap (a runtime-built file path is not traced, so it works locally and ENOENTs in production only; `outputFileTracingIncludes` fixes it).
- The retired `scripts/vision-enrich.mjs` was **deleted, not kept alongside** the TS core — two implementations of one batch is the divergence trap that killed scripted mode.
- Reset is **tiered by cost-to-undo** (PM tuning / enrichment output / analytics), nothing preselected, typed `RESET` guard, partial failure reported per tier. Rationale: a flat "wipe everything" on cloud used to mean the demo could never recover.
- Verified live: 10/10 enriched in 26s from the deployed function, rows in Supabase, reset cleared them (0 rows), re-run repopulated. Confirmation guard rejects both a missing and a lowercase token.
- Honest residue recorded: a cloud run repopulates the enrichment surfaces but not the committed catalogue or vector index (still build-time artifacts) — pgvector + re-index is step #4.
- **Discovered, not yet fixed:** `product-overrides` and `attention-state` still write with raw `writeFileSync` to `process.cwd()/.enrichment/`, bypassing doc-store — so the curate-attributes loop and the Fix/Resolve/Dismiss queue throw on cloud's read-only FS. Same class as the original vision bug. Tracked as follow-up.

## 2026-07-27 — the cloud demo went private end to end

- Ilmari asked to put the whole cloud site behind auth, not just `/admin`. New ADR: [[private-demo-two-passwords]].
- `intently/src/proxy.ts` matcher widened from `['/admin/:path*', '/api/enrichment/:path*']` to `['/:path*']`. Static assets are gated too — a "private" site whose JS bundle and product images are anonymously fetchable is not private, and browsers replay the credential to same-origin assets so it costs nothing.
- **Two passwords, not one.** One shared secret would mean the credential handed to a prospect also opens the Studio. `SITE_BASIC_AUTH_PASSWORD` gates everything; `ADMIN_BASIC_AUTH_PASSWORD` gates admin and acts as a master key that opens shopper routes too.
- The non-obvious rule, and a bug caught mid-implementation: **what *activates* a gate is a different question from what *opens* it.** Folding them together made an admin-only config silently close the shopper river. Each variable now gates only its own scope, so widening the matcher is a no-op for existing deploys until the site password is deliberately set. Pinned by a regression test.
- `POST /api/analytics/order` is the single exemption — it carries `INTENTLY_WEBHOOK_SECRET` and a webhook caller cannot answer a Basic challenge. Its sibling `/api/analytics/track` is gated.
- Verified live on `intently-red.vercel.app`: anonymous 401 on `/`, `/next`, `/api/discover`, `/favicon.ico` and a JS chunk; site password opens the river and a real discovery turn but **not** `/admin`; wrong password 401.
- **Deploy trap recorded:** the `intently` Vercel project has Root Directory `.`, so CLI deploys must run from `intently/`. Running `vercel deploy --prod --yes` from the repo root (no `.vercel` link there) made the CLI silently create a *new* project named after the directory, with no env vars — i.e. a second, completely ungated copy of the site on a live URL. Removed; the trap is now in the ADR.
- Residue added to `prodprep.md`: no throttling on failed attempts, non-constant-time password comparison. Both become real the moment this fronts more than a single-operator demo.
