// ─────────────────────────────────────────────
// public-demo.ts
//
// INTENTLY_PUBLIC_DEMO=1 turns a deployment into the open-web demo: no
// password, and the Studio becomes a per-visitor SANDBOX —
//
//   · every Studio change is stored against the visitor's session only
//     (store/sandbox.ts, 24 h TTL) and never touches shared state;
//   · actions that would spend money or mutate shared data (vision
//     enrichment, embedding sync, vector deletes, the model bench's live LLM
//     calls, the data reset) are refused server-side — see
//     public-demo-guard.ts;
//   · cost limits are server-owned: a session can never raise them
//     (discovery/runtime-config.ts).
//
// Default off: local dev, CI and a private operator deployment are unchanged.
//
// Dependency-free on purpose (no next/server, no 'server-only'): proxy.ts
// imports the constants, and the doc-store imports this from code that also
// runs under jsdom tests.
// ─────────────────────────────────────────────

export const SANDBOX_COOKIE = 'intently_sandbox'
/** Request header the proxy sets on EVERY request in public mode (it always
 *  overwrites any client-supplied value), so the id is available on a
 *  visitor's first request, before the cookie has round-tripped. */
export const SANDBOX_HEADER = 'x-intently-sandbox'
export const SANDBOX_TTL_SECONDS = 60 * 60 * 24

export function isPublicDemo(): boolean {
  return process.env.INTENTLY_PUBLIC_DEMO === '1'
}

const ID_RE = /^[a-f0-9]{32}$/
export const isValidSandboxId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v)

export function newSandboxId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The current request's sandbox id, or null outside a request / when absent.
 * Header first (always set by the proxy in public mode), cookie as a fallback.
 */
export async function currentSandboxId(): Promise<string | null> {
  try {
    const { headers, cookies } = await import('next/headers')
    const fromHeader = (await headers()).get(SANDBOX_HEADER)
    if (isValidSandboxId(fromHeader)) return fromHeader
    const fromCookie = (await cookies()).get(SANDBOX_COOKIE)?.value
    return isValidSandboxId(fromCookie) ? fromCookie : null
  } catch {
    return null // not in a request scope (scripts, tests)
  }
}
