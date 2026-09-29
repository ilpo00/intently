# Case study — Intently

*How I approached an AI product end to end: problem framing, where the value
is, the architecture that makes it safe to ship, and what I measured,
reversed and left honestly unfinished.*

Ilmari Vuorenmaa · 2026

---

## 1. The problem, framed as a business problem

Fashion e-commerce asks shoppers to translate their life into the retailer's
taxonomy: *occasion = cocktail, sleeve = long, pattern = solid*. People don't
think that way. They think *"a garden party, it might get cold later, and I
hate florals."* When the translation fails, two expensive things happen:

- **They leave.** A filter wall offers no path from a situation to a product.
- **They buy the wrong thing.** Online apparel returns run 25–35%, and "not
  what I expected" is the most expensive kind: reverse logistics plus markdown.

So the question I set was not "how do we add AI?" It was: **which capability,
missing from filter-based shopping, would change conversion and returns — and
what is the cheapest, safest way to deliver it?**

## 2. Where AI creates *new* value here

Three capabilities a filter UI structurally cannot have:

| Capability | Why it moves the business |
|---|---|
| **Understand a situation** in the shopper's words, including negation and paraphrase ("my budget died in December") | Removes the translation step, which is where shoppers drop |
| **Ask before guessing**: one or two questions, chosen by information gain over the live inventory | Makes a small shortlist feel earned; mirrors what a good salesperson does |
| **Explain every pick**, and complete the outfit with restraint | Sets expectations *before* purchase (fewer returns); lifts basket size without feeling pushy |

And one capability for the *other* user — the product/catalogue manager — that
turned out to matter as much: a **Studio** where improving the catalogue's
understanding (a vision-read attribute, a curated occasion) visibly improves
what shoppers see. AI value in commerce compounds when the business can steer
it.

The business case is modelled, not measured, and says so: for a €20M-GMV
retailer, **€110k–€690k/yr** of benefit against **€150–€1,100/yr** of AI run
cost ([value proposition](../wiki/concepts/value-proposition.md)). The point
of the model is the method and the order of magnitude: the AI bill is not the
decision. Whether the uplift coefficients hold is, and only a pilot settles
that. The plumbing for that pilot (order webhook, attributed revenue, online
A/B of model configurations) is built.

## 3. Constraints I chose on purpose

- **Local-first, no infrastructure in Phase 1.** In-memory catalogue,
  file-backed vector store, no accounts. It forced every external dependency
  behind an interface before it existed.
- **Keyless by default.** The full product must work, and CI must run, with no
  API keys. Every AI stage is optional.
- **€0 fixed monthly cost** for the cloud demo (Vercel Hobby, Supabase and
  Upstash free tiers); spend only per token, capped.
- **Nothing an LLM says is trusted on its way to a decision.**

## 4. The architecture, and the decision that shapes it

**The engine decides, the LLM phrases** ([ADR-0001](adr/0001-engine-decides-llm-phrases.md)).

The tempting design is an agent with catalogue tools that decides what to
show. I rejected it because it makes the *recommendation itself*
non-deterministic: it can hallucinate stock, be prompt-injected into
recommending anything, and cannot answer a merchandiser's "why did it show
this?".

Instead the LLM gets exactly two jobs: **words in** (free text → a context
patch clamped to a known vocabulary) and **words out** (re-voicing prose the
engine already wrote). Every decision — which question, what to show, ranking,
hard exclusions, outfit completion, cart awareness — is deterministic code.

Three consequences I then had to engineer for:

1. **Cost and latency** — a provider flag made *every* turn pay ~1.5 s. A
   per-turn **complexity gate** now escalates only where the LLM is measured
   to beat the regex parser: negation, long multi-clause briefs, paraphrase
   ([ADR-0002](adr/0002-per-turn-complexity-gate.md)). A global daily cap on
   replica-safe Redis counters makes runaway spend impossible
   ([ADR-0006](adr/0006-replica-safe-guardrails-on-upstash.md)).
2. **LLM output reaching hard filters** — exclusions delete inventory
   silently, so the LLM may only reach them through a deterministic guard
   ([ADR-0003](adr/0003-hard-filters-need-deterministic-guards.md)).
3. **Generated prose making promises** — a deterministic grounding verifier
   rejects prose that names an unshown product or claims an action; the
   template stands ([ADR-0004](adr/0004-deterministic-grounding-verifier.md)).

The other half of the system is **enrichment**: a PIM knows "black dress,
€35", not "suits a garden party, layers well". Claude Haiku reads each product
photo once, offline, behind a schema validator, for about $0.0018 per product
([ADR-0005](adr/0005-offline-vision-enrichment.md)). Every stage — PIM
adapter, embedder, vector store — sits behind a typed interface, which paid
off when moving to serverless: the embedder change was one new class and zero
schema migration ([ADR-0007](adr/0007-openai-embeddings-at-384-on-serverless.md)).

## 5. What I measured instead of assumed

| Assumption | What measurement showed | Consequence |
|---|---|---|
| "DeepSeek for bulk, Claude to verify" | DeepSeek v4-flash defaults to *thinking mode*: ~4 s, a third of calls running away to empty output. Thinking **disabled**: ~1.6 s, reliable | Explicit `thinking: disabled`; provider choice made per stage from latency data |
| The LLM parser is strictly better | Recall 84% → **97%**, but precision 100% → **89%** | Regex-first merge; the LLM fills gaps, never overrides |
| Validating LLM output against the vocabulary makes it safe | First production run: "a black dress" parsed as *exclude black* — a valid value with inverted intent, intermittent | A deterministic inversion guard, plus a design rule: hard-filter fields never share tokens with positive intents |
| The action-claim verifier works | **100%** on phrasings it was tuned on; **~30%** on a held-out set | Recorded as the weakest link, with the architectural fix named (constrain generation) instead of growing the regex list |
| The complexity gate keeps parser misses covered | Every exclusion the regex missed in the eval corpus was escalated | Now an asserted guarantee in CI |

The last two rows came from building the [quality scorecard](../intently/docs/eval-scorecard-latest.md)
for this write-up. Writing the held-out set *before* tuning is what made the
second number honest. The same pass found a code comment describing an LLM
verifier that did not exist, which I corrected. Stale safety claims are worse
than missing ones.

## 6. What I reversed or killed

- **The product domain.** Intently started as MISE, a Japanese-kitchen
  commerce concept. I pivoted it to fashion discovery, kept the architecture,
  and **deleted** the old domain code rather than parking it indefinitely. The
  full record is in [the migration doc](../intently/docs/mise_to_intently_migration.md).
  <!-- ILMARI: add 2–3 sentences in your own words on WHY you pivoted — this is
  the question an interviewer will ask first. -->
- **A scripted demo mode.** It kept the demo safe early on, but it meant two
  code paths drifting apart. I removed it once the live path could fail safe to
  the same deterministic engine.
- **The LLM verifier tier.** It was designed but never built; the concrete
  failure modes were cheaper to cover deterministically. I removed it from the
  design, and now have the data showing where that stops being enough.
- **A styled "atelier" UI direction.** Spiked, reviewed on first screenshots,
  deleted.
- **Hosting the Medusa commerce backend in the cloud.** The monthly cost wasn't
  justified for a demo. Commerce integration stays demonstrable through the
  order webhook, and the full Medusa + storefront setup runs locally.
- **The CLI enrichment batch.** It couldn't run on serverless, so I rebuilt it
  as chunked and resumable, and retired the CLI so the two paths couldn't
  diverge.

## 7. How I worked: an AI-native delivery model

Most of the code was written with Claude Code. I treated that as an
architecture problem too:

- [`CLAUDE.md`](../CLAUDE.md) is the agent's standing operating model:
  conventions, invariants, what is paused, what must never be reintroduced.
- [`wiki/`](../wiki/index.md) is the agent's long-term memory for *why*, kept
  separate from the code, which is canonical for *what*.
- Project **skills** enforce hard rules at the moment of decision: tiered-AI
  first, the tailor voice, and asking before any browser verification.
- [`prodprep.md`](../prodprep.md) is a ledger of "fine for a demo, must change
  for production", re-verified against the code.

The lesson: an agent is fast, but without a written operating model it
reintroduces what you deliberately removed. The documents are the control
surface.

## 8. What production would need

Named, not hidden ([`prodprep.md`](../prodprep.md)):

- Per-user Studio authentication (today: a shared-password edge gate).
- Constrained generation for the re-voicer (the verifier gap in §5).
- Item-level presentation attributes (audience filtering is category-level).
- A pilot with real traffic to replace the ROI model's coefficients with
  measured ones.

## 9. Results, in one table

| | |
|---|---|
| AI cost | ~$0.003 per conversation (modelled); daily hard cap; ~$0.0018 per product enriched |
| Infra cost | €0/month fixed |
| Engine latency | ~0.4 ms p50 / ~1.5 ms p95 per turn (deterministic path) |
| Safety | parsed exclusions honoured 12/12; unshown products in prose rejected 100%; 0 false positives |
| Quality gates | 300+ tests and keyless evals in CI; SAST and secret detection on GitLab |
