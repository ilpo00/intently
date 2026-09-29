---
type: concept
status: stable
updated: 2026-06-15
sources: []
tags: [personas, use-cases, shoppers, roles, product-manager, merchandiser, jtbd]
---

# use-cases-personas

Who actually uses Intently, what job they're trying to get done, and exactly which part of the system serves them. Two groups: the **shoppers** (who experience the result) and the **business roles** (who shape it). Read [[customer-experience]] first for the end-to-end narrative; this page is the by-role index into the detail.

> Personas are illustrative archetypes for design and sales conversations, not research segments. They map to behaviours the system was actually built to serve (see [[tailor-consultation]] and the eval personas in `scripts/tailor-personas.json`).

---

## A. Shopper profiles (the people the shortlist is for)

### A1 · "Occasion Rachel" — time-poor, has an event
*"A wedding guest dress, outdoor, and it gets cold in the evening."*

- **Job-to-be-done:** dress correctly for a specific event, fast, without becoming a fashion expert.
- **What serves her:** the situation box and comprehension ([[next-overlay-ux]], [[tiered-conversation]]); the explained shortlist so she trusts the picks ([[situation-match]]); and **outfit completion** — the light layer for the cold evening she didn't think to search for ([[tailor-consultation]]).
- **Where the value lands:** higher conversion (she finds it) + higher AOV (the layer) + fewer returns (it actually suits the event). → [[value-proposition]]

### A2 · "Undecided Sam" — browsing, no firm intent
*"I don't really know… something for the weekend?"*

- **Job-to-be-done:** be guided to something good without a clear starting point.
- **What serves him:** the **consultation** — ask-before-offer A/B questions that narrow the field one tap at a time ([[tailor-consultation]]); guided discovery instead of a blank search.
- **Where the value lands:** rescues sessions that would otherwise bounce; turns "just looking" into a basket.

### A3 · "Specific Priya" — knows what she wants, has constraints
*"A black dress for a party, on a tight budget, no florals."*

- **Job-to-be-done:** get exactly what she asked for, with her hard limits respected.
- **What serves her:** exclusion-safe comprehension (*no florals* becomes a hard filter, safely — [[tiered-conversation]]); the **honesty beat** when the catalogue can't satisfy a request ("no X today, so I've chosen around it") instead of silent substitution ([[tailor-consultation]]).
- **Where the value lands:** trust. Respecting constraints (and admitting gaps) is what makes her come back.

### A4 · "Practical Pavel" — function-first / outdoor
*"Sturdy track pants for the gym", "a rain jacket for day hikes."*

- **Job-to-be-done:** find gear that performs, routed to the right catalogue.
- **What serves him:** catalogue routing (fashion vs outdoor) and the situation model's function/material dimensions ([[situation-match]]); attributes read from the photo, not guessed ([[vision-enrichment]]).
- **Where the value lands:** fewer wrong-product returns — the most expensive kind in apparel.

---

## B. Business roles (the people who shape the experience)

These are Intently's commercial users. The [[customer-experience|Studio]] (`/discovery/admin`) is built for them. The product/catalogue manager is the **primary** group.

### B1 · Product / Catalogue Manager — the primary user
- **Who:** owns product data quality and how products surface. The person whose work most directly moves discovery quality.
- **Job-to-be-done:** make every product *findable for the situations it suits* — and fix the ones that aren't.
- **What they touch:** the **PM action loop** — curate an attribute → re-embed → see the rank change ([[product-overrides]]); the **needs-attention work queue** (Fix / Resolve / Dismiss) of products holding discovery back; per-product **provenance** (photo-read vs text-derived) in the Studio ([[enrichment-studio]]).
- **Key constraint they care about:** exact prices are never rounded — the PIM/Medusa price is shown verbatim. → [[deployment-topology]]
- **What it replaces:** writing and maintaining merchandising rules by hand.

### B2 · Merchandiser / Category Manager
- **Who:** owns how a category is presented and how the brand "dresses" the customer.
- **Job-to-be-done:** encode the brand's point of view — what's formal, what pairs with what, what suits which occasion — without engineering.
- **What they touch:** the **situation tuner** (profiles as editable data, live behind `DISCOVERY_SITUATION`) and the embed-text what-if ([[situation-match]], [[enrichment-studio]]).
- **Where the value lands:** the shortlist reflects *this* brand's taste, not a generic matcher.

### B3 · E-commerce / Digital Lead
- **Who:** owns online revenue, conversion, AOV.
- **Job-to-be-done:** lift conversion and basket size and prove it.
- **What they touch:** the deployment model — Intently bolted into the existing store, shared cart, no rip-and-replace ([[deployment-topology]], [[demo-solution-overview]]); the conversion/AOV levers and the running-cost math ([[value-proposition]]).
- **What they ask:** "what does it cost to run and what's the ROI?" → answered in [[value-proposition]].

### B4 · Customer Experience / Returns Lead
- **Who:** owns satisfaction and the returns P&L line — the most underrated lever in fashion.
- **Job-to-be-done:** reduce "this isn't what I expected" returns.
- **What they touch:** indirectly — the **explained shortlist** and **honest gap beat** set correct expectations before purchase ([[tailor-consultation]], [[situation-match]]); better situation-matching reduces mismatch returns.
- **Where the value lands:** the bottom-line half of [[value-proposition]] — avoided reverse logistics + recovered margin.

### B5 · Buyer / Range Planner
- **Who:** decides what the catalogue should contain.
- **Job-to-be-done:** spot demand the range can't satisfy.
- **What they touch:** the needs-attention queue and catalogue-health surface as a **gap signal** — situations shoppers ask for that the catalogue answers weakly ([[enrichment-studio]], [[product-overrides]]). The honesty beat's "no X today" is, in aggregate, a buying signal.
- **Where the value lands:** assortment decisions grounded in real situation demand.

### B6 · Data / ML Lead (technical evaluator)
- **Who:** vets the architecture before adoption.
- **Job-to-be-done:** confirm the AI is controllable, auditable, and cheap to run.
- **What they touch:** the **engine-decides-LLM-phrases** boundary, the deterministic faithfulness gate and fallbacks, the vocabulary-clamped prompt-injection containment, and the per-conversation cost model ([[tiered-conversation]], [[value-proposition]]); the eval harnesses (`scripts/tailor-eval.eval.ts`, `scripts/parse-eval.eval.ts`).
- **Where the value lands:** a "yes, we can ship this" — natural language with a recommendation the business can stand behind.

---

## C. Use-case quick map (role → surface → detail)

| I want to… | Role | Surface | Detail |
|---|---|---|---|
| Find an outfit for an event | Shopper | `/discovery` | [[next-overlay-ux]], [[tailor-consultation]] |
| Be guided when undecided | Shopper | `/discovery` consultation | [[tailor-consultation]] |
| Make a product findable | Catalogue Manager | Studio → Curate | [[product-overrides]] |
| Fix what's hurting discovery | Catalogue Manager | Studio → Attention queue | [[product-overrides]], [[enrichment-studio]] |
| Tune how we dress for occasions | Merchandiser | Studio → Situations | [[situation-match]] |
| See why a product matches | Anyone | Studio → provenance | [[enrichment-studio]], [[vision-enrichment]] |
| Lift conversion / AOV | E-commerce Lead | (whole flow) | [[value-proposition]] |
| Reduce returns | CX / Returns Lead | (whole flow) | [[value-proposition]] |
| Find assortment gaps | Buyer | Studio → Attention / health | [[enrichment-studio]] |
| Verify the AI is safe + cheap | Data/ML Lead | architecture | [[tiered-conversation]], [[value-proposition]] |

## Related
- [[customer-experience]] — the end-to-end narrative these roles plug into.
- [[value-proposition]] — what each role's lever is worth.
- Standing product priorities behind this framing: the demo-first phase (pitch-ready demo before per-shopper personalization) and PM/catalogue managers as the primary commercial user (recorded in project memory).
