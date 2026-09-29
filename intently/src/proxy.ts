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
// ─────────────────────────────────────────────

import { NextResponse, type NextRequest } from 'next/server'

/** Paths that carry their own authentication and must stay machine-reachable. */
const UNGATED = [
  // The host storefront's order webhook: authenticated by
  // x-intently-webhook-secret, called by a backend that cannot do Basic Auth.
  '/api/analytics/order',
]

const ADMIN_PATHS = ['/admin', '/api/admin', '/api/enrichment']

const isPrefixed = (pathname: string, prefixes: string[]) =>
  prefixes.some(p => pathname === p || pathname.startsWith(`${p}/`))

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
  if (isPrefixed(pathname, UNGATED)) return NextResponse.next()

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
  if (!gate) return NextResponse.next()

  const accepted = (isAdmin ? [gate] : [gate, admin]).filter(Boolean)
  const supplied = suppliedPassword(request.headers.get('authorization'))
  if (supplied !== null && accepted.includes(supplied)) return NextResponse.next()

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
