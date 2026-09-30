# Intently on the portfolio — section guide (DRAFT)

> **Status: draft, not yet sent to the portfolio-site session.** Everything in
> it that would appear on the page as Ilmari's words stays `draft: true` until
> he approves it. Owner: the Intently side. Last updated 2026-09-30.

This is the one document the portfolio-site builder needs to put Intently on
the page: what the section is for, its order, every asset with its status, the
copy rules, and the embed details. The asset list mirrors
[`handoff.md`](handoff.md), which stays the place to check readiness.

---

## 1. What the section is for

**Reader:** a senior architect or business-unit lead at a consultancy, plus the
colleague who has to justify the hire. They give it a few minutes.

**What they should leave with, in order:**

1. Ilmari frames a problem as a business problem before reaching for AI.
2. The architecture has one clear idea: *the code decides, the language model
   only phrases.* That is why it can be explained, tested and afforded.
3. It is real and it runs — they can use it themselves, including the admin
   side — and it is measured, weak spots included.

Everything on the section should serve one of those three. Anything that does
not can go.

---

## 2. Section order

| # | Block | Source | Notes |
|---|---|---|---|
| 1 | Title + one line | `intently-intro.md` → *Title*, *One line* | "Intently — shopping by situation" |
| 2 | Intro, about 120 words | `intently-intro.md` → *Intro* | first person, plain |
| 3 | Primary button **Want to see it yourself?** | → `https://intently.ilmarivuorenmaa.com` | live; open in a new tab |
| 4 | One sentence under the button | `intently-intro.md` → *One sentence…* | sets the sandbox expectation |
| 5 | Architecture chart | `intently-architecture.svg` | full width (up to 1024 px); click opens full size |
| 6 | Three points: problem / idea / evidence | `intently-intro.md` → *Three points* | short |
| 7 | Video tour | `docs/video/out/intently-tour.mp4` + poster + `.vtt` | **not final yet**; leave a slot |
| 8 | Two or three figures, each with its status label | `intently-intro.md` → *Figures* table | see §4 |
| 9 | Links: **Read how I built it** · **Source** · **Decision records** | case study, GitHub, ADR index | text links, not buttons |

If the page has room for only four things: 1, 3, 5, 9.

---

## 3. Assets

| Asset | Path (Intently repo) | Format / size | Status |
|---|---|---|---|
| Intro copy, points, button labels, figures | `docs/portfolio/intently-intro.md` | Markdown | **draft** — needs Ilmari's approval |
| Architecture chart | `docs/portfolio/intently-architecture.svg` (+ `.png`, 3200×1920) | SVG, scales; dark background | **approved** |
| Live demo | `https://intently.ilmarivuorenmaa.com` | public, no sign-in, not indexed | **live** |
| Video tour | `docs/video/out/intently-tour.mp4`, `poster.png`, `intently-tour.vtt` | 1920×1080 H.264, about 2½ min, about 10 MB | **draft cut only**; final cut + voice-over pending |
| Case study | `docs/case-study.md` (on GitHub) | Markdown | complete (pivot paragraph in Ilmari's words) |
| Decision records | `docs/adr/README.md` (on GitHub) | Markdown | live |
| Source | `https://github.com/ilpo00/intently` | public repo, no product photos | live; to be refreshed with the latest work |

Rule unchanged: the portfolio side copies assets into its own repo; nobody edits
the other repo.

---

## 4. Copy rules

- **Voice:** first person, plain, calm, short sentences. No buzzwords.
- **Every figure carries a visible status:** *Measured*, *Estimated* or
  *Hypothesis*; anything invented to illustrate is labelled *Illustrative
  example*. The figures table in `intently-intro.md` already gives the status
  and the source for each. Recommended picks for the page:
  - *Measured* — stated exclusions honoured in every tested brief (12 of 12).
  - *Measured* — the guard against the model making promises catches about a
    third of phrasings it has never seen. Showing a weak number on purpose is
    the point; it is what architects trust.
  - *Estimated* — about $0.003 of AI cost per conversation.
- **Leave out** the €110k–€690k business-benefit range unless it is labelled
  *Hypothesis* and *Illustrative example* in the same line.
- **Nothing drafted by Claude is published as Ilmari's own words** until he
  approves it.

---

## 5. What a visitor will meet in the demo

The page can set expectations in one line; this is the detail behind it.

- **Shopper view:** a one-line "Public demo" strip explains what they are
  looking at, with a *Try a brief* button and a link to the Studio.
- **Studio:** a banner says it is the real admin workspace, that their changes
  stay in their own browser session for 24 hours, and that actions which would
  spend AI budget are switched off. The model bench shows recorded results.
- **The language model is real** on the shopper side, under a daily cap. If the
  cap is reached the demo keeps working with plainer sentences.
- **Product photos** are H&M product images, used for non-commercial
  demonstration.

**A suggested three-minute path** (worth offering as "try this" text):

1. Type *a black dress for a party, it might get cold later*. Note the question
   it asks, the reason under every piece, and the layer it suggests.
2. Refine with *nothing with a print*. The shortlist re-ranks in place.
3. Open the Studio, pick a dress, set its pattern to *floral*, save. Back in the
   shopper view, ask for *a dress for a garden party, no florals*. It is gone.
4. Open *Models* in the Studio: the same brief through two providers, side by
   side, with what the model understood and what it was allowed to say.

---

## 6. Embed details

- **Chart:** inline the SVG, or use `<img>` with this alt text:
  *"Intently architecture. A shopper's sentence passes guardrails, a parser and
  a complexity gate; an optional language-model step reads hard phrasing; code
  merges, retrieves, ranks with hard exclusions and composes a shortlist; an
  optional language-model step rewords it and a grounding check rejects
  anything not shown. Product understanding is built offline from photos.
  Green: code that decides. Amber: language model, words only."*
  Smallest text is about 10 px at 1024 px wide — let a click open the full-size
  file.
- **Video:** self-hosted mp4 or YouTube/Vimeo — Ilmari's call. Poster and
  captions are separate files either way. Autoplay off; captions available.
- **Demo link:** new tab. The demo is `noindex`; linking to it is fine.
- **No link back** from the demo to the portfolio until Ilmari confirms the
  site is launched.

---

## 7. Keeping the demo up

- The demo runs on free tiers that reclaim idle resources. A daily keep-alive
  touches both backing stores so they are not paused or removed; on
  2026-09-30 both had been, which is how it was found.
- If the Studio ever shows the error page, the first thing to check is the
  hosted database status (Supabase project `intently`) and the keep-alive
  response.
- To take the demo private again in one step: remove `INTENTLY_PUBLIC_DEMO`
  from the Vercel project and redeploy. The password gate comes back.

---

## 8. Open before the section goes live

- [ ] Ilmari approves or rewrites the intro copy and the button text.
- [x] Ilmari writes the pivot paragraph (case study §6) — done 2026-09-30.
- [x] Ilmari approves the architecture chart.
- [ ] Final video cut recorded against the live demo; voice-over recorded.
- [ ] Video hosting decided.
- [ ] Public GitHub repo refreshed with the latest work.
