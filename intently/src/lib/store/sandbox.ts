// ─────────────────────────────────────────────
// store/sandbox.ts  ·  SERVER ONLY
//
// Per-visitor document storage for the public demo (see public-demo.ts). One
// value per (session, document key), expiring after 24 h. The doc-store routes
// reads and writes here in public mode, so a visitor's Studio changes are
// theirs alone and nothing shared is ever written.
//
// Backend: Upstash Redis over REST when configured (the deployment has several
// serverless replicas, so process memory would lose a visitor's state between
// requests) — the same raw-fetch pattern as discovery/guardrails-shared.ts.
// Otherwise an in-memory map, which is enough for local dev and tests.
//
// A visitor-supplied document is bounded (MAX_DOC_BYTES); an oversized write
// is refused rather than truncated.
//
// Failure is LOUD. When Redis is configured but unreachable, a write throws
// (SandboxUnavailableError) instead of reporting success — a visitor must never
// be told "saved" when nothing was. Found the hard way: the first public deploy
// ran against a Redis database that no longer existed, and every Studio edit
// silently vanished.
// ─────────────────────────────────────────────

import 'server-only'
import { SANDBOX_TTL_SECONDS } from '@/lib/public-demo'

export const MAX_DOC_BYTES = 64 * 1024

export class SandboxDocTooLargeError extends Error {
  constructor(key: string, bytes: number) {
    super(`sandbox document "${key}" is ${bytes} bytes; the limit is ${MAX_DOC_BYTES}`)
    this.name = 'SandboxDocTooLargeError'
  }
}

export class SandboxUnavailableError extends Error {
  constructor(op: string) {
    super(`the session store is unavailable (${op}) — nothing was saved`)
    this.name = 'SandboxUnavailableError'
  }
}

const URL_ = () => process.env.UPSTASH_REDIS_REST_URL
const TOKEN = () => process.env.UPSTASH_REDIS_REST_TOKEN
const redisEnabled = () => !!(URL_() && TOKEN())

const redisKey = (sessionId: string, key: string) => `sandbox:${sessionId}:${key}`

async function redis(commands: (string | number)[][]): Promise<{ result: unknown }[] | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1500)
  try {
    const res = await fetch(`${URL_()}/pipeline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN()}`, 'content-type': 'application/json' },
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

// In-memory fallback: value + absolute expiry.
const memory = new Map<string, { json: string; expiresAt: number }>()

/** The raw JSON stored for this session + key, or null when absent/expired. */
export async function sandboxGet(sessionId: string, key: string): Promise<string | null> {
  const k = redisKey(sessionId, key)
  if (redisEnabled()) {
    const res = await redis([['GET', k]])
    const v = res?.[0]?.result
    return typeof v === 'string' ? v : null
  }
  const hit = memory.get(k)
  if (!hit) return null
  if (hit.expiresAt <= Date.now()) { memory.delete(k); return null }
  return hit.json
}

export async function sandboxSet(sessionId: string, key: string, json: string): Promise<void> {
  const bytes = Buffer.byteLength(json, 'utf8')
  if (bytes > MAX_DOC_BYTES) throw new SandboxDocTooLargeError(key, bytes)
  const k = redisKey(sessionId, key)
  if (redisEnabled()) {
    const res = await redis([['SET', k, json, 'EX', SANDBOX_TTL_SECONDS]])
    if (res?.[0]?.result !== 'OK') throw new SandboxUnavailableError('write')
    return
  }
  memory.set(k, { json, expiresAt: Date.now() + SANDBOX_TTL_SECONDS * 1000 })
}

/** Remove every listed document for a session ("reset my session"). */
export async function sandboxClear(sessionId: string, keys: readonly string[]): Promise<void> {
  const ks = keys.map(key => redisKey(sessionId, key))
  if (redisEnabled()) {
    if (ks.length && (await redis([['DEL', ...ks]])) === null) throw new SandboxUnavailableError('clear')
    return
  }
  for (const k of ks) memory.delete(k)
}

/** Test seam. */
export function _resetSandboxMemory(): void {
  memory.clear()
}
