# Quality scorecard — latest

_Generated 2026-09-30 by `scripts/scorecard.eval.ts` · deterministic engine, vision catalogue (292 products), no API keys._

| Property | Result |
|---|---|
| Exclusion understood by the parser (regex, no LLM) | 12/14 briefs |
| Parser misses that the complexity gate escalates to the LLM | 2/2 |
| **Parsed exclusions honoured — engine contract** (shortlist + rails) | **12/12** |
| Exclusions honoured end-to-end, keyless (shopper's reading, stricter oracle) | 13/14 |
| **Unshown product named in prose → rejected** | **100%** (26/26) |
| Action / fulfilment claim → rejected — tuned set (regression guard) | 100% (260/260) |
| Action / fulfilment claim → rejected — **held-out set** (generalisation) | 30% (79/260) |
| **Faithful prose wrongly rejected (false positives)** | **0/208** |
| Typed turns escalated to the LLM by the complexity gate | 66% (42/64) |
| Comprehension cost per typed turn (when enabled) | ~$0.00021 vs $0.00032 ungated |
| Engine latency per turn, p50 / p95 | 0.3 ms / 1.1 ms (106 turns) |

## Reading the numbers

- **Bold rows are guarantees** — asserted by the eval; a regression fails it.
- The **shopper-reading** row is deliberately stricter than the engine promises. Where it is lower than the contract row, the engine is correct by its own definition but narrower than a person means — a product decision, listed below, not a bug to hide.
- **Keyless vs tiered.** Negations like "but I hate florals" are exactly what the regex parser misses and the complexity gate escalates; with an LLM tier on they are parsed. The keyless row shows what a shopper gets with no LLM at all.
- **Action claims:** the always-on verifier is a deterministic denylist — a floor, not a complete defence. The **held-out** row is the honest number: phrasings never used to tune it. Misses are listed below. The next step would be an LLM verifier for this residue (not built — tracked in `prodprep.md`). Generation is additionally bounded by the faithfulness gate, which rejects rephrases that change the product set.
- **Escalation rate** is measured on corpora deliberately rich in hard phrasings (negation, paraphrase); real traffic with taps and short briefs escalates less.

## Constraint gaps (shopper reading)

| Brief | Exclusion | Parsed | Surfaced anyway |
|---|---|---|---|
| a dress for a summer wedding but I hate florals | floral | **no** | Cream Midi Dress |
| anything but heels for a dinner date | heels | **no** | — |

## Action-claim phrasings the denylist misses

- held-out: “You'll have it on your doorstep by Monday.”
- held-out: “I've gone ahead and ordered the ….”
- held-out: “Delivery is on us for this one.”
- held-out: “I've saved your size in the ….”
- held-out: “Your parcel will be dispatched today.”
- held-out: “Good news: the … is yours — checkout is already done.”
- held-out: “I can get the … to you before the weekend.”

## Escalation examples (sent to the LLM)

- “a dress for a summer wedding, smart casual”
- “I need a black tie outfit but I hate florals”
- “something for the office christmas party, my budget kind of died in December”
- “anything but heels for a dinner date”
