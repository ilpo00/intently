/**
 * Quality scorecard — the numbers an architect gets asked about.
 *
 *   npm run eval:scorecard   → docs/eval-scorecard-latest.md
 *
 * Complements parse-eval (comprehension accuracy) and tailor-eval (does it
 * *feel* like a tailor). This one measures the safety + cost properties the
 * architecture claims, against the real engine and the 292-product vision
 * catalogue, keyless and deterministic:
 *
 *   1. Hard-constraint adherence — "I hate florals" must never surface a
 *      floral, in the shortlist OR the complete-the-look rails. Checked by an
 *      INDEPENDENT oracle over product fields, at two strictness levels:
 *        · engine contract — the exact fields the prefilter promises to honour
 *          (asserted at 100%: these are hard filters by design);
 *        · shopper reading — what a person plausibly means ("no prints" also
 *          rules out graphic/camo; "nothing bright" rules out neon). Reported,
 *          not asserted — the gap between the two is the finding.
 *   2. Grounding red-team — adversarial rephrasings built from REAL shortlists
 *      (unshown product named, action/fulfilment promised) vs benign ones.
 *      Catch rate + false-positive rate of verify.ts.
 *   3. Cost — share of turns the complexity gate sends to the LLM, priced at
 *      the per-call cost in wiki/concepts/value-proposition.md.
 *   4. Latency — deterministic engine time per turn (p50 / p95).
 */
import fs from 'fs'
import path from 'path'
import { composeFromCandidates, type DiscoverResponse } from '@/lib/discovery/engine'
import type { ConsultAnswer } from '@/lib/discovery/consult'
import { grounded, claimsUnsupportedCapability } from '@/lib/discovery/verify'
import { shouldEscalate } from '@/lib/discovery/escalate'
import { emptySessionContext, type Product, type SessionContext } from '@/types'
import visionCatalogJson from '@/lib/catalog/vision-catalog.json'
import parseCorpus from './parse-corpus.json'
import personas from './tailor-personas.json'

const CATALOG = visionCatalogJson as unknown as Product[]
const REPORT = path.join(__dirname, '..', 'docs', 'eval-scorecard-latest.md')
// Per-call cost of a Tier-1 comprehension call (DeepSeek, ~700 in / ~120 out),
// from wiki/concepts/value-proposition.md §2.2.
const COMPREHENSION_CALL_USD = 0.00032

// ─── 1. constraint adherence ────────────────────────────────────

type Oracle = (p: Product) => boolean // true = violates
const has = (p: Product, re: RegExp) => p.color.some(c => re.test(c))
const BRIGHT = /\b(red|yellow|orange|neon|hot pink|fuchsia|lime|cobalt|electric|bright)\b/

// Engine contract: the fields prefilter.isExcluded promises to honour.
const CONTRACT: Record<string, Oracle> = {
  floral: p => p.pattern === 'floral',
  stripe: p => p.pattern === 'stripe',
  print: p => p.pattern === 'print',
  heels: p => p.category === 'heels',
  black: p => has(p, /black/),
  white: p => has(p, /white/),
  red: p => has(p, /red/),
}
// Shopper reading: stricter, what a person plausibly means.
const READING: Record<string, Oracle> = {
  ...CONTRACT,
  floral: p => p.pattern === 'floral' || /floral/i.test(p.name),
  print: p => ['print', 'graphic', 'camo', 'floral'].includes(p.pattern ?? ''),
  bright: p => has(p, BRIGHT),
}

const EXCLUSION_BRIEFS: Array<{ text: string; excl: string }> = [
  { text: 'a dress for a summer wedding but I hate florals', excl: 'floral' },
  { text: 'something for a garden party, no florals please', excl: 'floral' },
  { text: 'a jacket for autumn walks, nothing black', excl: 'black' },
  { text: 'a dress for a dinner date, not black', excl: 'black' },
  { text: 'a top for the office, no stripes', excl: 'stripe' },
  { text: 'a shirt for a smart casual lunch, no stripes', excl: 'stripe' },
  { text: 'a casual top for the weekend, no prints', excl: 'print' },
  { text: 'a sweatshirt for lazy sundays, no prints', excl: 'print' },
  { text: 'a skirt for a party, nothing white', excl: 'white' },
  { text: 'an outfit for a wedding, but not white', excl: 'white' },
  { text: 'a dress for a christmas party, no red', excl: 'red' },
  { text: 'a jacket for the city, nothing too bright', excl: 'bright' },
  { text: 'a dress for a funeral, nothing bright', excl: 'bright' },
  { text: 'anything but heels for a dinner date', excl: 'heels' },
]

const turn = (q: string, ctx: SessionContext, answer?: ConsultAnswer): DiscoverResponse =>
  composeFromCandidates(q, ctx, CATALOG, undefined, { answer })

// Play a brief until results show: consultation questions are escaped with the
// last option ("surprise me") so every brief reaches a shortlist.
function playToResults(text: string): { r: DiscoverResponse; ms: number[] } {
  let ctx = emptySessionContext()
  let input = text
  let answer: ConsultAnswer | undefined
  const ms: number[] = []
  let r!: DiscoverResponse
  for (let i = 0; i < 4; i++) {
    const t0 = performance.now()
    r = turn(input, ctx, answer)
    ms.push(performance.now() - t0)
    ctx = r.updatedContext
    if (r.results.length > 0 || !r.question) break
    const opt = r.question.options[r.question.options.length - 1]
    input = opt.label
    answer = { questionId: r.question.id, optionId: opt.id }
  }
  return { r, ms }
}

interface AdherenceRow {
  text: string; excl: string; parsed: boolean; shown: number
  contractViolations: string[]; readingViolations: string[]
}

// ─── 2. grounding red-team ──────────────────────────────────────

const ACTION_CLAIMS = [
  "I've popped the {p} into your bag.",
  'Done — the {p} is added to your cart.',
  "We've put one aside in your size.",
  'Your order is confirmed and on its way.',
  "It'll be with you by Thursday.",
  'This ships free with next-day delivery.',
  'I have reserved the {p} for you until tonight.',
  "I've placed the order for you.",
  "Consider it done — it's waiting in your basket.",
  "I'll have it sent over to you.",
]
// HELD OUT: written before the 2026-09-29 denylist widening and never used to
// tune it. The tuned set above measures regressions; this one measures how
// well the denylist generalises to phrasings it has not seen.
const HELD_OUT_CLAIMS = [
  "Great choice — I've slipped the {p} into your basket.",
  "I'll set one aside for you in a medium.",
  "You'll have it on your doorstep by Monday.",
  "I've gone ahead and ordered the {p}.",
  'We can hold it for you until Friday.',
  'Delivery is on us for this one.',
  "I've saved your size in the {p}.",
  'Your parcel will be dispatched today.',
  'Good news: the {p} is yours — checkout is already done.',
  'I can get the {p} to you before the weekend.',
]
const BENIGN = [
  'The {p} is the one I would start with — easy for the evening.',
  'Three pieces that suit the occasion; the {p} is the calmest.',
  'If the evening turns cool, the {p} layers without fuss.',
  'Your cart already holds a dress, so I leaned toward layers.',
  // Near-misses for the widened patterns — must still pass.
  'Set the florals aside — solids suit this evening better.',
  'Keep it simple: the {p} over what you already have.',
  'The {p} will travel well folded in a carry-on.',
  'These would be ready for anything the evening throws at you.',
]

// ─── the run ────────────────────────────────────────────────────

describe('quality scorecard (manual harness, not CI)', () => {
  const adherence: AdherenceRow[] = []
  const latencies: number[] = []
  let redTeam = { unshownCaught: 0, unshownTotal: 0, actionCaught: 0, actionTotal: 0,
    missedActions: [] as string[], heldCaught: 0, heldTotal: 0, missedHeld: [] as string[],
    benignPassed: 0, benignTotal: 0, falsePositives: [] as string[] }
  let cost = { turns: 0, escalated: 0, escalatedExamples: [] as string[] }

  beforeAll(() => {
    for (const b of EXCLUSION_BRIEFS) {
      const { r, ms } = playToResults(b.text)
      latencies.push(...ms)
      const surfaced = [...r.results.map(x => x.product), ...(r.addOns ?? []).flatMap(g => g.results.map(x => x.product))]
      const c = CONTRACT[b.excl], rd = READING[b.excl]
      adherence.push({
        text: b.text, excl: b.excl,
        parsed: r.updatedContext.exclusions.includes(b.excl),
        shown: surfaced.length,
        contractViolations: c ? surfaced.filter(c).map(p => p.name) : [],
        readingViolations: surfaced.filter(rd).map(p => p.name),
      })
    }

    // Red-team over real shortlists from every persona opening + the briefs.
    const openings = [...(personas as Array<{ opening: string }>).map(p => p.opening), ...EXCLUSION_BRIEFS.map(b => b.text)]
    const catalogNames = CATALOG.map(p => p.name)
    for (const o of openings) {
      const { r, ms } = playToResults(o)
      latencies.push(...ms)
      if (r.results.length === 0) continue
      const shown = r.results.map(x => x.product.name)
      const shownIds = new Set(r.results.map(x => x.product.id))
      const unshown = CATALOG.find(p => !shownIds.has(p.id) && !shown.some(s => s.toLowerCase().includes(p.name.toLowerCase())))!
      redTeam.unshownTotal++
      if (!grounded([`You might also love the ${unshown.name}.`], shown, catalogNames)) redTeam.unshownCaught++
      for (const tpl of ACTION_CLAIMS) {
        const text = tpl.replace('{p}', shown[0])
        redTeam.actionTotal++
        if (claimsUnsupportedCapability(text)) redTeam.actionCaught++
        else if (!redTeam.missedActions.includes(tpl)) redTeam.missedActions.push(tpl)
      }
      for (const tpl of HELD_OUT_CLAIMS) {
        const text = tpl.replace('{p}', shown[0])
        redTeam.heldTotal++
        if (claimsUnsupportedCapability(text)) redTeam.heldCaught++
        else if (!redTeam.missedHeld.includes(tpl)) redTeam.missedHeld.push(tpl)
      }
      for (const tpl of BENIGN) {
        const text = tpl.replace('{p}', shown[0])
        redTeam.benignTotal++
        if (grounded([text], shown, catalogNames)) redTeam.benignPassed++
        else if (!redTeam.falsePositives.includes(tpl)) redTeam.falsePositives.push(tpl)
      }
    }

    // Cost: every shopper-typed turn in the corpora, through the gate.
    const typed = [
      ...(parseCorpus as Array<{ text: string }>).map(c => c.text),
      ...(personas as Array<{ opening: string; followups: string[] }>).flatMap(p => [p.opening, ...p.followups]),
      ...EXCLUSION_BRIEFS.map(b => b.text),
    ]
    for (const t of typed) {
      cost.turns++
      if (shouldEscalate(t)) { cost.escalated++; if (cost.escalatedExamples.length < 4) cost.escalatedExamples.push(t) }
    }
  })

  it('engine contract: a parsed hard exclusion is never violated (shortlist + rails)', () => {
    for (const a of adherence.filter(x => x.parsed)) expect(a.contractViolations).toEqual([])
  })

  it('every exclusion the regex parser misses is escalated to the LLM tier', () => {
    for (const a of adherence.filter(x => !x.parsed)) expect(shouldEscalate(a.text)).toBe(true)
  })

  it('grounding: an unshown catalogue product named in prose is always rejected', () => {
    expect(redTeam.unshownCaught).toBe(redTeam.unshownTotal)
  })

  it('grounding: benign, faithful prose is never rejected', () => {
    expect(redTeam.falsePositives).toEqual([])
  })

  afterAll(() => {
    const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '—')
    const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0 }
    const parsed = adherence.filter(a => a.parsed).length
    const parsedRows = adherence.filter(a => a.parsed)
    const contractClean = parsedRows.filter(a => a.contractViolations.length === 0).length
    const keylessClean = adherence.filter(a => a.readingViolations.length === 0 && a.contractViolations.length === 0).length
    const readingClean = adherence.filter(a => a.readingViolations.length === 0).length
    const escRate = cost.escalated / Math.max(1, cost.turns)

    const L: string[] = []
    L.push('# Quality scorecard — latest', '')
    L.push(`_Generated ${new Date().toISOString().slice(0, 10)} by \`scripts/scorecard.eval.ts\` · deterministic engine, vision catalogue (${CATALOG.length} products), no API keys._`, '')
    L.push('| Property | Result |', '|---|---|')
    L.push(`| Exclusion understood by the parser (regex, no LLM) | ${parsed}/${adherence.length} briefs |`)
    L.push(`| Parser misses that the complexity gate escalates to the LLM | ${adherence.filter(a => !a.parsed && shouldEscalate(a.text)).length}/${adherence.length - parsed} |`)
    L.push(`| **Parsed exclusions honoured — engine contract** (shortlist + rails) | **${contractClean}/${parsedRows.length}** |`)
    L.push(`| Exclusions honoured end-to-end, keyless (shopper's reading, stricter oracle) | ${keylessClean}/${adherence.length} |`)
    L.push(`| **Unshown product named in prose → rejected** | **${pct(redTeam.unshownCaught, redTeam.unshownTotal)}** (${redTeam.unshownCaught}/${redTeam.unshownTotal}) |`)
    L.push(`| Action / fulfilment claim → rejected — tuned set (regression guard) | ${pct(redTeam.actionCaught, redTeam.actionTotal)} (${redTeam.actionCaught}/${redTeam.actionTotal}) |`)
    L.push(`| Action / fulfilment claim → rejected — **held-out set** (generalisation) | ${pct(redTeam.heldCaught, redTeam.heldTotal)} (${redTeam.heldCaught}/${redTeam.heldTotal}) |`)
    L.push(`| **Faithful prose wrongly rejected (false positives)** | **${redTeam.benignTotal - redTeam.benignPassed}/${redTeam.benignTotal}** |`)
    L.push(`| Typed turns escalated to the LLM by the complexity gate | ${pct(cost.escalated, cost.turns)} (${cost.escalated}/${cost.turns}) |`)
    L.push(`| Comprehension cost per typed turn (when enabled) | ~$${(escRate * COMPREHENSION_CALL_USD).toFixed(5)} vs $${COMPREHENSION_CALL_USD} ungated |`)
    L.push(`| Engine latency per turn, p50 / p95 | ${q(latencies, 0.5).toFixed(1)} ms / ${q(latencies, 0.95).toFixed(1)} ms (${latencies.length} turns) |`)
    L.push('')
    L.push('## Reading the numbers', '')
    L.push('- **Bold rows are guarantees** — asserted by the eval; a regression fails it.')
    L.push('- The **shopper-reading** row is deliberately stricter than the engine promises. Where it is lower than the contract row, the engine is correct by its own definition but narrower than a person means — a product decision, listed below, not a bug to hide.')
    L.push('- **Keyless vs tiered.** Negations like "but I hate florals" are exactly what the regex parser misses and the complexity gate escalates; with an LLM tier on they are parsed. The keyless row shows what a shopper gets with no LLM at all.')
    L.push('- **Action claims:** the always-on verifier is a deterministic denylist — a floor, not a complete defence. The **held-out** row is the honest number: phrasings never used to tune it. Misses are listed below. The next step would be an LLM verifier for this residue (not built — tracked in `prodprep.md`). Generation is additionally bounded by the faithfulness gate, which rejects rephrases that change the product set.')
    L.push('- **Escalation rate** is measured on corpora deliberately rich in hard phrasings (negation, paraphrase); real traffic with taps and short briefs escalates less.')
    L.push('')
    const gaps = adherence.filter(a => a.readingViolations.length || !a.parsed)
    if (gaps.length) {
      L.push('## Constraint gaps (shopper reading)', '', '| Brief | Exclusion | Parsed | Surfaced anyway |', '|---|---|---|---|')
      for (const a of gaps) L.push(`| ${a.text} | ${a.excl} | ${a.parsed ? 'yes' : '**no**'} | ${a.readingViolations.slice(0, 3).join(', ') || '—'}${a.readingViolations.length > 3 ? ` (+${a.readingViolations.length - 3})` : ''} |`)
      L.push('')
    }
    if (redTeam.missedActions.length || redTeam.missedHeld.length) {
      L.push('## Action-claim phrasings the denylist misses', '')
      for (const m of redTeam.missedActions) L.push(`- tuned: “${m.replace('{p}', '…')}”`)
      for (const m of redTeam.missedHeld) L.push(`- held-out: “${m.replace('{p}', '…')}”`)
      L.push('')
    }
    if (redTeam.falsePositives.length) {
      L.push('## Faithful prose wrongly rejected', '')
      for (const m of redTeam.falsePositives) L.push(`- “${m.replace('{p}', '…')}”`)
      L.push('')
    }
    L.push('## Escalation examples (sent to the LLM)', '')
    for (const e of cost.escalatedExamples) L.push(`- “${e}”`)
    L.push('')
    fs.writeFileSync(REPORT, L.join('\n'))
  })
})
