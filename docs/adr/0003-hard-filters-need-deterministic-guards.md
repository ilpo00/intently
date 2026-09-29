# ADR-0003 — LLM output may only reach a hard filter through a deterministic guard

- **Status:** Accepted (2026-06-11; extended 2026-07-05 after a production finding)
- **Detail:** [wiki/concepts/tiered-conversation](../../wiki/concepts/tiered-conversation.md) · `parse-context.ts`, `parse-llm.ts`

## Context

Exclusions ("no florals", "nothing black") are **hard filters**: a hallucinated
exclusion silently deletes inventory the shopper wanted, with no visible error.
Soft signals (preferences, situation bias) degrade gracefully when wrong; hard
filters don't.

## Decision

1. The validator admits exclusions **only from a known set**; everything else
   the LLM returns is clamped to vocabulary or dropped. Merge is regex-first:
   the LLM fills gaps and appends, never overrides or removes.
2. **The inversion trap** (found on the first production run, 2026-07-05): "a
   black dress for a party" came back as `exclude: black`. The value was valid
   — the *intent* was inverted — so vocabulary validation could not catch it,
   and it was intermittent (2 of 3 samples). Fixed in two layers: wanted colours
   got their own sanctioned field in the prompt schema, and
   `dropInvertedExclusions` deterministically drops any exclusion whose token
   appears in a message with no rejection language.

General rule: *an enumerated vocabulary is an affordance — a hard-filter field
must never share surface tokens with positive intents unless the positive form
has its own field **and** a deterministic guard.*

## Consequences

- The scorecard eval asserts that every parsed exclusion is honoured across the
  shortlist *and* the outfit-completion rails (12/12).
- Measured trade-off: adding the LLM lifts constraint recall 84% → 97% but
  lowers precision 100% → 89% (parse eval). Regex-first merge plus these guards
  is what keeps the precision loss out of the hard filters.
