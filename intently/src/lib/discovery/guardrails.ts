// ─────────────────────────────────────────────
// discovery/guardrails.ts  ·  SERVER ONLY
//
// Tier-0 ground rules for the LLM-driven conversation. The STRUCTURAL
// containment is already in the architecture (see wiki tiered-conversation):
//   · the parser's output is clamped to the shopping vocabulary — off-topic or
//     adversarial text yields an empty patch, and the engine answers on-topic;
//   · raw shopper text NEVER reaches the re-voicer (it rephrases engine text +
//     validated signals only), so prompt injection can't steer what Intently
//     says; the assistant never echoes raw input back.
// What's left is RESOURCE abuse — scripted hammering, oversized inputs,
// runaway spend — which these limits cover:
//   1. Query size cap (shopping situations are a sentence, not an essay).
//   2. Per-IP rate limit (sliding minute window + daily count).
//   3. Global daily LLM-call budget — when exhausted, the conversation quietly
//      continues on the deterministic path ("return something nice"), it never
//      errors at the shopper.
//
// All state is in-memory: fine for the single-replica demo, NOT for prod
// (multi-replica needs a shared store — see prodprep.md).
// ─────────────────────────────────────────────

const MAX_QUERY_CHARS = 280

const RATE_PER_MIN = Number(process.env.DISCOVERY_RATE_PER_MIN || 20)
const RATE_PER_DAY = Number(process.env.DISCOVERY_RATE_PER_DAY || 400)
const LLM_DAILY_CAP = Number(process.env.DISCOVERY_LLM_DAILY_CAP || 2000)

/** Trim, collapse whitespace, and hard-cap the query. Empty stays empty. */
export function sanitizeQuery(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_CHARS)
}

// ── Per-IP rate limiting ──

interface IpState {
  minuteHits: number[]   // timestamps (ms) within the last minute
  dayCount: number
  dayStamp: string       // UTC date the dayCount belongs to
}

const ipStates = new Map<string, IpState>()
const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10)

export interface RateResult {
  ok: boolean
  retryAfterSeconds?: number
}

/**
 * Sliding-minute + per-day limit per client IP. Counts the request when
 * allowed. `now` injectable for tests.
 */
export function checkRateLimit(
  ip: string,
  now: number = Date.now(),
  limits: { perMin?: number; perDay?: number } = {},
): RateResult {
  const perMin = limits.perMin ?? RATE_PER_MIN
  const perDay = limits.perDay ?? RATE_PER_DAY
  // Opportunistic cleanup so the map can't grow unboundedly.
  if (ipStates.size > 10_000) ipStates.clear()

  const day = utcDay(now)
  let s = ipStates.get(ip)
  if (!s || s.dayStamp !== day) {
    s = { minuteHits: [], dayCount: 0, dayStamp: day }
    ipStates.set(ip, s)
  }
  s.minuteHits = s.minuteHits.filter(t => now - t < 60_000)

  if (s.dayCount >= perDay) return { ok: false, retryAfterSeconds: 3600 }
  if (s.minuteHits.length >= perMin) {
    const oldest = s.minuteHits[0]
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((60_000 - (now - oldest)) / 1000)) }
  }

  s.minuteHits.push(now)
  s.dayCount++
  return { ok: true }
}

// ── Global daily LLM-call budget ──

let llmDayStamp = ''
let llmCallsToday = 0

/**
 * Reserve one LLM call from today's global budget. False = budget exhausted →
 * the caller skips the LLM and the deterministic path answers (no shopper-
 * visible error, ever). `now` injectable for tests.
 */
export function takeLlmBudget(now: number = Date.now(), cap: number = LLM_DAILY_CAP): boolean {
  const day = utcDay(now)
  if (day !== llmDayStamp) {
    llmDayStamp = day
    llmCallsToday = 0
  }
  if (llmCallsToday >= cap) return false
  llmCallsToday++
  return true
}

/** Test/observability helpers. */
export function _resetGuardrails(): void {
  ipStates.clear()
  llmDayStamp = ''
  llmCallsToday = 0
}
export function llmBudgetUsedToday(): number {
  return llmCallsToday
}
