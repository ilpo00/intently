/**
 * @jest-environment node
 */
// The daily keep-alive: secret-protected, touches both backing stores, and
// reports (503) when either one does not answer.

import { GET } from '@/app/api/health/keepalive/route'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'

const original = { ...process.env }
const realFetch = global.fetch
afterEach(() => { process.env = { ...original }; global.fetch = realFetch })

const req = (auth?: string) =>
  new Request('http://localhost/api/health/keepalive', { headers: auth ? { authorization: auth } : {} })

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret'
  process.env.SUPABASE_URL = 'https://db.example.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.test'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
})

it('refuses a request without the cron secret', async () => {
  expect((await GET(req())).status).toBe(401)
  expect((await GET(req('Bearer wrong'))).status).toBe(401)
  delete process.env.CRON_SECRET
  expect((await GET(req('Bearer '))).status).toBe(401)
})

it('reads from both stores and reports ok', async () => {
  const hits: string[] = []
  global.fetch = (async (url: string) => {
    hits.push(String(url))
    if (String(url).includes('redis')) return new Response(JSON.stringify([{ result: 'PONG' }]))
    return new Response(JSON.stringify([{ key: 'runtime-config' }]))
  }) as unknown as typeof fetch
  const res = await GET(req('Bearer cron-secret'))
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, supabase: 'ok', redis: 'ok' })
  expect(hits.some(u => u.includes('runtime_kv'))).toBe(true)
  expect(hits.some(u => u.includes('redis'))).toBe(true)
})

it('answers 503 when a store is down', async () => {
  global.fetch = (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
  const res = await GET(req('Bearer cron-secret'))
  expect(res.status).toBe(503)
  expect(await res.json()).toMatchObject({ ok: false })
})

it('passes the site gate, which a password-protected deploy would otherwise apply', () => {
  process.env.SITE_BASIC_AUTH_PASSWORD = 'site'
  delete process.env.INTENTLY_PUBLIC_DEMO
  expect(proxy(new NextRequest('http://localhost/api/health/keepalive')).status).not.toBe(401)
  expect(proxy(new NextRequest('http://localhost/')).status).toBe(401)
})
