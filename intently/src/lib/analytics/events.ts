// ─────────────────────────────────────────────
// analytics/events.ts  ·  SERVER ONLY
//
// The event layer analytics reads from. Two event types (analytics-plan.md
// Phase 0): a TURN event per discovery request, and a CART event per
// add-to-cart. Emitted fire-and-forget from the routes — an analytics
// failure must never break a shopper turn.
//
// Storage is behind one EventSink seam (the vector-store-factory pattern):
// Phase-1 default is a local JSONL file (.enrichment/events/events.jsonl,
// gitignored, single-replica); the Supabase impl plugs in at cloud merge
// (migration 0012). Tests point INTENTLY_EVENTS_DIR at a temp dir so the
// suite never reads developer-local events.
//
// Costs: per-1M-token prices, env-overridable. OpenAI gpt-5.4-nano is the
// verified list price (2026-07-15); DeepSeek/Haiku defaults are ESTIMATES —
// the analytics page labels them as such. Tokens are the hard number.
// ─────────────────────────────────────────────

import { appendFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { supabaseConfigured, insert, select, remove } from '@/lib/supabase/rest'

/** Cloud store is active only when explicitly selected AND configured — local
 *  file remains the default so dev and CI need nothing. */
export function supabaseStoreActive(): boolean {
  return process.env.INTENTLY_STORE === 'supabase' && supabaseConfigured()
}

// ── Event shapes ──

export interface TurnEvent {
  type: 'turn'
  ts: string               // ISO timestamp
  sessionId: string        // anonymous, client-minted per browser session
  turn: number             // 1-based within the session (client-counted)
  queryChars: number       // length only — never the raw query text (privacy)
  query: string            // sanitized query (≤280 chars, for top/zero-result lists)
  escalated: boolean       // complexity gate verdict
  answered: boolean        // was this a tapped consultation option?
  resultCount: number
  questionAsked: boolean   // did the tailor ask (blocking or sharpening)?
  parse: StageUse | null   // null = stage off / not escalated
  generate: (StageUse & { accepted: boolean; groundingRejected: boolean }) | null
  latencyMs: number        // whole-route latency
  arm?: 'A' | 'B'          // online A/B arm (absent = no experiment running)
}

export interface StageUse {
  provider: string
  model: string | null     // null = provider default
  tokensIn: number
  tokensOut: number
  costUsd: number          // computed at emit time from the price table
  ok: boolean              // did the LLM produce a usable result?
}

export interface CartEvent {
  type: 'cart'
  ts: string
  sessionId: string
  productId: string        // variant/product id as the surface knows it
  title: string
  surface: 'reveal' | 'companion' | 'unknown' // where the add happened
}

export interface OrderItem {
  productId: string
  title: string
  quantity: number
  unitUsd: number
}

/** A completed order reported by the host storefront's webhook (order.placed).
 *  sessionId is present only when the storefront carried the Intently session
 *  id through checkout — the funnel treats missing ids honestly. */
export interface OrderEvent {
  type: 'order'
  ts: string
  orderId: string
  sessionId: string | null
  totalUsd: number | null
  items: OrderItem[]
  source: string           // 'medusa' | future sources
}

export type AnalyticsEvent = TurnEvent | CartEvent | OrderEvent

// ── Token accounting (mutable meter passed down into the LLM client) ──

export interface UsageMeter {
  tokensIn: number
  tokensOut: number
}
export const newMeter = (): UsageMeter => ({ tokensIn: 0, tokensOut: 0 })

// ── Prices (USD per 1M tokens). Env-overridable; estimates labeled in UI. ──

const price = (k: string, fallback: number) => Number(process.env[k] ?? fallback)
export const PRICES: Record<string, { in: number; out: number; estimated: boolean }> = {
  // Verified list price (developers.openai.com pricing, 2026-07-15).
  openai: { in: price('ANALYTICS_PRICE_OPENAI_IN', 0.20), out: price('ANALYTICS_PRICE_OPENAI_OUT', 1.25), estimated: false },
  // Verified list price for deepseek-v4-flash non-thinking, CACHE-MISS input
  // (api-docs.deepseek.com/quick_start/pricing, 2026-07-16). Conservative:
  // cache hits cost ~50× less, so real spend can only be lower.
  deepseek: { in: price('ANALYTICS_PRICE_DEEPSEEK_IN', 0.14), out: price('ANALYTICS_PRICE_DEEPSEEK_OUT', 0.28), estimated: false },
  // Assumed list price — same stance as scripts/vision-enrich.mjs RATE.
  haiku: { in: price('ANALYTICS_PRICE_HAIKU_IN', 1.00), out: price('ANALYTICS_PRICE_HAIKU_OUT', 5.00), estimated: true },
}

export function costUsd(provider: string, m: UsageMeter): number {
  const p = PRICES[provider]
  if (!p) return 0
  return (m.tokensIn * p.in + m.tokensOut * p.out) / 1e6
}

// ── The sink (local JSONL; the Supabase impl replaces this at cloud merge) ──

export function eventsPath(): string {
  return process.env.INTENTLY_EVENTS_DIR
    ? join(process.env.INTENTLY_EVENTS_DIR, 'events.jsonl')
    : join(process.cwd(), '.enrichment/events/events.jsonl')
}

/** Delete all event history (the reset path). Unlike the write path this
 *  DOES throw: a reset that silently failed would leave a demo showing last
 *  week's funnel while claiming to be clean. `ts=gte.1970-01-01` is PostgREST's
 *  way of saying "every row" — it refuses an unfiltered DELETE. */
export async function clearAnalytics(): Promise<void> {
  if (supabaseStoreActive()) {
    const filter = 'ts=gte.1970-01-01'
    for (const table of ['analytics_turn_events', 'analytics_cart_events', 'analytics_order_events']) {
      if (!(await remove(table, filter))) throw new Error(`could not clear ${table}`)
    }
    return
  }
  try {
    rmSync(eventsPath())
  } catch {
    /* already absent — clearing is idempotent */
  }
}

/** Append one event. Never throws — analytics must not break a shopper turn.
 *  On the cloud store the local append no-ops (read-only FS) and the row goes
 *  to Supabase fire-and-forget. */
export function emitEvent(e: AnalyticsEvent): void {
  try {
    const p = eventsPath()
    mkdirSync(dirname(p), { recursive: true })
    appendFileSync(p, JSON.stringify(e) + '\n')
  } catch {
    /* fire-and-forget (read-only FS on serverless) */
  }
  if (supabaseStoreActive()) void insertEventSupabase(e)
}

/** Read all events from the LOCAL file (sync). Used by tests and the file
 *  backend. The cloud backend uses loadEvents (async, since-filtered). */
export function readEvents(): AnalyticsEvent[] {
  try {
    return readFileSync(eventsPath(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => {
        try { return JSON.parse(l) as AnalyticsEvent } catch { return null }
      })
      .filter((e): e is AnalyticsEvent => e !== null && (e.type === 'turn' || e.type === 'cart' || e.type === 'order'))
  } catch {
    return []
  }
}

/** Events since `sinceIso`, from whichever backend is active. The one read
 *  path the aggregator/miner use so they work on both local and cloud. */
export async function loadEvents(sinceIso: string): Promise<AnalyticsEvent[]> {
  if (supabaseStoreActive()) {
    const cloud = await loadEventsSupabase(sinceIso)
    if (cloud) return cloud
    // fall through to local on a Supabase read error (never dead-end analytics)
  }
  const since = new Date(sinceIso).getTime()
  return readEvents().filter(e => new Date(e.ts).getTime() >= since)
}

// ── Supabase mapping (flat table rows ⇄ nested event shapes) ──

const gte = (iso: string) => encodeURIComponent(iso)

async function insertEventSupabase(e: AnalyticsEvent): Promise<void> {
  if (e.type === 'turn') {
    await insert('analytics_turn_events', {
      ts: e.ts, session_id: e.sessionId, turn: e.turn, query: e.query, query_chars: e.queryChars,
      escalated: e.escalated, answered: e.answered, result_count: e.resultCount,
      question_asked: e.questionAsked, latency_ms: e.latencyMs,
      parse_provider: e.parse?.provider ?? null, parse_model: e.parse?.model ?? null,
      parse_tokens_in: e.parse?.tokensIn ?? null, parse_tokens_out: e.parse?.tokensOut ?? null,
      parse_cost_usd: e.parse?.costUsd ?? null, parse_ok: e.parse?.ok ?? null,
      gen_provider: e.generate?.provider ?? null, gen_model: e.generate?.model ?? null,
      gen_tokens_in: e.generate?.tokensIn ?? null, gen_tokens_out: e.generate?.tokensOut ?? null,
      gen_cost_usd: e.generate?.costUsd ?? null, gen_accepted: e.generate?.accepted ?? null,
      gen_grounding_rejected: e.generate?.groundingRejected ?? null,
      arm: e.arm ?? null,
    })
  } else if (e.type === 'cart') {
    await insert('analytics_cart_events', {
      ts: e.ts, session_id: e.sessionId, product_id: e.productId, title: e.title, surface: e.surface,
    })
  } else {
    await insert('analytics_order_events', {
      ts: e.ts, order_id: e.orderId, session_id: e.sessionId, total_usd: e.totalUsd,
      items: e.items, source: e.source,
    })
  }
}

interface TurnRow {
  ts: string; session_id: string; turn: number; query: string; query_chars: number
  escalated: boolean; answered: boolean; result_count: number; question_asked: boolean; latency_ms: number
  parse_provider: string | null; parse_model: string | null; parse_tokens_in: number | null
  parse_tokens_out: number | null; parse_cost_usd: string | number | null; parse_ok: boolean | null
  gen_provider: string | null; gen_model: string | null; gen_tokens_in: number | null
  gen_tokens_out: number | null; gen_cost_usd: string | number | null; gen_accepted: boolean | null
  gen_grounding_rejected: boolean | null; arm?: 'A' | 'B' | null
}

async function loadEventsSupabase(sinceIso: string): Promise<AnalyticsEvent[] | null> {
  const q = `select=*&ts=gte.${gte(sinceIso)}&order=ts.asc&limit=100000`
  const [turnRows, cartRows, orderRows] = await Promise.all([
    select<TurnRow>('analytics_turn_events', q),
    select<{ ts: string; session_id: string; product_id: string; title: string; surface: string }>('analytics_cart_events', q),
    select<{ ts: string; order_id: string; session_id: string | null; total_usd: string | number | null; items: OrderItem[]; source: string }>('analytics_order_events', q),
  ])
  if (turnRows === null && cartRows === null && orderRows === null) return null

  const num = (v: string | number | null | undefined): number => (v === null || v === undefined ? 0 : Number(v))
  const turns: TurnEvent[] = (turnRows ?? []).map(r => ({
    type: 'turn', ts: r.ts, sessionId: r.session_id, turn: r.turn, query: r.query, queryChars: r.query_chars,
    escalated: r.escalated, answered: r.answered, resultCount: r.result_count, questionAsked: r.question_asked,
    latencyMs: r.latency_ms,
    parse: r.parse_provider ? { provider: r.parse_provider, model: r.parse_model, tokensIn: num(r.parse_tokens_in), tokensOut: num(r.parse_tokens_out), costUsd: num(r.parse_cost_usd), ok: !!r.parse_ok } : null,
    generate: r.gen_provider ? { provider: r.gen_provider, model: r.gen_model, tokensIn: num(r.gen_tokens_in), tokensOut: num(r.gen_tokens_out), costUsd: num(r.gen_cost_usd), ok: !!r.gen_accepted, accepted: !!r.gen_accepted, groundingRejected: !!r.gen_grounding_rejected } : null,
    ...(r.arm ? { arm: r.arm } : {}),
  }))
  const carts: CartEvent[] = (cartRows ?? []).map(r => ({
    type: 'cart', ts: r.ts, sessionId: r.session_id, productId: r.product_id, title: r.title,
    surface: r.surface === 'companion' ? 'companion' : r.surface === 'reveal' ? 'reveal' : 'unknown',
  }))
  const orders: OrderEvent[] = (orderRows ?? []).map(r => ({
    type: 'order', ts: r.ts, orderId: r.order_id, sessionId: r.session_id,
    totalUsd: r.total_usd === null ? null : Number(r.total_usd), items: r.items ?? [], source: r.source,
  }))
  return [...turns, ...carts, ...orders]
}
