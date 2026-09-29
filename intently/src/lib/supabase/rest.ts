// ─────────────────────────────────────────────
// supabase/rest.ts  ·  SERVER ONLY
//
// The one seam to Supabase for the cloud store swaps (ADR-012 C1/C2 /
// cloud-demo-plan.md). Raw fetch against PostgREST with the SERVICE-ROLE key
// (server-only, RLS-bypassing) — the house pattern (no SDK). Keys come from
// env and MUST NEVER reach the client bundle: this module is `server-only`,
// and the key is the service role, so a leak would be catastrophic.
//
//   SUPABASE_URL                — https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   — service_role JWT (server secret)
//
// Every call fails soft (returns null / false) so a Supabase outage degrades
// to the local-file behavior rather than breaking a shopper turn.
// ─────────────────────────────────────────────

import 'server-only'

const BASE = () => process.env.SUPABASE_URL?.replace(/\/$/, '')
const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY

/** True when both env values are present (the cloud store can be used). */
export function supabaseConfigured(): boolean {
  return !!(BASE() && KEY())
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const key = KEY() ?? ''
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
    ...extra,
  }
}

async function rest(path: string, init: RequestInit, timeoutMs = 2500): Promise<Response | null> {
  const base = BASE()
  if (!base) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`${base}/rest/v1/${path}`, { ...init, signal: controller.signal })
  } catch {
    return null // network/timeout → caller falls back to local
  } finally {
    clearTimeout(timer)
  }
}

/** Insert rows (fire-and-forget style — errors are swallowed by the caller). */
export async function insert(table: string, rows: unknown): Promise<boolean> {
  const res = await rest(table, { method: 'POST', headers: headers({ prefer: 'return=minimal' }), body: JSON.stringify(rows) })
  return !!res && res.ok
}

/** Select with a raw PostgREST query string (e.g. "select=*&ts=gte.…&order=ts"). */
export async function select<T = unknown>(table: string, query: string, timeoutMs = 4000): Promise<T[] | null> {
  const res = await rest(`${table}?${query}`, { method: 'GET', headers: headers() }, timeoutMs)
  if (!res || !res.ok) return null
  try {
    return (await res.json()) as T[]
  } catch {
    return null
  }
}

/** Upsert one row by primary key (Prefer: resolution=merge-duplicates). */
export async function upsert(table: string, row: unknown): Promise<boolean> {
  const res = await rest(table, {
    method: 'POST',
    headers: headers({ prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(row),
  })
  return !!res && res.ok
}

/** Delete rows matching a raw filter (e.g. "key=eq.runtime-config"). */
export async function remove(table: string, filter: string): Promise<boolean> {
  const res = await rest(`${table}?${filter}`, { method: 'DELETE', headers: headers({ prefer: 'return=minimal' }) })
  return !!res && res.ok
}
