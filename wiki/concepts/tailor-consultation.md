---
type: concept
status: stable
updated: 2026-06-10
sources: []
tags: [discovery, consultation, ask-before-offer, outfit-completion, voice, tiered-ai, eval]
---

# tailor-consultation

**The discovery layer behaves like a personal tailor: a thin brief earns a question, not a guess.** Shipped 2026-06-10 on `feat/tailor-discovery`. Pure Tier-0 at runtime — no LLM in the request path; DeepSeek and Claude appear only in the dev-time eval harness.

## The shape

`src/lib/discovery/consult.ts` is the brain; `voice.ts` is the copy; `attributes.ts` is the shared vocabulary. The engine (`composeFromCandidates`) now returns `{ message, results, updatedContext, question? }`:

- **Blocking ask** — `question` with `results: []`. At most **2** before the first reveal, only while `signalCount(ctx) ≤ 2`, never after a reveal (`revealCount` gate). The UI stays in the conversation; a blocking ask NEVER navigates to discovery (extends [[persistence-restores-data]]'s spirit: only reveals advance the river).
- **Sharpening ask** — `question` alongside results. Non-blocking; rendered as option pills where refine chips used to be.
- Both flow through the same single contract on both surfaces (river `useDiscover` + plugin overlay `live.ts`), preserving the [[ai-mode-toggle]] rule — the scripted path runs the identical engine client-side.

## Non-obvious decisions (the "why")

**Questions are selected by information gain over the LIVE candidate set.** A question is only asked if every substantive option would leave ≥3 candidates on BOTH sides of its split (`splitsMeaningfully`). This is why **formality is deliberately absent from the question bank**: the live catalogue's formality levels span 1–2, and scoring proximity against any target produces the *identical ranking* either way — asking would be theater. The same gate auto-adapts when the candidate set comes from another PIM (Medusa colours, vector retrieval): questions that can't discriminate silently disappear instead of becoming noise.

**Answers are structured patches, not parsed text.** A tapped option carries `{ questionId, optionId }`; the engine applies the option's `ContextPatch` deterministically — a tap can never be misunderstood. Every option label is *also* written to parse (`session.ts` folds "darker, richer tones" typed to the same `darker tones` token the tap patches in), so the two input paths converge.

**Strictly forward-moving (mark-on-ask, including sharpeners).** A question once shown — answered, escaped, or typed past — never reappears. This was A/B-judged: an early "gentle circle-back" variant (re-offering a typed-past question once, non-blocking) was read by the LLM judge as "the system didn't listen" far more often than as attentiveness. Each turn brings a fresh question or none.

**Escapes conclude.** "Surprise me — show your picks" doesn't just skip a question; it ends the interrogation (`CONSULT_CONCLUDED` sentinel): the shopper delegated, the tailor decides now and doesn't sharpen afterwards either.

**The honesty beat is a CONTESTED decision, held on purpose.** When the shopper asks for a garment no result can satisfy (jeans → 42-dress catalogue), the reveal says once: *"No jeans in the collection today, so I've chosen around it — for work, each one earns its place."* The Haiku judge consistently scores ANY gap mention as a `nolack` violation and wants pure silent pivot. We hold the opposite: silently substituting dresses for a jeans request reads as broken/gaslighting and is the worse trust failure. The eval exempts honesty-beat transcripts from the `nolack` bar and documents why. **If a real customer demo says otherwise, flip `garmentGapPrefix` — it's one function.**

**`revealCount` over clever inference.** `firstReveal` was originally inferred from `turnCount === askedQuestions.length`; sharpener mark-on-attach broke the equality. Explicit state (`SessionContext.revealCount`) replaced the inference — blocking asks gate on `revealCount === 0`, which is also the honest statement of the rule.

## Outfit completion (companions.ts) — the tailor dresses the occasion

Added same day after Ilmari's review of the rachel transcript: "evenings get cold" over an all-dress catalogue had produced the FALSE claim "now leaning warmer" (the warmth boost only targets jackets — nothing re-ranked). The real answer is layering, which also opens the upsell: **"complete the look" companion groups** beside the shortlist (`DiscoverResponse.addOns`).

- **Slot templates** (layer / pair / carry / shade) keyed on the primary shortlist's dominant category, each with a `when(ctx)` gate — a layer needs cold evenings, an outdoor venue, or a cool season; carry needs an activity. The lead line always names the reason ("Summer days run warm and the evenings won't — a light layer over it settles both.").
- **Never pushy, enforced structurally:** max 2 groups × 3 pieces; a group needs ≥2 occasion-compatible fills; categories already in the primary grid suppress their slot (so the hiker's cross-category basket stays rail-free); palette-opposing pieces drop from rails when aligned ones exist (no White Denim Jacket after "darker, richer tones").
- **Primary/companion split:** a named garment anchors the main grid on its categories; the layer goes in the rail, not splashed across the dress grid (the cold-evenings +8 warmth boost is scoped to kit briefs for the same reason). Unstocked garments anchor on honest substitutes — jeans → trousers, **suit → shirt + trousers (the assembled version of the intent)** — while the honesty beat still names the gap.
- **Vector-mode pool:** the route fetches one extra companion-targeted retrieval and passes `companionPool`, because a dress-narrowed top-k contains no jackets.
- **Cold-evenings copy says only what happened:** layer set beside / genuinely warmer (kit) / plain acknowledgment. The old false-warmth claim is structurally unreachable.

**Cart-aware context (added after Ilmari's live test, same day):** the cart travels with every discovery call as `CartContextItem[]` (id/category/name — **UI state passed per call, never parsed session state**). Two effects: (1) carted items never re-offered, in results or rails; (2) the **cart-anchored pivot** — with a dress in the cart, a turn that names no garment and arrives with a slot-triggering constraint ("it gets cold in the evenings") or an open "what else?" makes the completion itself the primary grid: *"Your dress is settled — for those evenings, 12 layers that go over it."* The pivot persists by re-pointing `requestedGarment` at a new garment word `layer` (also typeable: "a light layer over the dress" — earliest-mention detection), so palette refinements keep refining the layers. Guards: option taps, plain refinements (exclusions/palette), and named garments never flip. Plugin caveat: pre-existing host-store cart lines carry no product ids — only session adds count.

**Gotcha that bit twice — data vocabulary beats schema:** the vision bank speaks in qualified colours ('charcoal grey', 'dark navy', 'pale pink') and occasion tags ('office', not 'work'). Exact-membership colour lists silently mis-grouped (white+grey counted dark via bare 'grey'); palette matching is now token-pattern based (`dark|charcoal|navy|…` / `pale|light|bright|…`, bare mid-tones neutral), and companion occasion-compat expands session occasions through a synonym map (work→office/commute). When wiring any new attribute logic, check the LIVE catalogue's actual value vocabulary first — the Product type tells you nothing about it.

## The eval harness (tiered AI, dev-time only)

`scripts/tailor-eval.eval.ts` (manual, not CI — jest `--testMatch` override; `npm run eval:tailor`):

- **Tier 1 (DeepSeek):** 12 shopper personas bulk-generated into `scripts/tailor-personas.json`, schema-validated deterministically.
- **Tier 0:** personas played through the real engine; structural assertions (≤2 blocking asks, no repeats, no dead-ends, rich briefs reveal on turn 1); transcript report at `intently/docs/tailor-eval-latest.md`.
- **Tier 2 (Claude Haiku, `TAILOR_JUDGE=1`):** ONE batched judging call against a 4-axis rubric (tailor / ack / nolack / voice), ~$0.012 per run. Verify-or-regenerate: 6 judge iterations drove real fixes (article grammar, re-greeting, contradiction with attached sharpener, unparsed budget phrases, the repetition findings above).

**Gotcha — LLM-judge variance:** per-persona scores swing ±2 between runs on identical transcripts (one run demanded the circle-back, the next two condemned it). The pass bar is therefore **fleet means** (tailor ≥4, ack ≥4, voice ≥3.5, nolack ≥3.5 ex-honesty), not per-persona minimums. Final run: tailor 4.1, ack 4.25, voice 4.75, nolack 4.6.

## Related

- [[ai-mode-toggle]] — the single-contract rule this extends.
- [[tiered-ai-architecture]] — the standing tiering preference the eval follows.
- [[agent-skill-system]] — `intently-tailor-voice` skill added as the copy-rules enforcement layer.
- `intently/docs/design.md` § Consultation options — the UI pattern rules.
- `intently/docs/conversation-architecture.md` — the pipeline this slots into (the parser remains refinement lever #1).
