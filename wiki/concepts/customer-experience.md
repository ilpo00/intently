---
type: concept
status: stable
updated: 2026-06-15
sources: []
tags: [experience, overview, start-here, shopper, merchandiser, narrative]
---

# customer-experience

**Start here.** This page explains every component of Intently *in the order a person meets it* — first the shopper, then the business user — and, for each, what they experience and **why that component has to exist for the experience to work**. It is the map; the linked pages are the territory.

Intently has two audiences. The **shopper** never sees any of the machinery — they describe a situation and get a small, explained shortlist. The **merchandiser / product manager** sees and tunes the machinery — they shape how the catalogue maps to situations without writing rules. The whole system is built so the second group's work visibly improves the first group's experience.

---

## Part 1 — what the shopper experiences

### 1. "Tell me what you're dressing for" — the invitation

The shopper lands on **Shop by situation** (`/discovery`, bolted into the store) instead of a wall of filters. They type a *situation* in their own words: *"a black dress for a party, might get cold later"*, *"sturdy trousers for the gym"*, *"something for a rainy festival weekend, I hate florals."*

- **What it is:** the discovery surface — its own header, conversation thread, results canvas, and (when embedded) the store's shared cart. → [[next-overlay-ux]]
- **Why it matters:** filters force the shopper to translate their life into the retailer's taxonomy ("occasion = cocktail, sleeve = long, …"). Most shoppers can't, so they bounce. A situation box meets them where they are. The whole product is this inversion.

### 2. "It actually understood me" — comprehension

The free-text situation becomes a structured, validated context: occasion, formality, season, constraints (*cold evening*, *budget*), and **exclusions** (*no florals*). Messy phrasing — *"my budget died in December"*, *"I hate florals"* — is understood, not pattern-matched.

- **What it is:** **Tier-1 comprehension** — DeepSeek turns free text into a context object, clamped to a known vocabulary, with the deterministic regex parser as a fail-safe. → [[tiered-conversation]]
- **Why it matters:** without real language understanding, anything outside a keyword list silently parses to nothing and the "tailor" illusion collapses on the first unusual sentence. This is the layer that makes the conversation feel like a person, not a search box. Crucially, the LLM owns the *words in*; it never decides what to *show* (see §6).

### 3. "It asked before it guessed" — the consultation

When the situation is under-specified, Intently asks **one or two** sharp questions — often *A or B* options the shopper taps — before offering anything. The questions are always forward-moving and never repeat.

- **What it is:** the **tailor consultation** — info-gain-gated questions chosen against the live candidate set, ask-before-offer restraint, A/B options that converge with typed text. → [[tailor-consultation]]
- **Why it matters:** a good salesperson narrows before they pitch. Asking the *right* question (the one that most splits the remaining inventory) is what makes the shortlist feel earned rather than random. The *decision* of which question to ask is deterministic and auditable; only its wording is LLM-voiced.

### 4. "These are right, and here's why" — the explained shortlist

The shopper gets a small set (not 200 results) of products, **each with a one-line reason it fits the situation**. The prose reads like a person wrote it, not a template.

- **What it is:** the deterministic engine ranks candidates and emits a *generation spec*; **Tier-1 generation** (DeepSeek) re-voices the reasons faithfully, with a deterministic faithfulness gate and a template fallback. → [[tiered-conversation]], [[situation-match]]
- **Why it matters:** an unexplained recommendation is just another product grid. The *"why this fits"* is the trust mechanism — it's what turns a list into advice, and it's what reduces the "this isn't what I meant" returns (see [[value-proposition]]).

### 5. "Don't forget the jacket" — outfit completion

Alongside the shortlist, Intently offers a restrained **"complete the look"** rail — a light layer for the cold evening, shoes for the dress — context-justified and never pushy. It also honours what's already in the cart: a dress you already added won't be re-offered; "it gets cold later" pivots the help toward layers.

- **What it is:** outfit-completion slots (layer / pair / carry / shade) + cart-aware context. → [[tailor-consultation]] (outfit completion section)
- **Why it matters:** people buy outfits, not garments. Thoughtful completion lifts basket size *and* satisfaction — but only if it's restrained; a bad or pushy add-on makes customers angry. The engine's restraint rules are the guardrail; the LLM only phrases the suggestion.

### 6. The non-negotiable underneath it all: **the engine decides, the LLM phrases**

Every recommendation, question, exclusion, rank, and add-on is a **deterministic** decision the team can audit and reproduce. The LLM is confined to comprehension (words in) and prose (words out). → [[tiered-conversation]]

- **Why it matters:** this is what makes the advice *trustworthy and safe to ship*. An LLM that decides what to sell can hallucinate inventory, invent attributes, or be talked into anything by a crafted prompt. By keeping the LLM out of the decisions, Intently gets natural language *and* a recommendation it can stand behind. It's also why the AI bill is tiny (see [[value-proposition]]): the cheap part (deterministic code) does the heavy lifting; the model is only ever phrasing.

---

## Part 2 — what makes the shortlist possible (the parts the shopper never sees)

The shopper's experience in Part 1 is only as good as the catalogue understanding underneath it. A standard PIM (product information system) knows a product's name, price, and a colour field. That is not enough to answer *"rainy festival weekend."*

### 7. Rich context on top of the PIM — the enrichment layer

The **enrichment layer** adds rich, situation-relevant context on top of standard PIM product data — then makes it semantically searchable. This is exactly what makes relevant discovery possible; without it, *"something for a cold seaside evening"* has nothing to match against.

- **What it is:** PIM → compose an embed text → embed (MiniLM, in-process, no key) → vector store → semantic search. Every box swappable behind a typed interface. → [[enrichment-layer]]
- **Why it matters:** discovery quality is bounded by how well each product is described. The embed text is the single most tweakable knob in the whole match pipeline. "Vector narrows the catalogue; the deterministic engine reasons over the candidates."

### 8. Reading the clothes from their photos — vision enrichment

Most of the situation-relevant signal isn't in the PIM at all — it's in the photo. Vision enrichment looks at each product image and extracts colour, pattern, materials, silhouette, **occasions**, style archetypes, and natural-language **discovery queries**.

- **What it is:** Claude Haiku reads each product photo behind a deterministic validator; cached, offline-batched. → [[vision-enrichment]]
- **Why it matters:** it is the difference between a catalogue that knows *"black dress"* and one that knows *"black dress, good for a garden party or a seaside evening, smart-casual."* That second catalogue is what answers a situation. This is where the richness in §4 actually comes from.

### 9. How people dress for a situation — the situation model

Beyond matching attributes, Intently has a soft model of how people actually dress for occasions — formality, garment fit, materials, season — that **biases** ranking toward sensible choices without ever hard-excluding.

- **What it is:** a per-dimension weighted scorer; profiles are *data*, curator-tunable, behind `DISCOVERY_SITUATION`. → [[situation-match]]
- **Why it matters:** it encodes the tacit "you don't wear that to a wedding" knowledge that makes the shortlist feel like advice from someone with taste, not a literal keyword match.

---

## Part 3 — what the business user experiences (the Studio)

The merchandiser / product manager is the person who makes Part 2 good — and the [[use-cases-personas|primary commercial user]] of Intently. They work in the **Studio** (`/discovery/admin`).

### 10. "Show me how the black box works" — the enrichment Studio

The Studio opens the black box: a pipeline ribbon, catalogue-health, and per-product the full chain **raw → enriched → embed text → vector**, a quality score, a live discovery preview, and **mode-aware provenance** (was this attribute read from the photo by Claude, or derived from text?).

- **What it is:** the merchandiser workspace. → [[enrichment-studio]]
- **Why it matters:** trust and control. A merchandiser won't stake the catalogue on a system they can't inspect. The Studio is the "honest internals" view that makes the AI legible to a non-engineer.

### 11. "I fixed it, and discovery changed" — the PM action loop

The PM curates an attribute (add an occasion, raise formality), hits **Save & re-embed**, and **sees the discovery ranking change** — plus a persistent *needs-attention* work queue (Fix / Resolve / Dismiss) of the products holding discovery back.

- **What it is:** non-destructive runtime overrides merged at every read seam, reaching live discovery. → [[product-overrides]], [[enrichment-studio]]
- **Why it matters:** this is the merchandiser's whole job-to-be-done — curate → see the effect → move on — as a tight, visible loop. It's how human taste enters the system without anyone writing a rule, and the feedback ("the rank moved") is what makes the work feel worthwhile. → [[use-cases-personas]]

### 12. "Tune how we dress the customer" — the situation tuner

The PM edits the situation profiles (the §9 weights) as **data**, in the Studio, and watches the bias change — no code, no deploy.

- **What it is:** the situation tuner. → [[situation-match]], [[enrichment-studio]]
- **Why it matters:** every retailer dresses its customer differently. The tuner is how a brand's point of view becomes the engine's bias.

---

## Part 4 — how it's all delivered

The customer (shopper) enters through the **store** they already know; Intently is bolted in, sharing one catalogue and one cart.

- Store `:8000` → discovery `:8000/discovery` → Studio `:3017/discovery/admin`. One launcher (`run-demo.sh`), the tiered AI on by default. → [[deployment-topology]], [[demo-solution-overview]]
- **Why it matters:** Intently is an *enhancement to an existing store*, not a rip-and-replace. The shopper keeps their cart and checkout; the retailer keeps their stack. That's what makes it adoptable.

---

## Where to go next

- The people who use all this, by role: [[use-cases-personas]]
- What it's worth (and what it costs to run): [[value-proposition]]
- The deepest single idea: **engine decides, LLM phrases** → [[tiered-conversation]]
- Everything older than this page (the retired MISE "river", the parked account/chat layer) is quarantined under *Historical* in [[index]] — it does not describe the system a customer meets today.
