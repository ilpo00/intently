---
type: concept
status: draft
updated: 2026-06-09
sources: [enrichment-layer, vision-enrichment, enrichment-studio, situation-match, product-overrides]
tags: [demo, overview, discovery, vision, enrichment, catalogue, situations, runbook, curate, attention-queue]
---

# demo-solution-overview

The end-to-end Intently demo, as it stands for a **potential-customer pitch** (see [[project-demo-first-phase]]). One sentence: a shopper describes a *situation* and gets a small, **explained** shortlist from a catalogue the system **understood from its photos** — and a merchandiser can see, manage and tune how that catalogue maps to situations, without writing rules. Run it with `intently/scripts/run-demo.sh` (the single canonical launcher — see [[deployment-topology]]).

## The problem & the value

Search breaks the moment a shopper speaks in situations ("something warm for a cold evening") rather than categories. Intently turns flat product data into situational understanding and returns a curated few **with reasons**. Two audiences, one engine:

- **The shopper** gets guided, explained discovery — the consumer overlay.
- **The merchandiser** gets x-ray + control over how the catalogue is understood and matched — the Studio.

## The two surfaces

**Consumer — `/discover`** (describe → understood chips → explained shortlist → refine → cart). The Intently **discovery surface only** — not a storefront. It runs on the **real vision catalogue** via semantic retrieval, and is embedded in the host Medusa storefront as "Shop by situation" (the storefront owns browse + cart + checkout; see [[storefront-plugin]]). Standalone, the same surface is at `/next`:

![Consumer discovery on the real catalogue](../assets/demo-next-discovery.png)

**Merchandiser — the Studio** (`/admin/enrichment/studio`). Opens the black box: provenance, vision enrichment, catalogue management, and the situation tuner.

## The pipeline (how it fits together)

```
PIM / photos
   │  (a real retailer PIM is thin: title, type, colour)
   ▼
Vision enrichment  ── Claude Haiku reads each PHOTO → colour, pattern, material,
   │                  silhouette, formality, seasons, occasions, styleArchetypes,
   │                  discoveryQueries, description   (Tier-0 validator enforces vocab)
   ▼
Catalogue  ── 292 image-backed products (src/lib/catalog/vision-catalog.json),
   │           NEXT_PUBLIC_CATALOG=vision swaps the whole app onto it
   ▼
Enrichment layer  ── embed text → MiniLM vectors → vector store ([[enrichment-layer]])
   ▼
Discovery  ── semantic retrieval + deterministic explain + a SOFT situation bias
   │           ([[situation-match]]); user exclusions are the only hard lines
   ▼
Consumer overlay (/next) + Merchandiser studio
```

Provenance made the gap explicit — **attributes come from the photo, not guesses** ([[enrichment-studio]]):

![Attribute provenance](../assets/studio-provenance.png)

…and the vision layer separates PIM-sourced from photo-derived context ([[vision-enrichment]]):

![Vision enrichment — PIM vs photo](../assets/studio-vision-enrichment.png)

## What the catalogue actually is (vision-derived, n = 292)

The dashboard quantifies the book at a glance. The shape is a casual-wear catalogue with a clear, *demonstrable* gap in formalwear and winter — the measurable version of why "office" and "black-tie" are hard.

**Formality** (1 casual → 5 black-tie)
```
1 very casual   116  █████████████████
2 casual        129  ███████████████████
3 smart casual   44  ██████
4 formal          3  ▏
5 black-tie       0
```
**Category**
```
dress 70 ████████████████████   jacket 53 ███████████████   top 34 ██████████
backpack 29 ████████   cap 27 ████████   shirt 21 ██████   trousers 20 ██████
skirt 20 ██████   sweatshirt 18 █████
```
**Style archetype**
```
relaxed 241 ████████████████████   minimalist 235 ███████████████████
classic 114 █████████   sporty 60 █████   elegant 43 ████   preppy 22 ██
edgy 18 █   romantic 17 █   bohemian 15 █
```
Pattern is ~82% solid; palette is neutral/dark; winter is under-covered (142 vs spring 268).

## Managing the catalogue from multiple flight levels

`/admin/enrichment/studio/catalog` — Overview distributions (above), Segments explorer (category / style / pattern / occasion / formality / season), and the product grid:

![Catalogue management — flight levels](../assets/studio-catalogue.png)

## Tuning how situations match — soft, not rules

`/admin/enrichment/studio/situations` — a PM tunes **soft weights + per-garment emphasis** and watches the catalogue re-rank live, with a per-dimension breakdown. Emphasis re-orders; nothing is filtered (a shopper whose "office" means shorts is still served). Saved overrides feed live discovery. See [[situation-match]].

![Situation tuner](../assets/studio-situation-tuner.png)

## The PM action loop — edit & triage (not just view)

The Studio went from an x-ray (see how the catalogue is understood) to a **scalpel** (act on it). Two surfaces close the merchandiser loop, both as **non-destructive runtime overrides** — the committed catalogue is never mutated; edits live in gitignored `.enrichment/*.json` and re-embed on save (mirrors the situation-overrides pattern). See [[product-overrides]].

**Curate attributes → re-enrich → see the effect.** In a product's Studio detail, a PM edits the discovery-relevant attributes (colour, pattern, occasions, materials, formality, style archetypes, seasons) — *attributes, not rules*. **Save & re-embed** recomposes the embed text, re-vectorises the one product, and shows a **before→after rank** for the discovery probe. The edit reaches **live `/api/discover`** (the same overlay the shopper uses), not just the inspector. An *"edited by curator"* badge marks overridden products; **Revert** restores the catalogue value.

**Needs-attention work queue** — `/admin/enrichment/studio/attention`. The persistent counterpart to the dashboard's transient "needs attention" filter: every product holding back discovery readiness as a worklist, filterable by reason and triage status, with an open-count badge.

![Needs-attention work queue](../assets/studio-attention-queue.png)

Each item offers **Fix** (deep-links into the curate editor and scrolls to it), **Resolve**, and **Dismiss**. The reasons are recomputed server-side over the *override-merged* catalogue each load, so a fix that clears a reason drops the product from the open list **automatically** — the same edit also lifts the Discovery Readiness score on the dashboard. (On the current vision catalogue the discrete reasons — thin occasions, no style/material, unclassified pattern, low confidence — match ~zero products; the catalogue is clean, so the queue is driven by the relative *"weakest situation fit"* lane: the hardest-to-discover bottom ~12%.)

## How to run the demo

```bash
bash intently/scripts/run-demo.sh   # the ONE canonical demo. Needs Docker running.
```

It boots the Medusa storefront (`:8000`, the entry point) with Intently bolted in at `:8000/discovery`, over one shared catalogue + cart, with the **tiered AI on** by default. Discovery reasons over the vision catalogue while products map to Medusa for the shared cart (the article-number bridge in `src/lib/discovery/retrieve.ts`). It refreshes deps, clears the `.next` caches and re-seeds the vector store every run, so you always get the latest source. Full topology + the URLs (store · `/discovery` · `:3017/discovery/admin`): [[deployment-topology]]. (The old standalone `run-demo.sh` / `run-plugin-demo.sh` split was retired 2026-06-15 — one launcher now.)

**Test it yourself — a 5-minute walkthrough**

1. **Shopper** — open `/next`. Describe a situation: *"something warm for a cold evening"*, *"a black dress for a party"*, *"minimalist everyday basics"*. Watch the understood chips, the explained shortlist, and refine to see it re-rank.
2. **Merchandiser cockpit** — open `/admin/enrichment/studio`. Pick a product; read **From data to discovery** (raw → enriched → embed text → vector) and **How these attributes are made** — on the vision catalogue this shows each attribute was read from the *photo* by Claude Haiku.
3. **Curate → see the effect** — on that product, scroll to **Curate attributes**. Add an occasion (e.g. `office`) or raise formality, hit **Save & re-embed**, and read the **before→after rank** on the discovery probe. Re-run the same query in `/next` to confirm it moved. **Revert** to restore.
4. **Work the queue** — open `/admin/enrichment/studio/attention`. Filter by reason/status. **Dismiss** one item, **Fix** another (→ jumps into the curate editor); after a fix that clears its reason, it leaves the **open** list and the dashboard's Discovery Readiness ticks up.
5. **Tune & manage** — `/situations` (soft weights, live re-rank) and `/catalog` (Overview / Coverage / Segments distributions, cohort gaps, readiness score).

Env flags the script sets: `NEXT_PUBLIC_CATALOG=vision` (real catalogue), `DISCOVERY_RETRIEVAL=vector` (semantic), `DISCOVERY_SITUATION=on` (soft situation bias). Re-running vision from scratch: press **Run vision enrichment** in Studio → Catalogue (~15 min, ~$0.55, Haiku), then `node scripts/build-vision-catalog.mjs` to rebuild the committed catalogue. See `intently/docs/running-enrichment.md`. Curator edits + queue triage persist in gitignored `.enrichment/product-overrides.json` and `.enrichment/attention-state.json`; delete them to reset to the committed catalogue.

## Honest scope (demo-first)

- The **292-photo vision catalogue replaces** the Kaggle demo set as the real product source (real images that render; rich attributes incl. the previously-empty fabric/silhouette). The Kaggle set stays as the default fallback.
- **Catalogue gaps are real, not bugs:** ~no formalwear (0 black-tie, 3 formal), winter thin — surfaced by both the situation coverage and the catalogue dashboard. A buying signal, not a matching flaw.
- **Personalization is deferred** to post-customer ([[project-demo-first-phase]]); the situation model is the population prior, and discovery already blends the shopper's own words on top.

## Related

- [[vision-enrichment]] · [[enrichment-studio]] · [[enrichment-layer]] · [[situation-match]] · [[product-overrides]] · [[storefront-plugin]] · [[next-overlay-ux]]
