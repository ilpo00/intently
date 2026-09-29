# Feature brainstorm — 2026-07-16

**Mode:** solution ideation + assumption testing, converged. **Framing:** Intently is demo-live
(situational discovery + Studio + analytics, local-first). Primary user: the product/catalog
manager. The question: *what next multiplies the value of what already works?*
This is a brainstorm capture, not a commitment — docs/roadmap.md stays the plan of record.

---

## The lens: the PM's morning

Every idea below was tested against one scenario: *"I open my laptop, 15 new products arrived
from the PIM, and I have 20 minutes for Intently."* Features that don't serve that morning (or
the shopper it ultimately serves) were cut.

## Diverged — the field (10 ideas, deliberately varied)

| # | Idea | One-liner | Size |
|---|---|---|---|
| 1 | **Close the commerce loop** | Medusa order webhook → true purchase conversion lands in analytics (funnel's last step stops saying "not instrumented") | M |
| 2 | **PIM auto-sync + morning digest** | Webhook on product create/update → auto-queue enrichment + index → "15 new products enriched overnight, 2 need attention" email | M |
| 3 | **Query→situation mining** | Mine analytics (top + zero-result queries) → *suggest* new situations & match keywords: "shoppers keep typing 'festival' — create this situation?" One click pre-fills the tuner draft | S–M |
| 4 | **Learned emphasis** | Cart-adds per situation feed back into situation weights (suggested, PM-approved — never silent) | L |
| 5 | **Online A/B for models** | The runtime-config seam already supports per-request overrides — add %-split experiments (model A vs B) with analytics segmented by arm. The bench is offline eval; this is online | M |
| 6 | **Shareable shortlists** | Shopper gets a link to their explained shortlist ("my wedding outfit ideas") — returns sessions, spreads organically | S |
| 7 | **Multi-language comprehension** | The Tier-1 parsers are multilingual already; add language detect + per-language keyword fallbacks. Cheap EU-market win | S |
| 8 | **Catalogue gap report for buyers** | The coverage/readiness score exists — package it as a weekly "what shoppers wanted that we don't stock" export for the buying team. Turns Intently from a search tool into a demand-signal source | S |
| 9 | **Guardrail alerting** | Grounding-rejection spike or acceptance-rate drop → notify the PM (the metric exists; the trigger doesn't) | S |
| 10 | **Cost autopilot** | Auto-recommend (not auto-switch) the cheapest model whose bench quality + live acceptance clears a threshold | M |

**Inversion check** ("how would we make discovery worse?"): hide why products match, ask questions
that don't narrow, let the AI over-promise, make new products invisible for days. Reversals map to:
keep explanations first-class, info-gain-gated questions (built), grounding verifier (built), and
**#2 auto-sync — the biggest reversal not yet built.**

## Converged — the three worth pursuing

### 1. Query→situation mining (#3) — *do first*
The tightest loop in the product: analytics already captures what shoppers type and where they get
nothing; situations are already creatable in one click. Connecting them makes the Studio
self-improving with **zero new infrastructure** (a deterministic miner over the event stream).
- **Riskiest assumption:** query volume clusters into situation-shaped demand (vs. long-tail noise).
- **Cheapest test:** run the miner over the seeded/demo events; if ≥3 sensible suggestions emerge
  from ~200 turns, it works. An afternoon.

### 2. Close the commerce loop (#1) — *do before any sales conversation*
"Session → cart 35%" is a proxy; a buyer will ask "and purchases?" within five minutes. The order
webhook is small (Medusa emits `order.placed`; the event sink exists; migration 0012 extends with
one event type).
- **Riskiest assumption:** host storefronts will let us register a webhook (integration friction).
- **Cheapest test:** wire it in the local Medusa demo stack first — it's the same API the pitch runs on.

### 3. Online model A/B (#5)
Differentiator for the "PMs control the AI" story: bench (offline) + experiments (online) + budget
analytics = a complete model-governance loop no small competitor has. Needs #1/#3-level analytics
maturity first, so third.
- **Riskiest assumption:** enough traffic per arm for significance at demo scale (it won't be —
  frame as "compare live behaviour", not p-values).
- **Cheapest test:** hash sessionId → arm in the route (10 lines), segment the existing analytics by arm.

## Explicitly set aside (and why)
- **#4 learned emphasis** — needs order volume that doesn't exist yet; revisit post-#1 with real data.
- **#6 shareable shortlists** — shopper-side delight, but the current buyer is the PM; park until a
  storefront customer asks.
- **#10 cost autopilot** — automation-of-a-decision before the decision loop (#5) is trusted. Recommend, never switch, until then.
- **Anti-pattern guard:** none of these are feature-parity copies; each traces to an observed gap
  (funnel hole, zero-result list, bench-vs-live blindspot).
