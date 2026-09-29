// ─────────────────────────────────────────────────────────────────
// Situation↔product matching — comparison spike
//
//   node scripts/situation-spike.mjs            (dev server must be on :3017)
//
// For each situation in src/lib/discovery/situation-profiles.json, compares:
//   A — Baseline: the live engine via POST /api/discover (deterministic).
//   B — World-knowledge profile → deterministic score over the FULL catalogue
//       (the hybrid candidate; scorer inline below, ready to lift to TS).
//   C — LLM judge (Claude Sonnet) over the A∪B candidate union — the oracle /
//       upper bound. Bounds headroom and tests abstention (black-tie).
//
// Writes .enrichment/situation-spike.json + a console table + a recommendation.
// Throwaway research artifact — NOT a production layer.
// ─────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dir, '..')
const BASE = process.env.DEV_URL || 'http://localhost:3017'
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'claude-sonnet-4-6'
const RATE = { in: 3.0 / 1e6, out: 15.0 / 1e6 } // assumed Sonnet list pricing
const TOPK = 6
const B_ABSTAIN = 5 // raw-score floor below which B is low-confidence
const C_ABSTAIN = 0.45

const read = p => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
const products = [...read('src/lib/catalog/fashion-catalog.json'), ...read('src/lib/catalog/outdoor-catalog.json')]
const byId = new Map(products.map(p => [p.id, p]))
const { situations } = read('src/lib/discovery/situation-profiles.json')

// ── B: world-knowledge profile scorer (inline; mirrors a future situation-match.ts) ──
function scoreB(p, prof) {
  let s = 0
  const why = []
  const [fmin, fmax] = prof.formality
  if (p.formalityLevel >= fmin && p.formalityLevel <= fmax) { s += 4; why.push('formality fits') }
  else { s -= 2 * Math.min(Math.abs(p.formalityLevel - fmin), Math.abs(p.formalityLevel - fmax)) }
  if (prof.garments.avoid?.includes(p.category)) { s -= 6; why.push(`avoid:${p.category}`) }
  if (prof.garments.prefer?.includes(p.category)) { s += 4; why.push(`prefer:${p.category}`) }
  const occ = (p.occasionTags || []).filter(t => prof.occasionTags?.includes(t))
  if (occ.length) { s += 3 * occ.length; why.push(`occ:${occ.join(',')}`) }
  const sty = (p.styleTags || []).filter(t => prof.styleArchetypes?.includes(t))
  if (sty.length) { s += 2 * sty.length; why.push(`style:${sty.join(',')}`) }
  if (prof.seasons?.length && (p.season || []).some(se => prof.seasons.includes(se))) { s += 2; why.push('season') }
  for (const m of (prof.materials || [])) if ((p.embeddingText || '').includes(m)) { s += 1; why.push(`mat:${m}`) }
  if (prof.avoidPatterns?.includes(p.pattern)) { s -= 2; why.push(`avoidPat:${p.pattern}`) }
  return { score: s, why }
}

function rankB(prof) {
  return products
    .map(p => ({ id: p.id, name: p.name, ...scoreB(p, prof) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOPK)
}

// ── A: the live engine ──
async function runA(sit) {
  const res = await fetch(`${BASE}/api/discover`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: sit.query, catalog: sit.catalog }),
  })
  if (!res.ok) throw new Error(`discover ${res.status}`)
  const { results } = await res.json()
  return (results || []).slice(0, TOPK).map(r => ({ id: r.product.id, name: r.product.name, score: r.relevanceScore }))
}

// ── C: LLM judge over the A∪B union ──
function attrLine(p) {
  return `${p.id} | ${p.name} | ${p.category}, formality ${p.formalityLevel}, [${(p.occasionTags || []).join('/')}], ${(p.styleTags || []).join('/')}, ${(p.season || []).join('/')}, ${p.pattern}`
}
async function runC(client, sit, candidateIds) {
  const cands = candidateIds.map(id => byId.get(id)).filter(Boolean)
  const prompt = `You are a fashion stylist. Situation: "${sit.label} — ${sit.query}".
Rate how well each product fits THIS situation from 0.0 to 1.0, with a short reason.
A product that's wrong for the situation (e.g. a beanie for a black-tie gala) scores near 0.
If nothing genuinely fits, score them all low — do not force a match.
Products (id | name | category, formality, [occasions], styles, seasons, pattern):
${cands.map(attrLine).join('\n')}

Return ONLY a JSON array: [{"id": "...", "fit": 0.0, "reason": "..."}]`
  const msg = await client.messages.create({
    model: JUDGE_MODEL, max_tokens: 900,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = msg.content.filter(c => c.type === 'text').map(c => c.text).join('')
  let arr = []
  try {
    let t = text.trim().replace(/```(?:json)?/g, '')
    const i = t.indexOf('['), j = t.lastIndexOf(']')
    arr = JSON.parse(t.slice(i, j + 1))
  } catch { /* leave empty */ }
  const judged = arr
    .map(x => ({ id: x.id, name: byId.get(x.id)?.name ?? x.id, score: Math.max(0, Math.min(1, Number(x.fit) || 0)), reason: String(x.reason || '') }))
    .sort((a, b) => b.score - a.score)
  return { judged, usage: msg.usage }
}

const setOf = a => new Set(a.map(x => x.id))
const overlap = (a, b) => { const B = setOf(b); return a.filter(x => B.has(x.id)).length }

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1) }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  console.log(`situation-spike · ${situations.length} situations · judge ${JUDGE_MODEL}\n`)
  const out = []
  let tin = 0, tout = 0

  for (const sit of situations) {
    let A = []
    try { A = await runA(sit) } catch (e) { console.log(`  A error: ${e.message}`) }
    const B = rankB(sit)
    const union = [...new Set([...A.map(x => x.id), ...B.map(x => x.id)])]
    const { judged: C, usage } = await runC(client, sit, union)
    tin += usage.input_tokens; tout += usage.output_tokens

    const bTop = B[0]?.score ?? -99
    const cMax = C[0]?.score ?? 0
    const bAbstain = bTop < B_ABSTAIN
    const cAbstain = cMax < C_ABSTAIN
    // how well does B agree with the oracle? fraction of B top-3 the oracle rates >= 0.5
    const cById = new Map(C.map(c => [c.id, c.score]))
    const bTop3 = B.slice(0, 3)
    const bGood = bTop3.filter(b => (cById.get(b.id) ?? 0) >= 0.5).length

    out.push({
      id: sit.id, label: sit.label, query: sit.query, catalog: sit.catalog,
      A, B, C,
      metrics: {
        overlap_AB: overlap(A, B), overlap_BC: overlap(B, C), overlap_AC: overlap(A, C),
        bTopScore: bTop, cMaxFit: Number(cMax.toFixed(2)),
        bAbstain, cAbstain, bAgreeWithOracle: `${bGood}/3`,
      },
    })

    console.log(`▌ ${sit.label}`)
    console.log(`  A: ${A.map(x => x.name).slice(0, 3).join(' · ') || '—'}`)
    console.log(`  B: ${B.map(x => x.name).slice(0, 3).join(' · ')}${bAbstain ? '  [low-confidence]' : ''}`)
    console.log(`  C: ${C.map(x => `${x.name} ${x.score.toFixed(2)}`).slice(0, 3).join(' · ')}${cAbstain ? '  [oracle abstains]' : ''}`)
    console.log(`  overlap A∩B ${overlap(A, B)} · B∩C ${overlap(B, C)} · B agrees w/ oracle ${bGood}/3\n`)
  }

  const cost = tin * RATE.in + tout * RATE.out
  const report = {
    judgeModel: JUDGE_MODEL,
    tokens: { input: tin, output: tout },
    estCostUSD: Number(cost.toFixed(4)),
    rateNote: 'assumed Sonnet list pricing $3/MTok in, $15/MTok out',
    summary: {
      avg_overlap_BC: Number((out.reduce((s, o) => s + o.metrics.overlap_BC, 0) / out.length).toFixed(1)),
      avg_overlap_AB: Number((out.reduce((s, o) => s + o.metrics.overlap_AB, 0) / out.length).toFixed(1)),
      bAbstainedOnBlackTie: out.find(o => o.id === 'black-tie-gala')?.metrics.bAbstain ?? null,
      cAbstainedOnBlackTie: out.find(o => o.id === 'black-tie-gala')?.metrics.cAbstain ?? null,
    },
    situations: out,
  }
  mkdirSync(join(ROOT, '.enrichment'), { recursive: true })
  writeFileSync(join(ROOT, '.enrichment/situation-spike.json'), JSON.stringify(report, null, 2))
  console.log(`judge cost: ${tin}+${tout} tok ~$${report.estCostUSD}`)
  console.log(`avg overlap  A∩B ${report.summary.avg_overlap_AB}/6 · B∩C ${report.summary.avg_overlap_BC}/6`)
  console.log(`black-tie abstain  B:${report.summary.bAbstainedOnBlackTie}  C:${report.summary.cAbstainedOnBlackTie}`)
  console.log(`→ .enrichment/situation-spike.json`)
}

main()
