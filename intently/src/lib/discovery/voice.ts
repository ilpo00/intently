// ─────────────────────────────────────────────
// discovery/voice.ts
//
// The tailor's voice — every assistant-facing sentence the discovery layer
// produces. Deterministic templates (Tier 0), kept in one place so the tone
// stays coherent: warm, brief, decisive. House rules:
//
//   · Acknowledge before anything else — reflect back what was just learned
//     ("Noted — darker, richer tones.") so the shopper feels heard.
//   · Never apologise for the catalogue. A small set is framed as curation
//     ("kept it deliberately tight"), never as lack.
//   · Speak about reasons, not inventory ("each here for a reason").
// ─────────────────────────────────────────────

import type { SessionContext, ConsultQuestion, ContextPatch } from '@/types'

// What voice needs to know about a tapped option (consult.ts's OptionSpec
// satisfies this structurally).
interface AnsweredOption {
  label: string
  concludes?: boolean
  // The option's context patch — an empty patch means the shopper passed on
  // the question (an escape), so there is nothing to acknowledge.
  patch?: ContextPatch
}

// An escape teaches nothing — echoing its label back reads broken ("Noted —
// I'd rather not say." sounds like the TAILOR declining). A tailor moves on.
const learnedNothing = (o: AnsweredOption) => !o.patch || Object.keys(o.patch).length === 0

// How an occasion reads in prose ("wedding guest" is a role, not a sentence).
const OCCASION_PROSE: Record<string, string> = { 'wedding guest': 'wedding' }

// How an audience reads in prose and acknowledgments.
const AUDIENCE_PROSE: Record<string, string> = {
  men: 'for him', women: 'for her', unisex: 'kept unisex',
}

// Occasions that read as mass nouns — "for work", never "for a work".
const NO_ARTICLE = ['work', 'dinner']

const article = (s: string) => (/^[aeiou]/i.test(s) ? 'an' : 'a')

// Human-readable fragments of the brief, most situational first.
function briefBits(ctx: SessionContext): string[] {
  const bits: string[] = []
  if (ctx.occasion) {
    const occasion = OCCASION_PROSE[ctx.occasion] ?? ctx.occasion
    const where = ctx.constraints.includes('outdoor venue') ? 'outdoor ' : ''
    const when = ctx.season ? `${ctx.season} ` : ''
    const phrase = `${when}${where}${occasion}`.replace(/\s+/g, ' ').trim()
    bits.push(NO_ARTICLE.includes(ctx.occasion) ? phrase : `${article(phrase)} ${phrase}`)
  } else if (ctx.activity) {
    // Activities read as pursuits, no article: "autumn day hiking".
    bits.push(`${ctx.season ? `${ctx.season} ` : ''}${ctx.activity}`.trim())
  } else if (ctx.season) {
    bits.push(`for ${ctx.season}`)
  }
  if (ctx.audience) bits.push(AUDIENCE_PROSE[ctx.audience])
  if (ctx.formality) bits.push(ctx.formality)
  if (ctx.constraints.includes('cold evenings')) bits.push('cold evenings ahead')
  return bits
}

// What did THIS turn teach us? (list-field diff against the previous context)
// Exported so the LLM re-voicer (generate-llm.ts) can pass "what the shopper
// just said" as a tone hint without re-deriving it.
export function newSignals(prev: SessionContext, ctx: SessionContext): string[] {
  const out: string[] = []
  if (ctx.occasion && ctx.occasion !== prev.occasion) out.push(ctx.occasion)
  if (ctx.activity && ctx.activity !== prev.activity) out.push(ctx.activity)
  if (ctx.formality && ctx.formality !== prev.formality) out.push(ctx.formality)
  if (ctx.season && ctx.season !== prev.season) out.push(ctx.season)
  if (ctx.audience && ctx.audience !== prev.audience) out.push(AUDIENCE_PROSE[ctx.audience])
  out.push(...ctx.constraints.filter(c => !prev.constraints.includes(c)))
  out.push(...ctx.preferences.filter(p => !prev.preferences.includes(p)))
  out.push(...ctx.exclusions.filter(e => !prev.exclusions.includes(e)).map(e => `no ${e}`))
  return out
}

const listOut = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/**
 * A blocking consultation turn: acknowledgment beat + the question itself.
 * The prompt is part of the message so the transcript stays complete even on
 * a surface that doesn't render option pills.
 */
export function askMessage(
  prev: SessionContext,
  ctx: SessionContext,
  q: ConsultQuestion,
  answered?: AnsweredOption,
): string {
  if (answered) {
    if (learnedNothing(answered)) return `As you wish. ${q.prompt}`
    return `Noted — ${answered.label}. ${q.prompt}`
  }
  const learned = newSignals(prev, ctx)
  if (learned.length > 0) {
    const bridge = ctx.askedQuestions.length > 0 ? 'One more thing:' : 'Let me ask one thing first —'
    return `${capitalise(listOut(learned))} — noted. ${bridge} ${q.prompt}`
  }
  // Nothing new was understood this turn. Greet only once — mid-conversation
  // the tailor simply carries on rather than re-introducing itself.
  if (prev.turnCount > 0) {
    return `Alright. ${q.prompt}`
  }
  return `With pleasure. A question or two first, so I bring you the right pieces — not the most pieces. ${q.prompt}`
}

// What the reveal can honestly say about a cold-evenings turn.
export interface RevealOpts {
  // A layer group was set beside the shortlist (outfit completion).
  layerOffered?: boolean
  // The MAIN shortlist genuinely re-ranks warmer (outdoor kit briefs).
  warmable?: boolean
}

/** The reveal: what the shortlist is, and why it can be trusted. */
export function revealMessage(
  prev: SessionContext,
  ctx: SessionContext,
  count: number,
  firstReveal: boolean,
  answered?: AnsweredOption,
  opts: RevealOpts = {},
): string {
  const tight = count > 0 && count <= 5
    ? ' I’ve kept it deliberately tight — only what truly fits.'
    : ''

  if (firstReveal) {
    // A budget given at ANY point during the consultation is honoured in the
    // ranking — say so at the reveal, or the effect stays invisible and the
    // shopper (rightly) feels unheard.
    const priced = ctx.constraints.includes('budget conscious') ? ' The smarter buys lead.' : ''
    if (answered?.concludes) {
      return `My pick, then. ${count} pieces I’d stand behind — the note under each tells you why.${priced}${tight}`
    }
    if (ctx.askedQuestions.length > 0) {
      // "Plenty to work with", not "everything I need" — a sharpening question
      // may follow the reveal, and the copy must not contradict it. Anything
      // learned on THIS turn is acknowledged first (a typed constraint that
      // tipped the brief over the line deserves its "noted" beat too).
      const learned = newSignals(prev, ctx)
      const ack = learned.length > 0 ? `${capitalise(listOut(learned))} — noted, and that’s` : 'Thank you — that’s'
      return `${ack} plenty to work with. ${count} pieces, each here for a reason; the note under each tells you why.${priced}${tight}`
    }
    const bits = briefBits(ctx)
    if (bits.length > 0) {
      return `${capitalise(listOut(bits))} — a clear brief. ${count} pieces chosen for it, each with its reason.${tight}`
    }
    return `Here they are — ${count} pieces, each with its reason.${tight}`
  }

  // Refinement turns: acknowledge the change, then the re-cut.
  if (answered) {
    return `Noted — ${answered.label}. ${count} pieces, re-chosen around it.${tight}`
  }
  const newExclusions = ctx.exclusions.filter(e => !prev.exclusions.includes(e))
  if (newExclusions.length > 0) {
    return `Of course — ${listOut(newExclusions)} is out. ${count} pieces now, re-chosen around that.${tight}`
  }
  if (ctx.constraints.includes('cold evenings') && !prev.constraints.includes('cold evenings')) {
    // Say only what actually happened: a layer set beside the shortlist, a
    // genuinely warmer re-rank, or — when the catalogue can do neither —
    // a plain acknowledgment. Never claim warmth the ranking didn't produce.
    if (opts.layerOffered) {
      return `Then we plan for those evenings — the pieces hold, and I’ve set a light layer beside them.${tight}`
    }
    if (opts.warmable) {
      return `Then we plan for those evenings — ${count} pieces, now leaning warmer.${tight}`
    }
    return `Cold evenings — noted. ${count} pieces, still standing behind the brief.${tight}`
  }
  if (ctx.constraints.includes('budget conscious') && !prev.constraints.includes('budget conscious')) {
    return `Of course — keeping it considered on price. ${count} pieces, the smarter buys leading.${tight}`
  }
  const newPrefs = ctx.preferences.filter(p => !prev.preferences.includes(p))
  if (newPrefs.length > 0) {
    return `Noted — leaning ${listOut(newPrefs)}. ${count} pieces, reordered around it.${tight}`
  }
  const bits = briefBits(ctx)
  return `Updated — ${count} pieces for ${bits.length ? listOut(bits) : 'what you described'}.${tight}`
}

/**
 * The honesty beat: the shopper asked for a garment we don't carry (or that
 * didn't survive into the shortlist). Lead with the service, subordinate the
 * gap — confident pivot, not apology, and never silent substitution.
 */
export function garmentGapPrefix(word: string): string {
  // The reveal that follows names the brief — this line states only the gap
  // and the response to it, so the two never repeat each other.
  return `No ${word} in the collection today, so I’ve chosen around it. `
}

// ── Outfit completion (the "and to go with it…" beat) ──
// One sentence per group, phrased as service, never as a sell. The situation
// is always the reason — if the lead can't name why, the slot shouldn't show.

/** The group's introducing line. */
export function companionLead(slotId: string, ctx: SessionContext): string {
  switch (slotId) {
    case 'layer':
      if (ctx.constraints.includes('cold evenings')) {
        return ctx.season === 'summer'
          ? 'Summer days run warm and the evenings won’t — a light layer over it settles both.'
          : 'For when it cools — a layer to go over it.'
      }
      if (ctx.constraints.includes('outdoor venue')) {
        return 'Outdoors, the evening decides — a light layer to have along.'
      }
      return 'The season asks for a layer — these go over it well.'
    case 'pair':
      return 'To make it a whole outfit — the other half.'
    case 'carry':
      return 'And something to carry the day — these would do it.'
    case 'shade':
      return 'For the sun out there — keep it off your eyes.'
    default:
      return 'And to go with it —'
  }
}

/**
 * The cart-anchored reveal: the shopper already chose their piece, and this
 * turn asked for what goes WITH it. Acknowledge what's settled, then serve
 * the completion — never re-sell what's already over their arm.
 */
export function cartAnchoredMessage(
  slotId: string,
  cartedCategory: string,
  cartedName: string | undefined,
  count: number,
): string {
  const theirs = cartedName ? `your ${cartedCategory}` : `the ${cartedCategory}`
  switch (slotId) {
    case 'layer':
      return `${capitalise(theirs)} is settled — for those evenings, ${count} layers that go over it; the note under each tells you why.`
    case 'pair':
      return `${capitalise(theirs)} is settled — ${count} pieces to make it a whole outfit.`
    case 'carry':
      return `${capitalise(theirs)} is settled — ${count} ways to carry the rest of the day.`
    case 'shade':
      return `${capitalise(theirs)} is settled — ${count} pieces to keep the sun honest.`
    default:
      return `${capitalise(theirs)} is settled — ${count} pieces to go with it.`
  }
}

/** The short per-piece line on a companion card. */
export function companionWhy(slotId: string, product: { category: string }): string {
  switch (slotId) {
    case 'layer': return `A ${product.category} to throw over when the evening cools.`
    case 'pair': return 'Completes the outfit.'
    case 'carry': return 'Carries the day’s kit.'
    case 'shade': return 'Keeps the sun honest.'
    default: return 'Goes well with the rest.'
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
