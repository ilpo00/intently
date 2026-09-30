// ─────────────────────────────────────────────
// discovery/guardrails-shared.ts  ·  SERVER ONLY
//
// Replica-safe counters for the two guardrails whose in-memory versions are
// the one silent-corruption risk on cloud (ADR-012 C1): the per-IP rate
// limit and the global daily LLM budget. On N serverless replicas the
// in-memory caps multiply to cap × N; a shared atomic counter restores the
// real cap.
//
// WHY UPSTASH (and not Postgres): these are per-request hot counters — one
// INCR before every turn and before every LLM call. Redis INCR is O(1),
// serverless-friendly over REST (no connection pooling problem), and the
// daily keys expire themselves (EXPIRE), so there is nothing to clean up.
// Putting this on Supabase would spend a Postgres round-trip + row churn on
// every request for data with a 24h lifespan — the wrong tool.
//
// Wiring: set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (from the
// Upstash console, any region near fra1). Unset → transparent fallback to
// the in-memory guardrails, so local dev and CI need nothing. Raw fetch,
// no SDK — the llm-client house pattern. Fail-open: if Redis errors or
// times out, we fall back to the in-memory check for that request (a turn
// must never fail because a counter did).
// ─────────────────────────────────────────────

import 'server-only'
import { checkRateLimit, takeLlmBudget, type RateResult } from './guardrails'

const URL_ = () => process.env.UPSTASH_REDIS_REST_URL
const TOKEN = () => process.env.UPSTASH_REDIS_REST_TOKEN

export function sharedCountersEnabled(): boolean {
  return !!(URL_() && TOKEN())
}

/** One Upstash REST pipeline call. Returns the per-command results, or null. */
async function redisPipeline(commands: (string | number)[][]): Promise<{ result: unknown }[] | null> {
  const url = URL_()
  const token = TOKEN()
  if (!url || !token) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 800) // a counter is never worth a slow turn
  try {
    const res = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(commands),
      signal: controller.signal,
    })
    if (!res.ok) return null
    return (await res.json()) as { result: unknown }[]
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export type SharedStoreStatus = 'not-configured' | 'ok' | 'unavailable'

/**
 * Is the shared store actually answering? The counters fail OPEN (a shopper's
 * turn must never fail because a counter did), which also means a dead Redis
 * is invisible from behaviour alone — limits quietly become per-instance. This
 * is the explicit check the Studio shows, so that state cannot go unnoticed.
 */
export async function sharedStoreStatus(): Promise<SharedStoreStatus> {
  if (!sharedCountersEnabled()) return 'not-configured'
  const res = await redisPipeline([['PING']])
  return res?.[0]?.result === 'PONG' ? 'ok' : 'unavailable'
}

const utcDay = () => new Date().toISOString().slice(0, 10)

/**
 * Replica-safe per-IP rate limit: minute window + daily count, atomic INCR
 * with self-expiring keys. Falls back to the in-memory limiter when Upstash
 * is not configured or unreachable.
 */
export async function checkRateLimitShared(
  ip: string,
  limits: { perMin: number; perDay: number },
): Promise<RateResult> {
  if (!sharedCountersEnabled()) return checkRateLimit(ip, Date.now(), limits)

  const day = utcDay()
  const minuteBucket = Math.floor(Date.now() / 60_000)
  const kMin = `rl:m:${ip}:${minuteBucket}`
  const kDay = `rl:d:${ip}:${day}`
  const res = await redisPipeline([
    ['INCR', kMin], ['EXPIRE', kMin, 90],
    ['INCR', kDay], ['EXPIRE', kDay, 60 * 60 * 26],
  ])
  if (!res) return checkRateLimit(ip, Date.now(), limits) // fail-open to local

  const minCount = Number(res[0]?.result ?? 0)
  const dayCount = Number(res[2]?.result ?? 0)
  if (dayCount > limits.perDay) return { ok: false, retryAfterSeconds: 3600 }
  if (minCount > limits.perMin) return { ok: false, retryAfterSeconds: 60 }
  return { ok: true }
}

/**
 * Replica-safe global daily LLM budget. True reserves one call; over cap →
 * false and the route degrades to the deterministic path, exactly like the
 * in-memory version.
 */
export async function takeLlmBudgetShared(cap: number): Promise<boolean> {
  if (!sharedCountersEnabled()) return takeLlmBudget(Date.now(), cap)

  const k = `llm:budget:${utcDay()}`
  const res = await redisPipeline([['INCR', k], ['EXPIRE', k, 60 * 60 * 26]])
  if (!res) return takeLlmBudget(Date.now(), cap) // fail-open to local
  return Number(res[0]?.result ?? 0) <= cap
}
