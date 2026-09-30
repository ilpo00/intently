# Intently tour — storyboard and narration (DRAFT)

> **Status: draft for Ilmari.** The narration is written in the first person for
> you to record; change any line that doesn't sound like you. Footage is
> produced by scripted browser runs (`intently/e2e/video/`), so every take is
> identical and can be re-shot after a wording change.

> **Current cut (2026-09-30): the short tour, 1:14, subtitled, no voice-over.**
> One continuous take against https://intently.ilmarivuorenmaa.com
> (`intently/e2e/video/tour.scene.ts`): a brief, one adjustment, a correction
> in the Studio, and a second adjustment in the same conversation that shows
> the corrected dress gone. The older seven-scene cut and the narration below
> remain for reference (`VIDEO_TOUR=long`).

| At | Subtitle |
|---|---|
| 3.4 s | A shopper describes a situation, in their own words. |
| 10.9 s | Then a short list — each piece with the reason it fits. |
| 17.9 s | Adjust it in plain words. |
| 20.9 s | The list re-ranks in place: red first. |
| 26.4 s | The Coral Red Maxi Dress is listed as a solid colour. |
| 31.4 s | Behind the shop: the Studio, where the catalogue is curated. |
| 38.2 s | A merchandiser corrects one attribute: the pattern. |
| 43.2 s | Pattern: “solid” → “floral”. |
| 48.1 s | Saved — for this visitor only. |
| 52.6 s | Back in the same conversation — remember: “no florals”. |
| 60.2 s | The Coral Red Maxi Dress is gone — it is floral now. |
| 64.7 s | One correction in the Studio. The answer changed. |

---

**Target:** about 3 minutes · 1920×1080 · 16:9 · mp4 around 25 MB or less ·
poster PNG and captions (`.vtt`) as separate files.

**Audience:** an architect or business-unit lead at a consultancy, deciding in
three minutes whether this person thinks clearly and builds properly.

**One idea the viewer should leave with:** *the code decides, the language
model only phrases — so the recommendations can be explained, tested and
afforded.*

Narration is about 400 words, roughly 135 words a minute. Times are targets;
the footage holds on each beat long enough to be trimmed to the voice.

---

## Scene 1 — The problem (0:00–0:22)

**On screen:** the Intently landing. The input's placeholder cycles through
situations. Nothing is clicked for the first few seconds.

**Caption:** People shop for a situation. Shops ask for a category.

**Narration:**
> Online shops ask you to think in their categories. Occasion, sleeve length,
> pattern. People don't think like that. They think: a party, it might get
> cold later. I built Intently to answer that sentence directly.

**Action:** type *"A black dress for a party, it might get cold later"*, press
Enter.

---

## Scene 2 — It asks, then explains (0:22–1:10)

**On screen:** the conversation. The reply acknowledges what it understood. A
question appears with sketch tiles; one is tapped. The shortlist fills in.

**Caption:** One or two questions. Then a short list, with reasons.

**Narration:**
> It doesn't guess. When the brief is thin, it asks one or two questions, and
> it picks the question that splits the remaining stock most usefully. Then it
> shows a short list, not two hundred results, and each piece comes with the
> reason it is there.

**Action:** tap the first cut option. Hold on the shortlist. Slow scroll over
two cards so the "why this fits" lines are readable. Hold on the "complete the
look" rail.

**Narration (over the rail):**
> Because I said it might get cold, it offers a layer to go over the dress. It
> does not push. Two groups at most, and only when the situation gives a reason.

**Action:** type the refinement *"nothing with a print"*. The grid re-ranks in
place.

**Caption:** A stated exclusion is a hard rule. It is never broken.

---

## Scene 3 — The part the shopper never sees (1:10–2:00)

**On screen:** the Studio. The public-demo banner is visible at the top.
Open one dress. Show the panel that separates what came from the product data
and what was read from the photo.

**Caption:** The Studio: where the business steers it.

**Narration:**
> This is what makes the answers possible. A product record says "black dress,
> thirty-five euros". That cannot answer "a cold evening". So each product photo
> is read once, offline, and the result is checked by code before it is stored.
> A merchandiser can correct it here.

**Action:** in the curate editor, change the dress's pattern to *floral*. Save.
The message confirms it was saved to the session.

**Narration:**
> Watch what a single edit does. I mark this dress as floral.

**Action:** go back to the shopper view. Type *"a dress for a garden party, no
florals"*. The edited dress is absent from the shortlist.

**Caption:** One edit in the Studio. The recommendation changes.

**Narration:**
> And it is gone from a "no florals" request. In this public version that edit
> lives only in my own session. Nobody else sees it.

---

## Scene 4 — Where the language model sits (2:00–2:35)

**On screen:** the model bench. One sample query, two providers side by side:
the parsed context, the engine's answer, the re-voiced prose, the grounding
verdict.

**Caption:** The code decides. The model only phrases.

**Narration:**
> Here is the rule the whole thing is built on. The language model never
> chooses what to recommend. Plain, testable code chooses, ranks and excludes.
> The model reads your words and phrases the reply. If it names a product that
> was not shown, or promises something the shop cannot do, its text is thrown
> away and the plain version is used. Simple requests never reach a model at
> all, which is why a conversation costs a fraction of a cent.

---

## Scene 5 — Evidence, including the weak spot (2:35–3:05)

**On screen:** the quality scorecard on GitHub. Highlight three rows in turn:
exclusions honoured, unshown products rejected, and the held-out row.

**Caption:** Measured on every change.

**Narration:**
> I measure it on every change. Exclusions honoured: twelve of twelve. Invented
> products rejected: all of them. And one number I am not proud of: the guard
> against the model making promises catches everything it was tuned on, and
> about a third of phrasings it has never seen. I would rather show you that
> than hide it. The fix is to limit what the model is allowed to write.

**On screen (last 4 seconds):** title card — *Intently · try it yourself* and
the demo URL.

**Narration:**
> It is open. Try it.

---

## Figures spoken in the narration, with status

| Spoken | Status | Source |
|---|---|---|
| "twelve of twelve" exclusions | Measured | `intently/docs/eval-scorecard-latest.md` |
| invented products rejected, "all of them" (26 of 26) | Measured | same |
| "about a third" of unseen promise phrasings caught (~30%) | Measured | same |
| "a fraction of a cent" per conversation (~$0.003) | Estimated | `wiki/concepts/value-proposition.md` |
| "thirty-five euros" | Illustrative example | — |

## Shot list (what the scripts record)

| Clip | Spec | Length (raw) |
|---|---|---|
| `01-landing` | landing idle, type the brief, submit | ~25 s |
| `02-consult-shortlist` | question → tap → shortlist → rail → refine | ~55 s |
| `03-studio-curate` | Studio, product detail, curate pattern, save, shopper re-query | ~55 s |
| `04-model-bench` | sample query, two providers, run, hold | ~35 s |
| `05-scorecard` | scorecard page, three highlighted rows, end card | ~30 s |

## Production notes

- Record against a local production build in public-demo mode, vision
  catalogue, LLM tier on — so the prose is the real re-voiced prose.
- Typing is scripted at a human pace; the pointer moves, it does not teleport.
- No personal data appears. The browser profile is clean; the only text typed
  is in this document.
- Voice: record in one quiet take per scene, then trim the footage to the voice
  rather than the other way round.
