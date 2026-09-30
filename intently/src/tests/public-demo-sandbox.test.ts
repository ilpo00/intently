/**
 * @jest-environment node
 */
// ─────────────────────────────────────────────
// The public-demo session sandbox (INTENTLY_PUBLIC_DEMO=1):
//   · a visitor's Studio writes are theirs alone — invisible to other visitors
//     and never written to the shared base;
//   · the proxy issues the session and forwards it as a request header that a
//     client cannot supply itself.
// Hermetic: a temp cwd isolates the doc-store's local base (.enrichment).
// ─────────────────────────────────────────────

import { rmSync, mkdtempSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = mkdtempSync(join(tmpdir(), 'intently-sbx-'))
const realCwd = process.cwd()
beforeAll(() => process.chdir(dir))
afterAll(() => { process.chdir(realCwd); rmSync(dir, { recursive: true, force: true }) })

// The session id normally comes from the request (next/headers); here the test
// chooses which visitor is "current".
let session: string | null = null
jest.mock('@/lib/public-demo', () => ({
  ...jest.requireActual('@/lib/public-demo'),
  currentSandboxId: async () => session,
}))

import { NextRequest } from 'next/server'
import { readDoc, writeDoc, deleteDoc, readBaseDoc, clearSandboxDocs } from '@/lib/store/doc-store'
import { _resetSandboxMemory, sandboxSet, MAX_DOC_BYTES, SandboxDocTooLargeError, SandboxUnavailableError } from '@/lib/store/sandbox'
import { sharedStoreStatus } from '@/lib/discovery/guardrails-shared'
import { SANDBOX_COOKIE, SANDBOX_HEADER, isValidSandboxId } from '@/lib/public-demo'
import { proxy } from '@/proxy'

const A = 'a'.repeat(32)
const B = 'b'.repeat(32)
const baseFile = (key: string) => join(dir, '.enrichment', `${key}.json`)
function seedBase(key: string, value: unknown) {
  mkdirSync(join(dir, '.enrichment'), { recursive: true })
  writeFileSync(baseFile(key), JSON.stringify(value))
}

const original = { ...process.env }
beforeEach(() => {
  process.env = { ...original, INTENTLY_PUBLIC_DEMO: '1' }
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
  delete process.env.SITE_BASIC_AUTH_PASSWORD
  delete process.env.ADMIN_BASIC_AUTH_PASSWORD
  _resetSandboxMemory()
  session = null
})
afterEach(() => {
  process.env = { ...original }
  try { rmSync(join(dir, '.enrichment'), { recursive: true, force: true }) } catch { /* absent */ }
})

describe('doc-store in public-demo mode', () => {
  it("keeps one visitor's write invisible to another and off the shared base", async () => {
    seedBase('product-overrides', { base: { pattern: 'solid' } })

    session = A
    await writeDoc('product-overrides', { mine: { pattern: 'floral' } })
    expect(await readDoc('product-overrides')).toEqual({ mine: { pattern: 'floral' } })

    session = B
    expect(await readDoc('product-overrides')).toEqual({ base: { pattern: 'solid' } })

    // the shared base is untouched
    expect(await readBaseDoc('product-overrides')).toEqual({ base: { pattern: 'solid' } })
  })

  it('never creates a shared document from a visitor write', async () => {
    session = A
    await writeDoc('attention-state', { p1: { status: 'dismissed', updatedAt: 'now' } })
    expect(existsSync(baseFile('attention-state'))).toBe(false)
    expect(await readBaseDoc('attention-state')).toBeNull()
  })

  it('a delete is a tombstone: the visitor gets the default, the base survives', async () => {
    seedBase('runtime-config', { parse: { provider: 'openai', model: null } })
    session = A
    await deleteDoc('runtime-config')
    expect(await readDoc('runtime-config')).toBeNull()
    session = B
    expect(await readDoc('runtime-config')).toEqual({ parse: { provider: 'openai', model: null } })
    expect(existsSync(baseFile('runtime-config'))).toBe(true)
  })

  it('with no resolvable session: reads fall back to the base and writes are dropped', async () => {
    seedBase('situation-active', { ids: ['x'] })
    session = null
    await writeDoc('situation-active', { ids: ['hijack'] })
    await deleteDoc('situation-active')
    expect(await readDoc('situation-active')).toEqual({ ids: ['x'] })
    expect(await readBaseDoc('situation-active')).toEqual({ ids: ['x'] })
  })

  it('clearSandboxDocs drops only the current visitor\'s changes', async () => {
    session = A
    await writeDoc('product-overrides', { a: { pattern: 'stripe' } })
    session = B
    await writeDoc('product-overrides', { b: { pattern: 'print' } })

    session = A
    expect(await clearSandboxDocs()).toBe(true)
    expect(await readDoc('product-overrides')).toBeNull()
    session = B
    expect(await readDoc('product-overrides')).toEqual({ b: { pattern: 'print' } })
  })

  it('refuses an oversized document instead of truncating it', async () => {
    await expect(sandboxSet(A, 'product-overrides', 'x'.repeat(MAX_DOC_BYTES + 1)))
      .rejects.toBeInstanceOf(SandboxDocTooLargeError)
  })
})

describe('doc-store outside public-demo mode', () => {
  it('writes the shared base as before', async () => {
    delete process.env.INTENTLY_PUBLIC_DEMO
    session = A // ignored when the flag is off
    await writeDoc('product-overrides', { shared: { pattern: 'check' } })
    expect(existsSync(baseFile('product-overrides'))).toBe(true)
    session = B
    expect(await readDoc('product-overrides')).toEqual({ shared: { pattern: 'check' } })
  })
})

describe('proxy — sandbox session issuance', () => {
  const forwarded = (res: Response) => res.headers.get(`x-middleware-request-${SANDBOX_HEADER}`)
  const setCookie = (res: Response) => res.headers.get('set-cookie') ?? ''

  it('issues a session cookie and forwards the same id on first contact', () => {
    const res = proxy(new NextRequest('http://localhost/admin/enrichment/studio'))
    const id = forwarded(res)
    expect(isValidSandboxId(id)).toBe(true)
    expect(setCookie(res)).toContain(`${SANDBOX_COOKIE}=${id}`)
    expect(setCookie(res).toLowerCase()).toContain('httponly')
    expect(res.headers.get('x-robots-tag')).toContain('noindex')
  })

  it('reuses a valid cookie without re-setting it', () => {
    const res = proxy(new NextRequest('http://localhost/', { headers: { cookie: `${SANDBOX_COOKIE}=${A}` } }))
    expect(forwarded(res)).toBe(A)
    expect(setCookie(res)).toBe('')
  })

  it('replaces a malformed cookie and ignores a client-supplied session header', () => {
    const res = proxy(new NextRequest('http://localhost/', {
      headers: { cookie: `${SANDBOX_COOKIE}=../../etc`, [SANDBOX_HEADER]: B },
    }))
    const id = forwarded(res)
    expect(isValidSandboxId(id)).toBe(true)
    expect(id).not.toBe(B)
    expect(setCookie(res)).toContain(`${SANDBOX_COOKIE}=${id}`)
  })

  it('opens the gate even when passwords are configured — one reversible switch', () => {
    process.env.SITE_BASIC_AUTH_PASSWORD = 'site-secret'
    process.env.ADMIN_BASIC_AUTH_PASSWORD = 'admin-secret'
    for (const path of ['/', '/admin/enrichment/studio', '/api/enrichment/search']) {
      const res = proxy(new NextRequest(`http://localhost${path}`))
      expect(res.status).not.toBe(401)
      expect(isValidSandboxId(forwarded(res))).toBe(true)
    }
    // …and turning the flag off restores the private gate untouched
    delete process.env.INTENTLY_PUBLIC_DEMO
    expect(proxy(new NextRequest('http://localhost/')).status).toBe(401)
    expect(proxy(new NextRequest('http://localhost/admin')).status).toBe(401)
  })

  it('does nothing when the flag is off', () => {
    delete process.env.INTENTLY_PUBLIC_DEMO
    const res = proxy(new NextRequest('http://localhost/'))
    expect(forwarded(res)).toBeNull()
    expect(setCookie(res)).toBe('')
  })
})

describe('when Redis is configured but unreachable', () => {
  const realFetch = global.fetch
  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://gone.example.invalid'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
    global.fetch = (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
  })
  afterEach(() => { global.fetch = realFetch })

  it('a visitor write fails loudly instead of reporting success', async () => {
    session = A
    await expect(writeDoc('product-overrides', { x: { pattern: 'floral' } })).rejects.toBeInstanceOf(SandboxUnavailableError)
    await expect(deleteDoc('runtime-config')).rejects.toBeInstanceOf(SandboxUnavailableError)
    // and still never touches the shared base
    expect(await readBaseDoc('product-overrides')).toBeNull()
  })

  it('reads fall back to the shared base (the Studio stays browsable)', async () => {
    seedBase('situation-active', { ids: ['shared'] })
    session = A
    expect(await readDoc('situation-active')).toEqual({ ids: ['shared'] })
  })

  it('the health check reports it', async () => {
    expect(await sharedStoreStatus()).toBe('unavailable')
    delete process.env.UPSTASH_REDIS_REST_URL
    expect(await sharedStoreStatus()).toBe('not-configured')
  })
})
