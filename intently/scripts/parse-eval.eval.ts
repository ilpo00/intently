/**
 * @jest-environment node
 *
 * Comprehension eval — measures the parser against a hand-labelled corpus of
 * messy real-shopper phrasings. NOT CI (testMatch override). Run from intently/:
 *
 *   npm run eval:parse                 # regex baseline only (deterministic, no key)
 *   PARSE_LLM=1 npm run eval:parse     # + live DeepSeek, reports the lift
 *
 * Scalars (occasion/activity/formality/season/requestedGarment): exact-match
 * accuracy. Lists (exclusions/constraints/preferences): micro precision/recall.
 * Ground truth is hand-authored in canonical vocabulary (parse-corpus.json).
 * Report → docs/parse-eval-latest.md.
 */

import fs from 'fs'
import path from 'path'
import { updateSessionContext } from '@/lib/discovery/session'
import { mergeParsedPatch } from '@/lib/discovery/parse-context'
import { llmParseContext } from '@/lib/discovery/parse-llm'
import type { Provider } from '@/lib/discovery/llm-client'
import { emptySessionContext, type SessionContext } from '@/types'

interface Expected {
  occasion?: string; activity?: string; formality?: string; season?: string; requestedGarment?: string
  exclusions?: string[]; constraints?: string[]; preferences?: string[]
}
interface Row { text: string; expected: Expected }

const REPORT = path.join(__dirname, '..', 'docs', 'parse-eval-latest.md')
const SCALARS = ['occasion', 'activity', 'formality', 'season', 'requestedGarment'] as const
const LISTS = ['exclusions', 'constraints', 'preferences'] as const

const ctxScalar = (c: SessionContext, k: typeof SCALARS[number]) => c[k] ?? undefined
const ctxList = (c: SessionContext, k: typeof LISTS[number]) => c[k] ?? []

interface Tally { scalarHit: number; scalarTotal: number; tp: number; fp: number; fn: number }
const newTally = (): Tally => ({ scalarHit: 0, scalarTotal: 0, tp: 0, fp: 0, fn: 0 })

function score(ctx: SessionContext, exp: Expected, t: Tally) {
  for (const k of SCALARS) {
    t.scalarTotal++
    if (ctxScalar(ctx, k) === (exp[k] ?? undefined)) t.scalarHit++
  }
  for (const k of LISTS) {
    const got = new Set(ctxList(ctx, k))
    const want = new Set(exp[k] ?? [])
    for (const g of got) { if (want.has(g)) t.tp++; else t.fp++ }
    for (const w of want) { if (!got.has(w)) t.fn++ }
  }
}

const pct = (n: number, d: number) => (d === 0 ? '—' : `${Math.round((100 * n) / d)}%`)
function summarise(t: Tally) {
  const prec = t.tp + t.fp === 0 ? 1 : t.tp / (t.tp + t.fp)
  const rec = t.tp + t.fn === 0 ? 1 : t.tp / (t.tp + t.fn)
  const f1 = prec + rec === 0 ? 0 : (2 * prec * rec) / (prec + rec)
  return {
    scalarAcc: pct(t.scalarHit, t.scalarTotal),
    listPrec: pct(t.tp, t.tp + t.fp),
    listRec: pct(t.tp, t.tp + t.fn),
    f1,
  }
}

describe('comprehension eval (manual harness, not CI)', () => {
  const corpus: Row[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'parse-corpus.json'), 'utf8'))
  // PARSE_LLM=haiku|deepseek|openai (or =1 → haiku). Needs the matching key present.
  const reqRaw = (process.env.PARSE_LLM || '').toLowerCase()
  const provider: Provider | null = reqRaw === 'deepseek' ? 'deepseek'
    : reqRaw === 'openai' ? 'openai'
    : (reqRaw === 'haiku' || reqRaw === '1') ? 'haiku' : null
  const haveKey = provider === 'deepseek' ? !!process.env.DEEPSEEK_API_KEY
    : provider === 'openai' ? !!process.env.OPENAI_API_KEY
    : !!process.env.ANTHROPIC_API_KEY
  const live = !!provider && haveKey

  const regex = newTally()
  const llm = newTally()
  const rows: string[] = []

  it('scores the corpus and writes the report', async () => {
    for (const { text, expected } of corpus) {
      const rCtx = updateSessionContext(emptySessionContext(), text)
      score(rCtx, expected, regex)

      let llmCell = '—'
      if (live) {
        const patch = await llmParseContext(text, emptySessionContext(), provider)
        const lCtx = patch ? mergeParsedPatch(rCtx, patch) : rCtx
        score(lCtx, expected, llm)
        llmCell = patch ? '✓' : 'null→regex'
      }
      rows.push(`| ${text.replace(/\|/g, '/')} | ${llmCell} |`)
    }

    const r = summarise(regex)
    const lines = [
      '# Comprehension eval — latest',
      '',
      `_Generated ${new Date().toISOString().slice(0, 10)} · ${corpus.length} hand-labelled phrasings · ${live ? `regex + live ${provider}` : 'regex baseline only (set PARSE_LLM=haiku for the LLM column)'}._`,
      '',
      '| metric | regex' + (live ? ` | regex + ${provider} |` : ' |'),
      '|---|---|' + (live ? '---|' : ''),
      `| scalar exact-match | ${r.scalarAcc}` + (live ? ` | ${summarise(llm).scalarAcc} |` : ' |'),
      `| list precision | ${r.listPrec}` + (live ? ` | ${summarise(llm).listPrec} |` : ' |'),
      `| list recall | ${r.listRec}` + (live ? ` | ${summarise(llm).listRec} |` : ' |'),
      '',
    ]
    if (live) {
      lines.push('| phrase | LLM parsed |', '|---|---|', ...rows, '')
    }
    fs.writeFileSync(REPORT, lines.join('\n'))
    expect(fs.existsSync(REPORT)).toBe(true)
  }, 120_000)

  it('regex baseline holds a sane floor (scalar accuracy ≥ 60%)', () => {
    // Regression floor for the deterministic path. The LLM lift is measured in
    // the report, not asserted (live, costs money, judged by reading).
    expect(summarise(regex).scalarAcc).not.toBe('—')
    expect(regex.scalarHit / regex.scalarTotal).toBeGreaterThanOrEqual(0.6)
  })
})
