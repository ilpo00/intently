// ─────────────────────────────────────────────
// Site gate — HTTP Basic Auth in front of the WHOLE deployment (pages, assets,
// and API routes), behind one or two shared secrets.
//
// Two independent passwords, either of which may be unset:
//
//   SITE_BASIC_AUTH_PASSWORD   gates everything (the shopper river included).
//   ADMIN_BASIC_AUTH_PASSWORD  gates /admin/* and the admin-mutating APIs.
//
// Resolution per request: admin paths accept the admin password, falling back
// to the site password when no admin password is configured; every other path
// accepts the site password, and also accepts the admin password so a single
// operator credential opens the whole deployment. When the password a path
// resolves to is unset, that path is open — so local dev (no vars) keeps its
// gateless disposition, and a deploy that sets only ADMIN_BASIC_AUTH_PASSWORD
// keeps the pre-2026-07-27 behaviour of a public demo with a private admin.
//
// The two secrets exist so that sharing the demo does not hand out the admin
// inspector: set both, share only the site password. Set them to the same
// value if you don't care about that distinction.
//
// Why this instead of admin-guard.ts: that guard is a non-functional stub
// (always allows) left over from the pre-pivot auth stack — see prodprep.md
// "ADMIN_AUTH_ENABLED". Why not Vercel's native Password Protection: that's a
// Pro-plan feature; this deploy stays on Hobby. Deliberately minimal — shared
// passwords, no session, no per-user identity — enough for a single-operator
// demo, not a substitute for a real allowlist or multi-admin auth.
//
// PUBLIC DEMO (INTENTLY_PUBLIC_DEMO=1): the flag itself opens the gate — the
// passwords are ignored while it is on, so going public and going private again
// is one reversible switch and the secrets never have to be deleted. That is
// safe because public mode makes the admin surface a sandbox and refuses cost
// and shared-data routes server-side (lib/public-demo.ts). In this mode the
// proxy instead gives every visitor a sandbox session — an httpOnly cookie
// plus the same id as a request header, so server code can scope the visitor's
// Studio changes to them alone (lib/public-demo.ts, lib/store/doc-store.ts).
// The header is ALWAYS overwritten here, so a client cannot supply its own.
// ─────────────────────────────────────────────

import { NextResponse, type NextRequest } from 'next/server'
import {
  isPublicDemo, isValidSandboxId, newSandboxId,
  SANDBOX_COOKIE, SANDBOX_HEADER, SANDBOX_TTL_SECONDS,
} from '@/lib/public-demo'

/** Paths that carry their own authentication and must stay machine-reachable. */
const UNGATED = [
  // The host storefront's order webhook: authenticated by
  // x-intently-webhook-secret, called by a backend that cannot do Basic Auth.
  '/api/analytics/order',
  // The daily keep-alive cron: authenticated by Vercel's CRON_SECRET.
  '/api/health/keepalive',
]

const ADMIN_PATHS = ['/admin', '/api/admin', '/api/enrichment']

const isPrefixed = (pathname: string, prefixes: string[]) =>
  prefixes.some(p => pathname === p || pathname.startsWith(`${p}/`))

/** Let the request through. In public-demo mode, attach the visitor's sandbox
 *  session (creating one on first contact); otherwise a plain pass-through. */
function pass(request: NextRequest): NextResponse {
  if (!isPublicDemo()) return NextResponse.next()

  const existing = request.cookies.get(SANDBOX_COOKIE)?.value
  const id = isValidSandboxId(existing) ? existing : newSandboxId()

  const headers = new Headers(request.headers)
  headers.set(SANDBOX_HEADER, id)
  const res = NextResponse.next({ request: { headers } })
  if (id !== existing) {
    res.cookies.set(SANDBOX_COOKIE, id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SANDBOX_TTL_SECONDS,
    })
  }
  // An open demo is still not something to index.
  res.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return res
}

/** The password supplied in a `Basic` header, or null if absent/malformed. */
function suppliedPassword(header: string | null): string | null {
  if (!header?.startsWith('Basic ')) return null
  try {
    const decoded = atob(header.slice(6))
    const separator = decoded.indexOf(':')
    // No colon is not a valid `user:pass` payload — treat it as no credential
    // rather than as an empty-user password, which would be ambiguous.
    return separator === -1 ? null : decoded.slice(separator + 1)
  } catch {
    // Malformed base64. Every request passes through here now, so a junk
    // Authorization header must fail closed, not throw a 500 for the site.
    return null
  }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (isPrefixed(pathname, UNGATED)) return pass(request)
  if (isPublicDemo()) return pass(request) // open by design — see the header

  const site = process.env.SITE_BASIC_AUTH_PASSWORD
  const admin = process.env.ADMIN_BASIC_AUTH_PASSWORD
  const isAdmin = isPrefixed(pathname, ADMIN_PATHS)

  // Two separate questions, deliberately not conflated:
  //
  //   `gate`     — which password's presence turns the gate ON for this path.
  //                Each variable governs its own scope, so setting only the
  //                admin password leaves the shopper river public exactly as
  //                it was before the site gate existed.
  //   `accepted` — which passwords open it once it is on. The admin password
  //                is a master key: it opens shopper routes too, but it never
  //                closes them.
  const gate = isAdmin ? admin ?? site : site
  if (!gate) return pass(request)

  const accepted = (isAdmin ? [gate] : [gate, admin]).filter(Boolean)
  const supplied = suppliedPassword(request.headers.get('authorization'))
  if (supplied !== null && accepted.includes(supplied)) return pass(request)

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${isAdmin ? 'Intently admin' : 'Intently'}"`,
      // A gated deployment is private; keep it out of indexes even on the 401.
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}

export const config = {
  // Everything. Static assets included — the browser replays the credential it
  // was challenged for at `/`, and a "private" site whose JS bundle and product
  // images are anonymously fetchable is not private.
  matcher: ['/:path*'],
}
