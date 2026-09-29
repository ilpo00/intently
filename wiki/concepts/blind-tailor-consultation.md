---
type: concept
status: stable
updated: 2026-07-06
sources: []
tags: [consultation, discovery, audience, gender, body-type, ux-flow, visual-ask]
---

# blind-tailor-consultation

The **audience + build questions with visual selection** (shipped 2026-07-06): on a vague brief, Intently no longer guesses — it asks *who will be wearing it* and *how the cut should sit*, rendered as large sketch tiles in the otherwise-empty desktop canvas. Ilmari's framing: a top-notch tailor reads gender/build/age at a glance; Intently is blind, so it must behave like a **blind tailor** — ask a couple of fast, dignified questions instead of confidently guessing. Extends [[tailor-consultation]]; code in `src/lib/discovery/{consult,attributes,session,prefilter,voice}.ts` + `VisualAsk` in `NextExperience.tsx`.

## What the data can honestly support (checked first)

- **Gender: zero per-item data.** No record in the vision catalogue mentions men/women (verified by regex over all 292). Category is the only honest signal: dress (70) + skirt (20) are women-coded; the other 202 are wearable-by-anyone categories.
- **Build: real support via `silhouette`** (boxy 114, a-line 44, longline 33, fitted 24, tapered 21, wrap/relaxed/…) — genuine tailor logic maps builds to silhouettes.

## The decisions worth remembering

1. **Sketches depict the person; labels speak about the clothes.** The tiles show body sketches (fast to self-identify), but the tap sends fit-language — "easy through the middle", "room in the shoulders", "a trim, close fit", "a generous, easy fit". That's how a tailor talks, it reads kindly in chips/acknowledgments, and it means build tokens ride the existing **preference rails** (no new scalar, no new plumbing — chips, signalCount, LLM vocab, applyAnswer all free).
2. **Audience is a scalar** (`SessionContext.audience: 'women'|'men'|'unisex'|null`), latest-wins, parsed from free text too ("for my husband" → men, no question asked).
3. **'for him' is the one hard line; everything else is soft.** Dress/skirt/heels leave the candidate set for men — the most embarrassing recommendation failure, structurally prevented. 'women'/'unisex'/null exclude nothing (asymmetric on purpose: no per-item gender data means category is the only claim we can act on). **A requested garment overrides**: a man asking for a dress gets dresses.
4. **The 'for her' info-gain asymmetry.** `splitsMeaningfully` requires every substantive option to split the set — but everything is honestly available "for her", so that option carries **no `matches` predicate** (treated like an escape for gain purposes). The question earns airtime through the him/unisex splits. Without this, the audience question could never pass the gate.
5. **Build never excludes and skips accessories** — silhouette-token bias only (+2.5/−1.5, same weights as palette leans); a cap has no cut to sit right. Why-lines only claim fit when the silhouette backs it ("falls easy through the middle").
6. **Escapes are never echoed** (voice fix found by reading eval transcripts): "Noted — I'd rather not say." read as the *tailor* declining. Escapes (empty patch) now get "As you wish." — `AnsweredOption.patch` made visible to voice for this.
7. **Declining ≠ concluding.** "I'd rather not say" is mark-on-ask (never re-asked) but does **not** conclude the consultation — declining gender shouldn't cost the shopper the build/palette questions.
8. **The visual ask lives in the canvas** ("plenty of space on the right" — Ilmari): blocking asks render as `VisualAsk` sketch tiles where the compass hint used to sit; duplicate rail pills hide ≥860px (`.nx-ask--blocking`); mobile keeps inline pills; typing stays open ("or answer in your own words below").

## Flow shape (verified live 2026-07-06)

Vague brief → audience tiles → build tiles → confident reveal (≤2 blocking asks, unchanged budget; palette becomes the sharpener). Gendered-garment briefs skip audience as moot ("a dress" answered it). On the deployed tiered path, DeepSeek re-voices the ask messages while the engine's question choice stays deterministic — faithfulness gate untouched.

## Wise listing (2026-07-06, same session — Ilmari's direction)

"The tailor experience means the list is hand-picked… sunglasses are not clothes… no reason to offer more than a suitable selection." Three engine mechanisms (`engine.ts`):

1. **Clothes briefs scope the primary grid to garments** — accessories (cap/backpack/sunglasses) never pad a clothes brief; they reach the shopper only through the outfit-completion rail, which is the designed cross-sell surface ("upsell done differently than cramming the page"). Carve-outs: kit briefs (activity/outdoor) keep the full mix; an explicitly requested accessory anchors as usual; cart-anchored carry/shade pivots draw unscoped.
2. **Relevance cutoff (`REL_FLOOR 0.5·max`), never slot-filling** — the baseline-scored tail drops instead of padding to 12. A narrow brief can honestly reveal 3 pieces; the voice already frames it ("kept it deliberately tight"). `MIN_SHOW 3` guards the broken-looking 1-piece reveal.
3. **Confidence-scaled cap** — ≥2 signals (e.g. both consultation taps) → 8; the 12-wide shelf is reserved for genuinely-no-information briefs, where breadth *is* the tailor's pick.

Eval fleet after the change: consulted briefs reveal 8; thin briefs 12; a "no black + darker tones" dress brief reveals 3 with the tight-line — curation, not brokenness. **Next (Ilmari's sequence): how shopping continues after the first item is in the cart** — the cart-anchored machinery ([[tailor-consultation]] rule 8) is the foundation.

## Known residual

**Category granularity**: a camisole ranks under 'top' for men (item reads femme, category doesn't say so). Fix path in `prodprep.md`: a vision-enrichment pass adding per-item `presentation` (~$0.50 full catalogue), then item-wise audience filtering. Until then why-lines never claim gender fit, keeping the residual honest rather than wrong.

## Related

- [[tailor-consultation]] — the consultation layer this extends (ask-before-offer, info-gain, escapes)
- [[tiered-conversation]] — the LLM re-voicing that wraps the new prompts
- [[landing-living-preview]] — the landing that feeds this first-message flow
- [[use-cases-personas]] — the blank-box/vague-brief shoppers this serves
