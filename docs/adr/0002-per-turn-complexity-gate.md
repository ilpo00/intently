# ADR-0002 — Deterministic-first tiers with a per-turn complexity gate

- **Status:** Accepted (2026-07-15), in production
- **Detail:** [wiki/concepts/tiered-conversation](../../wiki/concepts/tiered-conversation.md) · `intently/src/lib/discovery/escalate.ts`

## Context

With ADR-0001 the LLM is optional per stage, but a provider flag is
all-or-nothing: once on, *every* turn pays latency (~1–1.6 s) and money — even
"blue shirt" or a tapped option, which the regex parser handles perfectly.

## Decision

A pure, deterministic gate decides **per turn** whether the LLM earns its call.
Escalate only where the LLM is measured to beat the regex parser: rejection or
negation language (exclusions are hard filters, so misreading them is
expensive), long multi-clause briefs, and low canonical-vocabulary coverage
(paraphrase). The gate is ANDed with the provider flag and a global daily
budget, so it can only ever *reduce* spend.

Provider choice is per-deployment configuration, and it was measured, not
assumed: DeepSeek v4-flash with thinking **disabled** (~1.6 s, 97% recall) was
the first live provider; thinking-on was ~4 s with a third of calls running
away to empty output — unfit for a latency-bound path. Claude Haiku (~1.0 s)
is the alternative; the cloud demo moved to OpenAI `gpt-5.4-nano` (2026-07-17),
chosen over a larger model as 5× cheaper and right-sized for extraction and
rephrasing. The Studio model bench compares configurations side by side.

## Consequences

- Taps and short briefs are instant and free even with a provider on.
- Effective cost = per-call price × escalation rate × volume, hard-capped by
  `DISCOVERY_LLM_DAILY_CAP`; over the cap the conversation silently continues
  deterministically. Modelled at ~$0.003 per conversation.
- The escalation rate is itself a metric (scorecard eval; analytics LLM-health
  lens) and a tuning knob (`DISCOVERY_ESCALATE_MINWORDS`, Studio config).
- The gate can under-escalate a subtle turn; the scorecard asserts that every
  exclusion the regex misses in its corpus *is* escalated.
