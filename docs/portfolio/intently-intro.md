# Intently — portfolio intro (DRAFT)

> **Status: draft, written by Claude for Ilmari to approve or rewrite.**
> Nothing here is published as Ilmari's own words until he says so. The
> portfolio site keeps it `draft: true` until then.
>
> Rules followed: first person, plain, short sentences, no buzzwords. Every
> figure carries a status — **Measured**, **Estimated** or **Hypothesis** — with
> where it comes from.

---

## Title

Intently — shopping by situation

## One line (card / link preview)

People shop for a situation, not a category. I built a working system that answers the situation and explains its picks.

## Intro (≈120 words)

Online shops ask you to think in their categories. People think in situations: a garden party, it might get cold, nothing floral.

I built Intently to answer that directly. You describe the situation. It asks one or two questions if it needs to, then shows a short list and says why each piece is there.

The design decision I care most about: the language model never decides what to recommend. Ordinary, testable code chooses, ranks and excludes. The model only reads your words and phrases the answer. That is why I can explain any recommendation, and why the running cost stays small.

It runs in the open. You can use the shopper view and the admin Studio behind it yourself.

## Three points (problem / idea / evidence)

- **The problem.** Filters make the shopper translate their life into the shop's taxonomy. When that fails they leave, or they buy the wrong thing and send it back.
- **The idea.** The engine decides, the language model phrases. Every AI step can fail and the product still works, because the plain code underneath is complete on its own.
- **The evidence.** The checks run automatically on every change, and the weak spots are written down next to the strong ones.

## Figures (use any, keep the status label with the number)

| Figure | Status | Source |
|---|---|---|
| Stated exclusions ("no florals") respected in every tested brief the parser understood: 12 of 12 | **Measured** | `intently/docs/eval-scorecard-latest.md` |
| Prose naming a product that was not shown is rejected: 26 of 26 attempts | **Measured** | same |
| Correct prose wrongly rejected: 0 of 208 | **Measured** | same |
| A guard against the model promising actions ("I've ordered it") catches 100% of phrasings it was tuned on, about 30% of new ones | **Measured** — and the reason the next step is to restrict what the model may write, not to add rules | same |
| Adding the language model raises how many stated constraints are understood from 84% to 97%, and lowers precision from 100% to 89% | **Measured** (30 hand-labelled phrasings) | `intently/docs/parse-eval-latest.md` |
| Engine decision time: about 0.4 ms typical, 1.5 ms at the slow end | **Measured** (local run) | scorecard |
| AI cost per conversation: about $0.003 | **Estimated** from prompt sizes and list prices | `wiki/concepts/value-proposition.md` |
| Reading one product photo to enrich the catalogue: about $0.0018 | **Estimated** from measured token counts and list prices | `wiki/concepts/vision-enrichment.md` |
| Hosting cost of the demo: €0 per month fixed | **Measured** (free tiers) | `intently/docs/cloud-demo-plan.md` |
| Business benefit for a €20M retailer: €110k–€690k per year | **Hypothesis** — a model with stated assumptions; only a pilot can confirm it. Label as "Illustrative example" if shown. | `wiki/concepts/value-proposition.md` |

## Buttons

- Primary: **Want to see it yourself?** → the public demo (URL when live; see `handoff.md`)
- Secondary: **Watch the 3-minute tour** → the video
- Text links: **Read how I built it** → `docs/case-study.md` on GitHub · **Source** → https://github.com/ilpo00/intently

## One sentence to put next to the demo button

It is a sandbox: what you change in the Studio stays in your own browser session, and the expensive AI actions are switched off.

## Why Intently exists (Ilmari's words, lightly edited)

MISE was my first project: combining recipes with the kitchen tools they need.
It taught me how much depends on context — knowing what goes together in the
real world. Intently came from the next question: how can we enrich product
data using pictures? That needed a picture-heavy catalogue, so I took the
conversational side into a clothes shop.
