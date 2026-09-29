// ─────────────────────────────────────────────────────────────────
// Seed DEMO analytics events — synthetic, clearly for demos/dev only.
//
//   node scripts/seed-analytics.mjs [days=14] [sessionsPerDay=12]
//
// Writes .enrichment/events/events.jsonl (append). Shapes mirror
// src/lib/analytics/events.ts exactly. Uses plausible distributions:
// ~40% escalation, ~55% question-answer rate, ~30% of sessions add to
// cart, ~20% of adds from the companion rail, occasional grounding
// rejections and zero-result queries.
// ─────────────────────────────────────────────────────────────────

import { appendFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const OUT = join(process.cwd(), '.enrichment/events/events.jsonl')
mkdirSync(dirname(OUT), { recursive: true })

const DAYS = Number(process.argv[2] ?? 14)
const SESSIONS_PER_DAY = Number(process.argv[3] ?? 12)

const QUERIES = [
  'blue casual shirt for a summer evening',
  "dress for a friend's wedding in July, outdoors, smart casual",
  'I hate florals — something elegant for a dinner',
  'something warm for cold autumn evenings',
  'relaxed weekend outfit for the city',
  'black tie gala, nothing shiny',
  'a black dress',
  'linen trousers',
  'something for the office that isn\'t boring',
  // Deliberately UNCOVERED demand (no situation matches) — feeds the
  // "Suggested from shopper demand" miner on the Situations page.
  'waterproof jacket for dog walks',
  'waterproof coat for rainy school runs',
  'going to a music festival next month',
  'festival look with boots',
  'what should i pack for a festival',
]
const PRODUCTS = [
  'Forever New Women Floral Purple Dress',
  'Arrow Woman Multi Coloured Floral Dress',
  'Mineral Women Floral Orange Dress',
  'Femella Women Floral Red Dress',
  'Tonga White Floral Design Dress',
]
const PROVIDERS = ['openai', 'deepseek']
const PRICE = { openai: { i: 0.20, o: 1.25 }, deepseek: { i: 0.27, o: 1.10 } }

const rnd = (n) => Math.floor(Math.random() * n)
const pick = (xs) => xs[rnd(xs.length)]
const chance = (p) => Math.random() < p

// Cloud mode: seed straight into Supabase (matches the app's EventSink) when
// INTENTLY_STORE=supabase + creds are present. Else append to the local JSONL.
const CLOUD = process.env.INTENTLY_STORE === 'supabase'
  && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
const collected = []
let lines = 0
const emit = (e) => {
  if (CLOUD) { collected.push(e) } else { appendFileSync(OUT, JSON.stringify(e) + '\n') }
  lines++
}

async function flushCloud() {
  const base = process.env.SUPABASE_URL.replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const post = async (table, rows) => {
    if (!rows.length) return
    for (let i = 0; i < rows.length; i += 500) {
      const res = await fetch(`${base}/rest/v1/${table}`, {
        method: 'POST',
        headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', prefer: 'return=minimal' },
        body: JSON.stringify(rows.slice(i, i + 500)),
      })
      if (!res.ok) throw new Error(`${table} insert ${res.status}: ${(await res.text()).slice(0, 200)}`)
    }
  }
  const turnRow = (e) => ({
    ts: e.ts, session_id: e.sessionId, turn: e.turn, query: e.query, query_chars: e.queryChars,
    escalated: e.escalated, answered: e.answered, result_count: e.resultCount, question_asked: e.questionAsked,
    latency_ms: e.latencyMs,
    parse_provider: e.parse?.provider ?? null, parse_model: e.parse?.model ?? null,
    parse_tokens_in: e.parse?.tokensIn ?? null, parse_tokens_out: e.parse?.tokensOut ?? null,
    parse_cost_usd: e.parse?.costUsd ?? null, parse_ok: e.parse?.ok ?? null,
    gen_provider: e.generate?.provider ?? null, gen_model: e.generate?.model ?? null,
    gen_tokens_in: e.generate?.tokensIn ?? null, gen_tokens_out: e.generate?.tokensOut ?? null,
    gen_cost_usd: e.generate?.costUsd ?? null, gen_accepted: e.generate?.accepted ?? null,
    gen_grounding_rejected: e.generate?.groundingRejected ?? null, arm: e.arm ?? null,
  })
  await post('analytics_turn_events', collected.filter(e => e.type === 'turn').map(turnRow))
  await post('analytics_cart_events', collected.filter(e => e.type === 'cart').map(e => ({
    ts: e.ts, session_id: e.sessionId, product_id: e.productId, title: e.title, surface: e.surface,
  })))
  await post('analytics_order_events', collected.filter(e => e.type === 'order').map(e => ({
    ts: e.ts, order_id: e.orderId, session_id: e.sessionId, total_usd: e.totalUsd, items: e.items, source: e.source,
  })))
}

for (let d = DAYS - 1; d >= 0; d--) {
  const day = new Date(Date.now() - d * 86400e3)
  for (let s = 0; s < SESSIONS_PER_DAY + rnd(6) - 3; s++) {
    const sessionId = `demo-${randomUUID().slice(0, 8)}`
    const nTurns = 1 + rnd(4)
    let sawResults = false
    for (let t = 1; t <= nTurns; t++) {
      const ts = new Date(day.getTime() + rnd(86400e3)).toISOString()
      const query = pick(QUERIES)
      const zero = query.includes('waterproof') && chance(0.7)
      const answered = t > 1 && chance(0.55)
      const escalated = !answered && (query.length > 40 || /hate|nothing|isn't/.test(query)) && chance(0.9)
      const provider = pick(PROVIDERS)
      const price = PRICE[provider]
      const mkStage = (tokIn, tokOut, ok) => ({
        provider, model: null, tokensIn: tokIn, tokensOut: tokOut,
        costUsd: (tokIn * price.i + tokOut * price.o) / 1e6, ok,
      })
      const parse = escalated ? mkStage(700 + rnd(300), 60 + rnd(60), chance(0.95)) : null
      const genAttempted = escalated && chance(0.8)
      const accepted = genAttempted && chance(0.85)
      const groundingRejected = genAttempted && !accepted && chance(0.5)
      const generate = genAttempted
        ? { ...mkStage(500 + rnd(200), 120 + rnd(120), accepted), accepted, groundingRejected }
        : null
      const resultCount = zero ? 0 : (t === 1 && !answered && chance(0.5) ? 0 : 6 + rnd(3))
      if (resultCount > 0) sawResults = true
      emit({
        type: 'turn', ts, sessionId, turn: t,
        queryChars: query.length, query,
        escalated, answered, resultCount,
        questionAsked: resultCount === 0 ? !zero : chance(0.3),
        parse, generate,
        latencyMs: escalated ? 1200 + rnd(1800) : 15 + rnd(60),
      })
    }
    if (sawResults && chance(0.3)) {
      const adds = 1 + (chance(0.35) ? 1 : 0)
      for (let a = 0; a < adds; a++) {
        emit({
          type: 'cart', ts: new Date(day.getTime() + rnd(86400e3)).toISOString(),
          sessionId, productId: `p-${rnd(999)}`, title: pick(PRODUCTS),
          surface: chance(0.2) ? 'companion' : 'reveal',
        })
      }
      // ~40% of cart sessions convert to an order (webhook-delivered);
      // one in four orders arrives without session attribution — honest demo.
      if (chance(0.4)) {
        const total = 39 + rnd(160) + 0.99
        emit({
          type: 'order', ts: new Date(day.getTime() + rnd(86400e3)).toISOString(),
          orderId: `demo-ord-${randomUUID().slice(0, 8)}`,
          sessionId: chance(0.75) ? sessionId : null,
          totalUsd: Math.round(total * 100) / 100,
          items: [{ productId: `p-${rnd(999)}`, title: pick(PRODUCTS), quantity: 1, unitUsd: total }],
          source: 'medusa',
        })
      }
    }
  }
}

if (CLOUD) {
  await flushCloud()
  console.log(`seeded ${lines} demo events → Supabase (${collected.filter(e => e.type === 'turn').length} turns, ${collected.filter(e => e.type === 'cart').length} carts, ${collected.filter(e => e.type === 'order').length} orders)`)
  console.log("NOTE: synthetic demo data (session ids prefixed 'demo-'). Reset: delete rows where session_id like 'demo-%'.")
} else {
  console.log(`seeded ${lines} demo events → ${OUT}`)
  console.log('NOTE: synthetic demo data. Delete the file to reset: rm .enrichment/events/events.jsonl')
}
