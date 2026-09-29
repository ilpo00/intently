/**
 * @jest-environment node
 */
// ─────────────────────────────────────────────
// The site gate (src/proxy.ts). CI runs with neither password set, so the
// default assertion is the one that matters most: unset = open, exactly as
// local dev behaves today.
// ─────────────────────────────────────────────

import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'

const SITE = 'site-secret'
const ADMIN = 'admin-secret'

const basic = (password: string, user = 'intently') =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`

function get(pathname: string, authorization?: string): NextRequest {
  return new NextRequest(`http://localhost${pathname}`, {
    headers: authorization ? { authorization } : {},
  })
}

/** 0 for "allowed through", 401 for "challenged". */
const status = (pathname: string, authorization?: string) =>
  proxy(get(pathname, authorization)).status

const original = { ...process.env }
afterEach(() => {
  process.env = { ...original }
})

describe('site gate — no passwords configured', () => {
  beforeEach(() => {
    delete process.env.SITE_BASIC_AUTH_PASSWORD
    delete process.env.ADMIN_BASIC_AUTH_PASSWORD
  })

  it.each(['/', '/next', '/api/discover', '/admin', '/api/enrichment/search'])(
    'leaves %s open',
    path => expect(status(path)).not.toBe(401),
  )
})

describe('site gate — site password only', () => {
  beforeEach(() => {
    process.env.SITE_BASIC_AUTH_PASSWORD = SITE
    delete process.env.ADMIN_BASIC_AUTH_PASSWORD
  })

  it.each(['/', '/next', '/api/discover', '/api/cart', '/_next/static/chunk.js'])(
    'challenges %s without credentials',
    path => expect(status(path)).toBe(401),
  )

  it('admits the shopper river with the site password', () => {
    expect(status('/next', basic(SITE))).not.toBe(401)
  })

  it('falls back to the site password for admin when no admin password is set', () => {
    expect(status('/admin', basic(SITE))).not.toBe(401)
    expect(status('/admin')).toBe(401)
  })

  it('rejects a wrong password', () => {
    expect(status('/', basic('nope'))).toBe(401)
  })
})

describe('site gate — admin password only (the pre-site-gate deploy)', () => {
  beforeEach(() => {
    delete process.env.SITE_BASIC_AUTH_PASSWORD
    process.env.ADMIN_BASIC_AUTH_PASSWORD = ADMIN
  })

  // The regression this guards: the admin password is accepted on shopper
  // routes, which must not also mean it gates them.
  it.each(['/', '/next', '/api/discover'])(
    'leaves %s public — an admin password never closes the shopper river',
    path => expect(status(path)).not.toBe(401),
  )

  it('still gates admin', () => {
    expect(status('/admin')).toBe(401)
    expect(status('/admin', basic(ADMIN))).not.toBe(401)
  })
})

describe('site gate — both passwords configured', () => {
  beforeEach(() => {
    process.env.SITE_BASIC_AUTH_PASSWORD = SITE
    process.env.ADMIN_BASIC_AUTH_PASSWORD = ADMIN
  })

  it('keeps the site password out of admin', () => {
    expect(status('/admin', basic(SITE))).toBe(401)
    expect(status('/api/enrichment/search', basic(SITE))).toBe(401)
    expect(status('/api/admin/config', basic(SITE))).toBe(401)
  })

  it('admits admin with the admin password', () => {
    expect(status('/admin/enrichment', basic(ADMIN))).not.toBe(401)
  })

  it('lets the admin password open shopper routes too', () => {
    expect(status('/next', basic(ADMIN))).not.toBe(401)
  })

  it('challenges admin and shopper paths in distinct realms', () => {
    const realm = (path: string) =>
      proxy(get(path)).headers.get('WWW-Authenticate')
    expect(realm('/admin')).toContain('realm="Intently admin"')
    expect(realm('/')).toContain('realm="Intently"')
  })

  it('marks the challenge noindex', () => {
    expect(proxy(get('/')).headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  })
})

describe('site gate — exemptions and malformed credentials', () => {
  beforeEach(() => {
    process.env.SITE_BASIC_AUTH_PASSWORD = SITE
    process.env.ADMIN_BASIC_AUTH_PASSWORD = ADMIN
  })

  it('leaves the order webhook reachable (it has its own secret)', () => {
    expect(status('/api/analytics/order')).not.toBe(401)
  })

  it('still gates the sibling analytics route', () => {
    expect(status('/api/analytics/track')).toBe(401)
  })

  it('does not exempt a path that merely starts with the webhook prefix', () => {
    expect(status('/api/analytics/orders-export')).toBe(401)
  })

  it.each([
    ['malformed base64', 'Basic !!!!not-base64!!!!'],
    ['no colon in the payload', `Basic ${Buffer.from('nocolon').toString('base64')}`],
    ['a non-Basic scheme', 'Bearer some-token'],
    ['an empty header', ''],
  ])('fails closed on %s', (_label, header) => {
    expect(status('/', header)).toBe(401)
  })
})
