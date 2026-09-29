---
type: concept
status: stable
updated: 2026-07-15
sources: []
tags: [discovery, tiered-ai, llm, comprehension, generation, deepseek, haiku]
---

# tiered-conversation

**The discovery conversation is LLM-driven on both ends, deterministic in the middle, and deterministic-as-fallback everywhere.** Shipped 2026-06-11 on `feat/tailor-discovery`. The shape Ilmari asked for: get the "scripted regex answers" out of the live path, keep them only as the graceful fallback.

```
query ─▶ [Tier-1 PARSE]  free text → validated ContextPatch   (parse-llm.ts)
            │  regex parser always runs; the LLM fills gaps (regex-first merge)
            ▼
        DETERMINISTIC ENGINE — decides everything (engine/consult/companions):
          what to ask (info-gain), what to show/rank, exclusions, cart-anchor,
          outfit completion. Produces correct prose via the templates (voice.ts).
            │
            ▼  [Tier-1 GENERATE]  re-voice the spoken prose, faithfully (generate-llm.ts)
            ▼
        response  (same /api/discover contract)
```

**The dividing line (the crux Ilmari and I settled): the LLM owns the WORDS in and out; the engine owns the DECISIONS.** An LLM never decides what to recommend/rank/exclude/ask — that stays the auditable engine that makes recommendations trustworthy and non-pushy (the thing the [[tailor-consultation]] rounds protected). The LLM only comprehends the shopper's words and re-voices the tailor's.

## Comprehension (Tier-1 parse) — parse-llm.ts + parse-context.ts

Free text → a `ParsedContextPatch`, clamped to the canonical vocabulary ([[vocabulary]]) by a deterministic validator, merged **regex-first** (the regex parse always runs; the LLM only fills null scalars and appends list items — never overrides/removes). Wins on paraphrase/negation/indirection the keyword parser misses ("I hate florals", "my budget died in December", "anything but heels").

- **The one safety rule:** exclusions are HARD filters (a hallucinated one silently deletes inventory), so the validator admits exclusions ONLY from the known set. Everything else clamps to vocabulary or drops.
- **The inversion trap (found live 2026-07-05, first prod run):** "a black dress for a party" parsed as `addExclusions:["black"]` — colours live in the EXCLUSIONS vocabulary, wanted colours had no sanctioned field, so DeepSeek routed the positive mention into the only list where the token appears. Vocabulary-in-known-set validation can't catch it (the value IS valid — the *intent* is inverted), and it was intermittent (2/3 samples). Fix is two-layer: the prompt now gives wanted colours a home in `addPreferences` with a worked contrast example, and `dropInvertedExclusions` (parse-llm.ts) deterministically drops any exclusion token mentioned verbatim in a message with no rejection language. General rule: an enumerated vocabulary is an affordance — a hard-filter field must never share surface tokens with positive intents unless the positive form has its own field AND a deterministic guard.
- **Always fails safe:** any model error/timeout/empty → null → the route keeps the regex result. Flag off (default) = today byte-identical → this is also the CI/no-key path.

## Generation (Tier-1 re-voice) — generate-llm.ts

The engine has already chosen what to say and said it correctly (voice.ts templates). The re-voicer rephrases that text warmer/non-templated — the assistant message, the consultation question + option labels, the outfit-completion leads. **The template is the ground truth, the verification reference, AND the fallback.** A deterministic faithfulness gate rejects any rephrase that drops the piece count, sneaks in an apology / lack-framing, or mangles the option/lead structure (same ids, non-empty) → route keeps the template. Implemented in the route with **zero engine/voice/UI changes** (lowest-risk: the deterministic path stays the untouched fallback).

- Per-product "why" lines stay deterministic this round — truth-critical (claiming a false attribute), attribute-grounded, already truth-enforced by `explain()`. The natural follow-on (LLM whys need attribute-grounded verification).

## The provider finding (measured, don't skip)

The plan assumed "DeepSeek bulk, Claude verify." Measuring the live per-turn latency changed the configuration — and the DeepSeek docs explained the mystery:

| provider/model | parse latency | reliability | note |
|---|---|---|---|
| **deepseek-v4-flash, thinking DISABLED** | **~1.6s** | reliable (97% recall) | the live default |
| Claude Haiku | ~1.0s | reliable (100% recall) | the alternative; also the natural verifier tier |
| deepseek-v4-flash, thinking ON (default) | ~4s | ⅓ runaway-to-empty | reasons verbosely BEFORE the JSON; **unfit for the live path** |

**It was thinking mode all along:** the "fast deepseek-chat / slow v4-flash" split is actually one model — `deepseek-chat` is the official alias for *v4-flash non-thinking*, and bare v4-flash defaults to *thinking*. **`deepseek-chat` is deprecated 2026-07-24** (api-docs.deepseek.com/quick_start/pricing), so discovery calls the real model name with the explicit `thinking: {type: "disabled"}` param (llm-client.ts) — deprecation-proof and identical behavior (verified live: same latency, same outputs, same token counts). `DISCOVERY_DEEPSEEK_MODEL` (default `deepseek-v4-flash`) is path-specific; the batch helpers' global `DEEPSEEK_MODEL` is untouched. Lesson logged twice: measure real latency on a latency-bound path before binding a tier, and know your model's *mode* defaults.

## The complexity gate (2026-07-15) — escalate.ts

Provider flags stopped being all-or-nothing: `shouldEscalate(query)` decides **per turn** whether the LLM parse/generate earn their call. Simple turns ("blue shirt", tapped chips) stay on the free deterministic path even with a provider on; escalation triggers on (1) rejection/negation language (the LLM's comprehension win; exclusions are safety-critical), (2) long multi-clause briefs (≥ `DISCOVERY_ESCALATE_MINWORDS`, default 8), (3) low canonical-vocabulary coverage (paraphrase — "my budget died in December"). The gate is a pure AND on top of the flag + daily budget — it only ever reduces spend. Effective LLM cost = per-turn price × escalation rate × volume, capped by `DISCOVERY_LLM_DAILY_CAP`.

## The grounding verifier (2026-07-15) — verify.ts

Layer 2 on the re-voicer, extending the faithfulness gate with CLAIM checks: prose is rejected (template kept) when it **names a catalogue product not among the shown results** (whole-name match — exact enough to never false-positive on "dress") or **claims an action/promise Intently can't back** ("added to your cart", "it'll ship tomorrow", "back in stock by…"). Deterministic, always on when generation runs. This replaced the never-built "Claude Sonnet verifier" design target from [[tiered-ai-architecture]] — the doc-only third tier that was deleted rather than built (deterministic checks cover the concrete failure modes for free; an optional LLM verifier remains a future escalation for subtle residue).

## Providers (2026-07-15): scripted mode removed, OpenAI added

- `NEXT_PUBLIC_AI_MODE=scripted` is **gone** ([[ai-mode-toggle]]) — `/api/discover` is the sole path; CI runs it keyless-deterministic.
- `Provider` is now `deepseek | haiku | openai`. OpenAI default `gpt-5.4-nano` ($0.20/$1.25 per 1M; cached input $0.02) — chosen over `gpt-5.6-luna` ($1.00/$6.00) as 5× cheaper and right-sized for extraction/rephrase; escalate to `gpt-5.4-mini` only on a failed eval gate.
- PMs validate models per use case in the **Studio model bench** (`/admin/enrichment/studio/models` → `POST /api/discover/probe`): request-time provider/model override, per-stage latency, faithfulness + grounding verdicts, side-by-side columns. The shopper route stays env-driven.

## Ground rules (abuse containment) — guardrails.ts

**Topic containment is structural, not a filter:**
- The parser's output is **clamped to the shopping vocabulary** — off-topic/adversarial text yields an empty patch and the engine answers on-topic. Worst-case prompt injection of the parse = wrong-but-valid shopping values; exclusions (hard filters) only ever from the known set.
- **Raw shopper text never reaches the re-voicer** — it rephrases engine text + validated signals only. Injection cannot steer what Intently says, and the assistant never echoes raw input (the only place a shopper sees their own text is their own chat bubble, client-side).

**Resource limits (the actual abuse surface), in `guardrails.ts`, wired in route.ts:**
- Query capped at 280 chars (sanitized: trim/collapse/slice) before anything runs.
- Per-IP rate limit: sliding minute window (default 20/min) + daily count (400/day) → friendly 429 with `retry-after`. Tunables: `DISCOVERY_RATE_PER_MIN/`_PER_DAY`.
- Global daily LLM budget (`DISCOVERY_LLM_DAILY_CAP`, default 2000 calls/day, UTC reset): when exhausted the conversation **silently continues on the deterministic path** — runaway spend is impossible and the shopper never sees an error.
- All in-memory → single-replica demo only (prodprep: shared store before multi-replica).
- Privacy posture: raw queries are sent to the LLM providers when flags are on (server-side), and are NOT logged by the route.

## Flags

| env | values | effect |
|---|---|---|
| `DISCOVERY_PARSER` | unset / `deepseek` / `haiku` | LLM comprehension (`llm` aliases deepseek). Unset = regex only. |
| `DISCOVERY_GENERATION` | unset / `deepseek` / `haiku` | LLM re-voicing. Unset = deterministic templates. |
| `DISCOVERY_DEEPSEEK_MODEL` | default `deepseek-v4-flash` | the discovery DeepSeek model, thinking OFF (separate from the global one). |

Both flags independent; both fail safe; both off = today exactly. Keys are server-side only (route.ts). The canonical demo (`scripts/run-demo.sh`) and `.env.local` now set both to `deepseek` by default, so the tiered AI is ON out of the box (it still degrades to the deterministic path without `DEEPSEEK_API_KEY`).

## Verification

`scripts/parse-eval.eval.ts` (`npm run eval:parse`, `PARSE_LLM=deepseek|haiku` for live) — per-field precision/recall over 30 hand-labelled phrasings → `docs/parse-eval-latest.md`. Generation safety is the unit-tested faithfulness gate (`generate-llm.test.ts`) + the live probe; a judge extension over LLM-generated transcripts is the deferred follow-on.

## Related

- [[tailor-consultation]] — the decision layer the LLM phrases around (unchanged).
- [[vocabulary]] — the canonical value space the parser maps into.
- [[tiered-ai-architecture]] — the standing preference; this round refines it with the latency/provider finding.
