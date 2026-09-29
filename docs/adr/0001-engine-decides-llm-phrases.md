# ADR-0001 — The engine decides, the LLM phrases

- **Status:** Accepted (2026-06-11), in production
- **Detail:** [wiki/concepts/tiered-conversation](../../wiki/concepts/tiered-conversation.md)

## Context

Intently turns a shopper's situation into a shortlist. Two jobs need language
understanding: reading the shopper's free text, and speaking like a tailor
rather than a template. The obvious design — an LLM agent with catalogue tools
that decides what to show — makes the *recommendation itself* non-deterministic:
it can invent inventory or attributes, be prompt-injected into recommending
anything, and cannot be audited or reproduced when a merchandiser asks "why
did it show this?".

## Decision

Split by responsibility. The LLM owns **words in** (free text → a validated,
vocabulary-clamped context patch) and **words out** (re-voicing prose the
engine already wrote). A deterministic engine owns **every decision**: which
question to ask (information gain over the live candidate set), what to show,
ranking, hard exclusions, outfit completion, cart awareness. The engine's
template is simultaneously the ground truth, the verification reference and the
fallback.

## Consequences

- Recommendations are reproducible and auditable; the Studio can explain any
  result from attributes alone.
- Prompt injection is contained structurally: parser output is clamped to the
  shopping vocabulary, and raw shopper text never reaches the re-voicer.
- Every LLM stage fails safe to a complete deterministic product — CI and the
  no-key demo run the full experience.
- Cost falls out of the design: at most ~1–2 small calls per turn (ADR-0002).
- The price of the choice: the engine's vocabulary bounds what can be acted on;
  new concepts need engine work, not just a prompt change.
