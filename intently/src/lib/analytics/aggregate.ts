// ─────────────────────────────────────────────
// analytics/aggregate.ts — pure aggregations over the event stream.
//
// Server computes once per page load (local scale: scanning a JSONL of
// thousands of lines is instant); the client only renders. Every metric here
// has a matching "what / how / why" explanation in the analytics page —
// keep the two in sync.
//
// Honesty rules baked in:
//   · Purchase/checkout is NOT instrumented (the host storefront owns it) —
//     the funnel ends at add-to-cart, labeled as a proxy conversion.
//   · Costs use the PRICES table; providers whose price is an estimate are
//     flagged so the UI can label them.
// ─────────────────────────────────────────────

import { loadEvents, PRICES, isSeededSession, type TurnEvent, type CartEvent, type OrderEvent } from './events'
import { isPublicDemo } from '@/lib/public-demo'

export interface FunnelStep { key: string; label: string; sessions: number; note?: string }

export interface DailyPoint { day: string; costUsd: number; turns: number; llmCalls: number }

export interface ArmStats {
  arm: 'A' | 'B'
  turns: number
  sessions: number
  escalated: number
  genAccepted: number
  genAttempted: number
  groundingRejections: number
  costUsd: number
  latencyP50: number | null
  cartAdds: number          // adds from sessions assigned to this arm
}

export interface Aggregates {
  range: { since: string; events: number }
  // Commerce
  funnel: FunnelStep[]
  orders: number
  attributedOrders: number
  revenueUsd: number | null      // null when no order carried a total
  aovUsd: number | null          // average order value over orders WITH totals
  cartAdds: number
  cartAddsBySurface: { surface: string; count: number }[]
  itemsPerCartSession: number | null
  topQueries: { query: string; count: number; zeroResult: boolean }[]
  zeroResultQueries: { query: string; count: number }[]
  // Public demo: typed queries from real visitors, counted but not shown.
  hiddenVisitorQueries: number
  topProducts: { title: string; count: number }[]
  // Conversation
  turns: number
  sessions: number
  turnsPerSession: number | null
  escalationRate: number | null   // escalated / eligible (non-answer) turns
  llmTurnRate: number | null      // turns where an LLM actually ran
  questionsAsked: number
  answerRate: number | null       // tapped answers / questions asked
  genAccepted: number
  genRejected: number
  groundingRejections: number
  latencyP50: number | null
  latencyP95: number | null
  // Budget
  totalCostUsd: number
  costByProvider: { provider: string; costUsd: number; tokensIn: number; tokensOut: number; estimated: boolean }[]
  costByStage: { stage: string; costUsd: number }[]
  costPerTurn: number | null
  costPerEscalatedTurn: number | null
  costPerSession: number | null
  costPerCartAdd: number | null
  daily: DailyPoint[]             // trailing series (within range, padded days)
  projectedMonthUsd: number | null // trailing-7d daily avg × 28
  // Online A/B — null when no experiment turns exist in range
  arms: ArmStats[] | null
}

const pct = (n: number, d: number): number | null => (d > 0 ? n / d : null)
const quantile = (xs: number[], q: number): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}

export async function aggregate(sinceIso: string): Promise<Aggregates> {
  const all = await loadEvents(sinceIso)
  const turns = all.filter((e): e is TurnEvent => e.type === 'turn')
  const carts = all.filter((e): e is CartEvent => e.type === 'cart')
  const orders = all.filter((e): e is OrderEvent => e.type === 'order')

  const sessionsWithTurn = new Set(turns.map(t => t.sessionId))
  const sessionsWithResults = new Set(turns.filter(t => t.resultCount > 0).map(t => t.sessionId))
  const sessionsWithCart = new Set(carts.map(c => c.sessionId))
  const sessionsWithOrder = new Set(orders.map(o => o.sessionId).filter((s): s is string => !!s))
  const withTotals = orders.filter(o => typeof o.totalUsd === 'number')
  const revenueUsd = withTotals.length ? withTotals.reduce((s, o) => s + (o.totalUsd ?? 0), 0) : null

  // ── Commerce ──
  // The purchase step is LIVE once the order webhook delivers events; only
  // attributed orders (those carrying an Intently session id) count as funnel
  // sessions — unattributed orders show in the note, never inflate the bar.
  const purchaseStep: FunnelStep = orders.length
    ? {
        key: 'purchase', label: 'Purchased', sessions: sessionsWithOrder.size,
        note: sessionsWithOrder.size < orders.length
          ? `${orders.length - sessionsWithOrder.size} more order(s) without session attribution`
          : 'via order webhook',
      }
    : { key: 'purchase', label: 'Purchased', sessions: -1, note: 'no order webhook events — see docs/medusa-cloud-plan.md §5' }

  const funnel: FunnelStep[] = [
    { key: 'sessions', label: 'Sessions (≥1 query)', sessions: sessionsWithTurn.size },
    { key: 'results', label: 'Saw results', sessions: sessionsWithResults.size },
    { key: 'cart', label: 'Added to cart', sessions: sessionsWithCart.size, note: 'proxy conversion' },
    purchaseStep,
  ]

  const bySurface = new Map<string, number>()
  for (const c of carts) bySurface.set(c.surface, (bySurface.get(c.surface) ?? 0) + 1)

  const queryCounts = new Map<string, { count: number; zero: number }>()
  const showText = (t: TurnEvent) => !isPublicDemo() || isSeededSession(t.sessionId)
  let hiddenVisitorQueries = 0
  for (const t of turns) {
    if (t.answered) continue // tapped options aren't typed demand
    if (!showText(t)) { hiddenVisitorQueries += 1; continue }
    const q = t.query.toLowerCase()
    const cur = queryCounts.get(q) ?? { count: 0, zero: 0 }
    cur.count += 1
    if (t.resultCount === 0 && !t.questionAsked) cur.zero += 1
    queryCounts.set(q, cur)
  }
  const topQueries = [...queryCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count).slice(0, 10)
    .map(([query, v]) => ({ query, count: v.count, zeroResult: v.zero > 0 }))
  const zeroResultQueries = [...queryCounts.entries()]
    .filter(([, v]) => v.zero > 0)
    .sort((a, b) => b[1].zero - a[1].zero).slice(0, 10)
    .map(([query, v]) => ({ query, count: v.zero }))

  const productCounts = new Map<string, number>()
  for (const c of carts) productCounts.set(c.title || c.productId, (productCounts.get(c.title || c.productId) ?? 0) + 1)
  const topProducts = [...productCounts.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([title, count]) => ({ title, count }))

  // ── Conversation ──
  const eligible = turns.filter(t => !t.answered)
  const escalated = eligible.filter(t => t.escalated)
  const llmTurns = turns.filter(t => t.parse !== null || t.generate !== null)
  const questionsAsked = turns.filter(t => t.questionAsked).length
  const answeredTurns = turns.filter(t => t.answered).length
  const latencies = turns.map(t => t.latencyMs)

  // ── Budget ──
  const provAgg = new Map<string, { costUsd: number; tokensIn: number; tokensOut: number }>()
  let parseCost = 0
  let genCost = 0
  for (const t of turns) {
    for (const [stage, use] of [['parse', t.parse], ['generate', t.generate]] as const) {
      if (!use) continue
      const cur = provAgg.get(use.provider) ?? { costUsd: 0, tokensIn: 0, tokensOut: 0 }
      cur.costUsd += use.costUsd; cur.tokensIn += use.tokensIn; cur.tokensOut += use.tokensOut
      provAgg.set(use.provider, cur)
      if (stage === 'parse') parseCost += use.costUsd
      else genCost += use.costUsd
    }
  }
  const totalCostUsd = parseCost + genCost

  // Daily series over the range (capped at the trailing 28 days for display).
  const dayOf = (ts: string) => ts.slice(0, 10)
  const dailyMap = new Map<string, DailyPoint>()
  for (const t of turns) {
    const day = dayOf(t.ts)
    const cur = dailyMap.get(day) ?? { day, costUsd: 0, turns: 0, llmCalls: 0 }
    cur.turns += 1
    for (const use of [t.parse, t.generate]) {
      if (!use) continue
      cur.costUsd += use.costUsd
      cur.llmCalls += 1
    }
    dailyMap.set(day, cur)
  }
  const daily = [...dailyMap.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-28)

  // Forward burn: trailing-7-day daily average × 28.
  const last7 = daily.slice(-7)
  const projectedMonthUsd = last7.length
    ? (last7.reduce((s, d) => s + d.costUsd, 0) / last7.length) * 28
    : null

  // ── Online A/B arm comparison ──
  const armTurns = turns.filter(t => t.arm === 'A' || t.arm === 'B')
  let arms: ArmStats[] | null = null
  if (armTurns.length) {
    // Sessions are sticky per arm, so a session's cart adds credit its arm.
    const sessionArm = new Map<string, 'A' | 'B'>()
    for (const t of armTurns) if (t.arm) sessionArm.set(t.sessionId, t.arm)
    arms = (['A', 'B'] as const).map(a => {
      const ts = armTurns.filter(t => t.arm === a)
      const cost = ts.reduce((s, t) => s + (t.parse?.costUsd ?? 0) + (t.generate?.costUsd ?? 0), 0)
      return {
        arm: a,
        turns: ts.length,
        sessions: new Set(ts.map(t => t.sessionId)).size,
        escalated: ts.filter(t => t.escalated && !t.answered).length,
        genAccepted: ts.filter(t => t.generate?.accepted).length,
        genAttempted: ts.filter(t => t.generate).length,
        groundingRejections: ts.filter(t => t.generate?.groundingRejected).length,
        costUsd: cost,
        latencyP50: quantile(ts.map(t => t.latencyMs), 0.5),
        cartAdds: carts.filter(c => sessionArm.get(c.sessionId) === a).length,
      }
    })
  }

  return {
    range: { since: sinceIso, events: all.length },
    funnel,
    orders: orders.length,
    attributedOrders: sessionsWithOrder.size,
    revenueUsd,
    aovUsd: withTotals.length ? (revenueUsd ?? 0) / withTotals.length : null,
    cartAdds: carts.length,
    cartAddsBySurface: [...bySurface.entries()].map(([surface, count]) => ({ surface, count })),
    itemsPerCartSession: pct(carts.length, sessionsWithCart.size),
    topQueries,
    hiddenVisitorQueries,
    zeroResultQueries,
    topProducts,
    turns: turns.length,
    sessions: sessionsWithTurn.size,
    turnsPerSession: pct(turns.length, sessionsWithTurn.size),
    escalationRate: pct(escalated.length, eligible.length),
    llmTurnRate: pct(llmTurns.length, turns.length),
    questionsAsked,
    answerRate: pct(answeredTurns, questionsAsked),
    genAccepted: turns.filter(t => t.generate?.accepted).length,
    genRejected: turns.filter(t => t.generate && !t.generate.accepted).length,
    groundingRejections: turns.filter(t => t.generate?.groundingRejected).length,
    latencyP50: quantile(latencies, 0.5),
    latencyP95: quantile(latencies, 0.95),
    totalCostUsd,
    costByProvider: [...provAgg.entries()].map(([provider, v]) => ({
      provider, ...v, estimated: PRICES[provider]?.estimated ?? true,
    })).sort((a, b) => b.costUsd - a.costUsd),
    costByStage: [
      { stage: 'comprehension (parse)', costUsd: parseCost },
      { stage: 're-voicing (generate)', costUsd: genCost },
    ],
    costPerTurn: pct(totalCostUsd, turns.length),
    costPerEscalatedTurn: pct(totalCostUsd, escalated.length),
    costPerSession: pct(totalCostUsd, sessionsWithTurn.size),
    costPerCartAdd: pct(totalCostUsd, carts.length),
    daily,
    projectedMonthUsd,
    arms,
  }
}
