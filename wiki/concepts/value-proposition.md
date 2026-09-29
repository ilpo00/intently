---
type: concept
status: stable
updated: 2026-06-15
sources: []
tags: [value, roi, cost, pricing, business-case, ai-spend, returns, conversion]
---

# value-proposition

What Intently is worth, and what it costs to run. Two halves: a **cost** case (the AI inference bill is negligible — by design) and a **value** case (a worked ROI for a mid-size fashion retailer, top-line *and* bottom-line). Read the architecture behind the cost claim in [[tiered-conversation]]; the experience behind the value claim in [[customer-experience]].

> **Radical-candor note.** Every monetary figure below is an *illustrative model* with stated assumptions, not a measured result. The AI-cost numbers are grounded in the actual prompt sizes and the code's budget caps and are robust. The ROI numbers depend on uplift coefficients (adoption, conversion lift, return reduction) that **only a pilot/A-B test on the retailer's own traffic can confirm**. Treat the method as the deliverable; plug in real numbers when you have them.

---

## 1. The proposition in one line

**Intently turns a shopper's situation into a small, explained, correctly-matched shortlist — lifting conversion and basket size (top line) while reducing wrong-product returns (bottom line) — for an AI running cost measured in tens of euros a month.**

The leverage comes from one architectural choice: **the deterministic engine makes every decision; the LLM only handles language** (comprehension in, prose out). → [[tiered-conversation]]. That choice is *why the AI is cheap*: the expensive thing (an LLM deciding what to sell, on every product, every turn) never happens. The model is only ever phrasing a decision the cheap deterministic code already made.

---

## 2. The cost case — AI spend is negligible

### 2.1 What actually calls a paid model

Per shopper **turn**, at most two DeepSeek calls (`llm-client.ts`):
- **comprehension** — free text → validated context (skipped on A/B answer-turns, which carry structured intent already);
- **generation** — re-voice the engine's prose.

No Claude call is required: generation is gated by a *deterministic* faithfulness check, not a model verifier (there is no model verifier in the path; the always-on grounding check in `verify.ts` is deterministic — see `prodprep.md` for its measured limits). Embeddings run in-process (MiniLM, no API). So the paid surface is ~1–2 small DeepSeek calls per turn.

### 2.2 Per-conversation cost (worked)

Assumptions (conservative; cache-miss list pricing, early-2026 DeepSeek-class rates — *verify against current pricing*):

| | input tokens | output tokens | $/call (≈$0.27/M in, $1.10/M out) |
|---|---|---|---|
| comprehension call | ~700 | ~120 | ~$0.00032 |
| generation call | ~600 | ~200 | ~$0.00038 |

A typical **3-turn conversation** ≈ 2 comprehension + 3 generation calls ≈ **~$0.002–0.004**. Call it **$0.003 / conversation**.

### 2.3 Per-volume (the headline)

| Conversations/day | Monthly AI cost | Annual AI cost |
|---|---|---|
| 150 (mid-size) | **~$14** | **~$165** |
| 500 | ~$45 | ~$550 |
| 1,000 (busy) | ~$90 | ~$1,100 |

For context, the **median order** at €80 AOV and 55% margin yields ~€44 gross profit — i.e. **one converted order pays for ~10,000+ conversations** of AI inference.

### 2.4 The spend is *capped*, not just small

The route enforces in-memory guardrails (`guardrails.ts`): a **global daily LLM-call cap** (`LLM_DAILY_CAP`, default 2,000 calls/day → a hard ceiling of ~$0.80/day on inference), plus per-IP rate limits (20/min, 400/day) and a 280-char input cap. When the budget is exhausted the conversation **silently degrades to the deterministic engine** — it never errors and never overspends. So the worst case is bounded and the demo/no-key path is always complete. → [[tiered-conversation]]

**Honest framing:** the real investment in adopting Intently is *integration + engineering + merchandiser time*, not model tokens. The AI bill is a rounding error against the value below. Don't sell the cost; sell the value, and note the cost is a non-issue.

---

## 3. The value case — ROI for a mid-size fashion retailer

### 3.1 The model retailer (assumptions)

| Parameter | Value |
|---|---|
| Online GMV | €20,000,000 / yr |
| Average order value (AOV) | €80 |
| Orders | 250,000 / yr |
| Gross margin | 55% |
| Online return rate (apparel) | 30% (industry typical 25–35%) |
| Returns | 75,000 / yr |
| Cost per return (reverse logistics + inspection + restock/markdown, excl. lost margin) | €15 |

### 3.2 Two levers

**Top line — conversion + basket size.** Guided, explained discovery converts more engaged sessions (it rescues shoppers who can't translate themselves into filters — see [[customer-experience]] §1), and **outfit completion** lifts AOV ([[tailor-consultation]]). Modelled as: an *adoption* share of orders is discovery-influenced; those get an AOV uplift plus a conversion-attributable revenue uplift.

**Bottom line — returns.** Better situation-matching and the **explained "why this fits" + honest gap beat** set correct expectations before purchase, reducing "this isn't what I expected" returns — the dominant, most expensive failure mode in apparel ([[situation-match]], [[tailor-consultation]]). Modelled as a percentage-point reduction in return rate on influenced orders. Each avoided return saves handling **and** recovers margin that markdowns would otherwise erode (~€12) → ~€27 per avoided return.

### 3.3 Three scenarios

| Lever / assumption | Conservative | Base | Optimistic |
|---|---|---|---|
| Discovery-influenced orders (adoption) | 15% | 25% | 40% |
| Influenced GMV | €3.0M | €5.0M | €8.0M |
| AOV uplift (outfit completion) | +4% | +6% | +8% |
| Conversion-attributable uplift (% of influenced GMV) | +1.5% | +3% | +5% |
| **Top-line incremental revenue** | **€165k** | **€450k** | **€1.04M** |
| — incremental gross profit @55% | €91k | €248k | €572k |
| Return-rate reduction on influenced orders | −2pp | −3pp | −4pp |
| Avoided returns / yr | 750 | 1,875 | 4,000 |
| **Bottom-line savings** (@~€27/return) | **€20k** | **€51k** | **€120k** |
| **Total annual benefit** (gross profit + returns) | **~€110k** | **~€299k** | **~€692k** |

### 3.4 The ratio that matters

Against an annual **AI run cost of ~€150–€1,100**, the modelled benefit is **~€110k–€690k**. The AI inference is **~0.1–0.5% of the value it unlocks** — three orders of magnitude smaller. The decision is therefore never about the AI bill; it's about whether the uplift coefficients hold, which a pilot settles.

---

## 4. How to de-risk the claim (what a pilot measures)

1. **Adoption** — what share of sessions/orders engage discovery vs filters. *Biggest swing factor.*
2. **Conversion lift** — discovery-exposed vs control (clean A/B), not self-reported.
3. **AOV lift** — attach rate + value of outfit-completion add-ons.
4. **Return-rate delta** — influenced vs control orders, by reason code (sizing vs expectation).
5. **Watch-outs / honesty:** don't double-count conversion and AOV (kept separate + conservative here); outfit completion must stay *restrained* or it backfires into returns and annoyance ([[tailor-consultation]]); benefit ramps with adoption and catalogue richness (the merchandiser's [[product-overrides|action loop]] is what raises the ceiling).

---

## 5. Why the economics are structurally good (not a trick)

- **Deterministic core, LLM only for words** → inference cost is tiny and bounded ([[tiered-conversation]]).
- **Enrichment makes the catalogue answer situations** → the value lever exists at all ([[enrichment-layer]], [[vision-enrichment]]).
- **Merchandiser action loop** → the retailer can *raise* the benefit ceiling over time, not just consume a fixed feature ([[product-overrides]], [[enrichment-studio]]).
- **Bolt-in deployment** → low adoption friction; the shopper keeps their store, cart, and checkout ([[deployment-topology]]).

## Related
- [[customer-experience]] · [[use-cases-personas]] · [[tiered-conversation]] · [[situation-match]] · [[tailor-consultation]] · [[enrichment-layer]] · [[deployment-topology]]
