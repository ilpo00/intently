# Intently — customer demo script

A ~12-minute walkthrough for showing Intently to a retailer/e-commerce company.
Two goals, in order: **they viscerally understand the problem** (shoppers live in
situations; stores speak categories), and **they see how you build product**
(research → options → decision → verify → honest gaps). The demo is the live
Vercel deployment; nothing runs on your laptop.

> **Interviewing rather than selling?** (e.g. an AI Architect role.) Keep the
> cold open and Act 1, shorten Act 2 to the model bench + analytics, and swap
> Act 3 for **Act 3B** below: the evidence an architect is judged on. Have the
> repo open on the root `README.md` in a third tab.

---

## Before the meeting (5-minute checklist)

| # | Check | How |
|---|---|---|
| 1 | App is up | Open `https://intently-red.vercel.app` — landing renders, preview card cross-fades |
| 2 | Warm the functions | Submit one throwaway query ("a black dress for a party"), get an answer, click **Start over**. First hit after idle can cold-start ~2s; don't let that be the customer's first impression |
| 3 | Admin works | Open `/admin` in a **second tab**, enter the Basic-Auth password (any username). Confirm the Studio shows **292 products** |
| 4 | Fresh state | Demo in a clean window; the **Start over** button resets the conversation between runs |
| 5 | Know your fallback | If the LLM provider hiccups mid-demo, the engine silently falls back to deterministic replies — **the demo cannot dead-end**. The prose gets more templated; nothing errors. If asked, this is a feature: "the AI is an enhancement layer, never a dependency" |

**Tab layout:** Tab 1 = shopper (`/`), Tab 2 = Studio (`/admin`), Tab 3 (optional)
= the mockup index (`docs/mockups/landing/index.html` locally) for Act 3.

---

## Cold open — the problem (90 seconds, no screen yet)

> "When you shop online, every store gives you the same two tools: a search box
> that matches keywords, and a filter sidebar with someone else's taxonomy.
> But nobody shops like that. Real people have a **situation**: *'I need
> something warm for the evenings on a trip'*, *'a dress for a garden party
> that isn't too formal'*. Today the shopper has to translate their situation
> into the store's categories — and when the translation fails, they bounce.
>
> Intently flips the translation: the shopper describes the situation in one
> sentence, and the store answers like a good salesperson would — a **curated
> few, each with the reason it fits**. Not 300 results. Not zero results.
> And when something isn't in stock, it says so honestly and dresses around it."

If they nod here, the demo is already working.

---

## Act 1 — the shopper (4 minutes, Tab 1)

**Beat 1 — the landing (30s).** Don't type yet. Point at the two panes:

> "First impression: the input is the store. And on the right — that's not a
> stock photo, it's a live example of what an answer looks like: the situation
> understood, the best match, and *why* it fits. We show the payoff before
> asking the shopper to invest a word."

Mention (if the audience is product-minded): the rotating placeholder in the
input is teaching shoppers *what kind of sentence works* without a tutorial.

**Beat 2 — the blind tailor's consultation (90s).** Type:

```
Something warm for a cold evening
```

The tailor doesn't dump products — and **watch the right pane**: the question
appears as large sketch tiles. First: *"Who will be wearing it?"* with
tailor's line sketches (and a respected "I'd rather not say"). Tap **for
him**. Then: *"How should the cut sit? Point at the sketch that's closest."*
— four body sketches whose labels speak about the *clothes* ("easy through
the middle"), not the person. Tap one.

> "A tailor on the shop floor reads gender and build the second you walk in.
> Software is blind — so instead of guessing, it asks, the way a blind tailor
> would: two taps, visual, and you can decline. And it only asks questions
> whose answer genuinely changes the result — every option is checked against
> the live catalogue before it's allowed to appear."

If the audience is product-minded, point out what "for him" just did: the
dresses and skirts left the candidate set — the single most embarrassing
recommendation failure in fashion e-commerce, structurally prevented.

Point at the green **understood chips** as they accumulate: "That's the
contract — the shopper always sees what the system believes, and can remove
any of it with one tap."

**Beat 3 — the explained shortlist (60s).** The reveal — typically **8
hand-picked pieces** after a consultation, and *only clothes*: no cap or
backpack padding a clothes brief (accessories arrive, if at all, through the
"complete the look" rail below, where the context earns them). Read one
**why-line** aloud — it references the shopper's own choices ("falls easy
through the middle", "sits in the deeper tones you asked for").

> "Notice what's *not* here: filler. A catalog page pads to a grid; a tailor
> puts a few things on the counter. When the brief is narrow the list gets
> *smaller* — you might see three pieces and the line 'kept it deliberately
> tight — only what truly fits.' That's a feature, and it's the honest
> opposite of how ecom search behaves."

> "Every product earns its place with a sentence. That sentence is generated
> against the product's *actual attributes* — the system is not allowed to
> claim anything the data can't back."

**Beat 4 — refine + honesty (60s).** In the refine bar, type:

```
something more affordable
```

Watch the in-place re-rank (kept items settle, new ones enter). Then the
honesty beat — type:

```
jeans for the office
```

> "No jeans in this collection — and it *says so*, once, then dresses around
> it. Silent substitution is how you lose a customer's trust; honest scarcity
> is how a good salesperson behaves."

Add something to the cart to show exact PIM prices carry through (**never
rounded** — €49.99 is €49.99).

---

## Act 2 — under the hood: the Studio (3 minutes, Tab 2)

Transition line:

> "Everything you just saw depends on one unglamorous thing: **product data
> that actually describes the product**. That's the real moat, and this is
> the workbench for it. The user here isn't the shopper — it's your catalogue
> team."

**Beat 1 — the pipeline (45s).** Walk the mental model left-to-right: *your
PIM → an enrichment text per product → an embedding → a search index →
discovery*. Every arrow is a swappable interface — "we plug into the PIM you
already have; we don't ask you to migrate anything."

**Beat 2 — one product, no secrets (60s).** Open any product. Show raw PIM
fields vs enriched attributes vs the **exact text the model sees** (the embed
text).

> "No black box. A merchandiser can read precisely what the AI was told about
> this product — and when discovery does something odd, this page is where the
> answer is."

**Beat 3 — live semantic search (45s).** In the search debug, type a phrase
that shares no keywords with the products — e.g. `warm jacket for a cold
evening` — and show bomber jackets coming back with similarity scores.

> "No keyword overlap — it matched on *meaning*. That's the retrieval layer
> discovery stands on when the catalogue grows past what rules can rank."

> ✅ **Verified live (2026-07-06):** this beat runs on the deployed Studio —
> OpenAI-embedded store (292 products, 384-dim) in Supabase, query embedding
> on Vercel. The **Sync from PIM** button also works deployed now (~5s for
> the full catalogue, costs ~$0.0004), so you can even re-sync live if asked.

**Beat 4 — situations (30s).** Show the situations tab: how "office",
"wedding", "hike" are editable *data profiles* a merchandiser can tune, not
code.

> ⚠️ Skip the save/curation buttons in the deployed demo — durable storage for
> curator edits is a known, tracked gap (it lands with the ops database). If
> asked: "curation persists locally today; the cloud store is on the list —
> we track every gap like this openly."

---

## Act 3 — how this was built (2 minutes, the product-thinking showcase)

This is where you differentiate *yourself*, not just the product. Three
artifacts, 40 seconds each:

1. **Decisions start with users, not features.** Show (or describe) the
   landing-redesign work: five shopper situations from research (the filter
   refugee, the blank-box freezer…), **three annotated mockups** built to
   compare directions on the axis that mattered — how much the screen does
   before the shopper acts — and the losing options kept, with reasons, in
   the project wiki. "I keep the rejected options; the reasoning is the asset."

2. **Deterministic first, AI where it earns its place.** The whole demo runs
   with zero LLM calls if it has to — the AI layer *re-voices and
   comprehends*, but the engine's decisions are deterministic code, testable
   and instant. Where LLMs are used, it's the cheap bulk provider with a
   verification gate, and every call sits behind rate caps and daily budgets.
   A full conversation costs about **$0.003**; embedding the entire catalogue
   costs **under one cent**. "The unit economics were designed before the
   first API call."

3. **Honest engineering ledger.** There's a file in the repo (`prodprep.md`)
   listing everything that's demo-grade versus production-grade — concurrency
   races, persistence gaps, auth stubs — each with the planned fix. "You'll
   never have to discover my shortcuts; they're documented before you ask."

Close:

> "So that's Intently: shoppers describe situations, your catalogue answers
> with reasons, your merchandisers keep control of the data underneath — and
> the whole thing runs on unit economics measured in tenths of a cent. What
> I'd want from a pilot is one slice of your real catalogue and four weeks."

---

## Act 3B — the architect's version (3 minutes, repo tab)

1. **The one decision** (40 s) — open `docs/adr/0001`. "The engine decides,
   the LLM phrases. I rejected the agent-with-tools design because it makes
   the recommendation itself non-deterministic: it can invent stock, be
   injected, and can't answer 'why did it show this?'"
2. **The production bug that became a rule** (40 s) — `docs/adr/0003`: "a black
   dress" parsed as *exclude black*. Valid value, inverted intent, intermittent.
   "Vocabulary validation can't catch intent. Hard filters now only take LLM
   output through a deterministic guard."
3. **Measured, including against myself** (60 s) — open
   `intently/docs/eval-scorecard-latest.md`. Exclusions 12/12, grounding 100%,
   zero false positives; then point at the row that looks bad: the action-claim
   guard is 100% on its tuned set and ~30% held-out. "That's why I wrote a
   held-out set before tuning. The fix isn't more regex; it's constraining
   what generation is allowed to write." Then the parse eval: the LLM lifts
   recall 84 → 97% and costs precision 100 → 89%, which is why the merge is
   regex-first.
4. **How I work with AI agents** (40 s) — `CLAUDE.md` + `wiki/` + skills: "the
   agent is fast, but without a written operating model it reintroduces what
   you deliberately removed. The documents are the control surface."

---

## Q&A ammunition

- **What does it cost to run?** ~$0.003 per conversation (DeepSeek
  comprehension + generation), <$0.01 to embed a full catalogue (OpenAI,
  384-dim), Vercel Hobby + Supabase free tier = €0 infra at demo scale.
  Caps at three layers: per-IP rate, global daily LLM budget, provider-side
  monthly spend cap.
- **What if the LLM goes down / rate-limits?** Automatic, silent fallback to
  the deterministic engine — same products, same shortlist, more templated
  prose. Zero-downtime degradation by design.
- **How does it get our products?** A `PimAdapter` interface — the demo runs
  an in-app catalogue; a Medusa REST adapter already exists; writing one for
  your PIM is the pilot's week one.
- **Scale?** Ranking is deterministic and instant at hundreds of products;
  the vector path (pgvector) is already wired for when a catalogue is too
  big for rules — the demo Studio's semantic search *is* that path.
- **Personalization?** Deliberately Phase-2 — the account layer is designed
  (schema exists) but a demo shouldn't fake personal data. Today's system is
  session-scoped by design.
- **What's demo scaffolding vs real?** Honest list: checkout is a stub (no
  payments); catalogue is 292 fashion items; admin auth is a shared password;
  curator edits persist (Supabase `runtime_kv`) but last-write-wins with no
  per-user audit. Everything else — the engine, the pipeline, the Studio, the
  AI tiering — is the real code path.

### Architect-level questions

- **Why not an agent / RAG with the LLM choosing products?** Auditability,
  injection and hallucinated stock (ADR-0001). The vector store *is* RAG-shaped
  retrieval, but it narrows candidates; deterministic code reasons over them.
- **How do you know it works?** Three eval harnesses in CI, keyless: comprehension
  accuracy, persona conversations (≤ 2 questions, no dead ends), and a
  safety/cost scorecard. Numbers are in `intently/docs/*-latest.md`.
- **What's the weakest part?** The action-claim guard generalises poorly
  (~30% held-out). Blast radius is small because generation is off by default and
  bounded by the faithfulness gate. The fix is structured generation.
- **Prompt injection?** Structural, not a filter: parser output is clamped to
  the shopping vocabulary; raw shopper text never reaches the re-voicer; the
  LLM can't choose products. Worst case is wrong-but-valid shopping values.
- **What changes at 10× the catalogue / traffic?** Deterministic ranking stays
  sub-millisecond at hundreds of products; retrieval moves to the pgvector path
  (built). Guardrail counters are already replica-safe (Upstash). Enrichment
  cost scales linearly (~$20 per 10k SKUs).
- **Vendor lock-in?** Provider per stage is an env var (DeepSeek / Claude
  Haiku / OpenAI); embedder and vector store sit behind interfaces. Mapping to
  Azure OpenAI + AI Search or Bedrock + OpenSearch is an adapter, not a redesign.

---

## Landmines — do not do these live

| ⚠️ | Why |
|---|---|
| **No outdoor/hiking queries** ("hiking boots", "trail gear") | The vision catalogue is fashion-only; outdoor routes to an empty set. "Warm for a cold evening" is fine — it resolves to layers/knits |
| **Re-verify before using curation Save live** | Written when curation had no cloud store; since 2026-07-17 it persists via the doc-store (Supabase `runtime_kv`). Try it once in rehearsal; if it works, it is a *strong* live beat (curate → re-embed → discovery changes) |
| **Re-verify the Studio "Vision" tab** | Written before vision enrichment was rebuilt for serverless (2026-07-18, Supabase `vision_records`). Check it shows data in rehearsal; if empty, show vision results on a product page instead |
| **Don't refresh mid-conversation** | Session context is in-memory by design (Phase-1); a refresh starts over. Use **Start over** deliberately instead |
| **Don't invent prices** | Read prices off the cards; they're exact PIM values on purpose |

## Known-good query bank (all verified against the live engine)

| Query | What it demonstrates |
|---|---|
| `Something warm for a cold evening` | The blind tailor: audience sketch tiles → cut sketch tiles → shortlist |
| `A black dress for a party` | Garment anchor + occasion; audience skipped as moot, cut question with sketches |
| `Relaxed minimalist everyday basics` | Preference parsing; one audience ask, then straight to the shortlist |
| `a jacket for my husband` | Typed audience — parsed without asking; no dress/skirt ever appears |
| `something more affordable` (refine) | In-place re-rank choreography, price ordering |
| `nothing with a print` (refine) | Exclusion honoured + acknowledged |
| `jeans for the office` | The honesty beat (unstocked garment named once, dressed around) |
| `it'll be cold in the evenings` (refine after a dress) | Outfit completion — a layer offered *over* the dress, not warmer dresses |

**Tiered AI is live on the deployed URL** (DeepSeek comprehension +
re-voicing, verified 2026-07-05): prose reads natural rather than templated,
and paraphrase works — *"I always end up freezing at dinner parties outside"*
correctly resolves to outdoor + cold evenings. Expect ~2–4s per turn (the
LLM round-trips); if the provider ever hiccups, the silent deterministic
fallback keeps the identical flow with more templated wording.
