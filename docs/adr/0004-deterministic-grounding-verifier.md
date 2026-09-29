# ADR-0004 — A deterministic grounding verifier instead of an LLM verifier tier

- **Status:** Accepted (2026-07-15); limits measured and recorded 2026-09-29
- **Detail:** [wiki/concepts/tiered-conversation](../../wiki/concepts/tiered-conversation.md) · `intently/src/lib/discovery/verify.ts` · [scorecard](../../intently/docs/eval-scorecard-latest.md)

## Context

When the re-voicer (ADR-0001) is on, its prose could name a product the engine
didn't show, or promise something Intently can't do ("added to your cart",
"ships tomorrow"). The original design target was a third tier: a Claude model
verifying every generation. That adds a second LLM call, its latency and its
own failure modes to every generated turn.

## Decision

Build the verifier as deterministic code, always on when generation runs, on top
of the structural faithfulness gate (piece count, ids, no apology framing):

- **Product grounding** — whole-name match of catalogue products against the
  shown set. Exact; cannot false-positive on ordinary words like "dress".
- **Capability grounding** — a denylist of performed-action and fulfilment
  claims.

Any rejection keeps the engine's template. The LLM verifier tier was removed
from the design rather than left as an unbuilt promise.

## Consequences

- Measured (scorecard eval): unshown product named → rejected **100%**; faithful
  prose wrongly rejected **0/208**.
- Measured weakness: the capability denylist catches **100% of its tuned set but
  ~30% of a held-out set** — denylists overfit. Blast radius is small today
  (generation off by default, short prose), but it is the weakest link. The
  recorded next step (`prodprep.md`) is to constrain *what generation may
  write* via structured output, or add an LLM check budgeted under the existing
  daily cap — not to keep growing the regex list against the held-out set.
