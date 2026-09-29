#!/usr/bin/env node
/**
 * Intently · check-service-role
 *
 * Sanity-checks the Supabase service-role connection. Run before relying
 * on /admin/analytics/chips or any other admin tooling that needs RLS
 * bypass. Diagnoses three failure modes separately so the error is
 * pinpoint:
 *
 *   1. SUPABASE_SERVICE_ROLE_KEY not set in env (forgot to add to
 *      ~/.zshenv / .env.local, or shell didn't reload).
 *   2. Key set but credentials wrong (URL/key mismatch, regenerated key,
 *      wrong project).
 *   3. Credentials work but expected tables missing (migration 0006
 *      never applied to this project).
 *
 * Run from intently/:
 *   node scripts/check-service-role.mjs
 *
 * Reads from process.env first; falls back to intently/.env.local for
 * anyone who keeps secrets in the project file. Add to ~/.zshenv as
 * `export SUPABASE_SERVICE_ROLE_KEY=...` to skip the .env.local route.
 */

import { createClient } from '@supabase/supabase-js'
import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

// Try .env.local as a fallback for project-scoped keys. Shell env wins
// because dotenv's default behavior is to NOT override existing process.env.
const envLocalPath = resolve(process.cwd(), '.env.local')
if (existsSync(envLocalPath)) {
  loadEnv({ path: envLocalPath })
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

function fail(msg) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}
function pass(msg) {
  console.log(`✓ ${msg}`)
}

console.log('\n── Supabase service-role check ──\n')

// 1. Env presence
if (!url) fail('NEXT_PUBLIC_SUPABASE_URL not set in process.env or .env.local')
if (!key) {
  fail(
    'SUPABASE_SERVICE_ROLE_KEY not set in process.env or .env.local.\n' +
    '  Fix: add `export SUPABASE_SERVICE_ROLE_KEY=...` to ~/.zshenv and\n' +
    '  open a new terminal (or `source ~/.zshenv` in this one).'
  )
}
pass(`URL  : ${url}`)
pass(`Key  : ${key.slice(0, 6)}…${key.slice(-4)} (${key.length} chars)`)

// 2. Connection test
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// 3. Table existence — does a count-only SELECT on both chip tables.
//    head: true + count: 'exact' returns just the count, no rows.
async function tableCount(table) {
  const { count, error } = await db.from(table).select('*', { count: 'exact', head: true })
  if (error) throw new Error(`${table}: ${error.message} (code ${error.code})`)
  return count ?? 0
}

try {
  const anonCount    = await tableCount('chip_events_anon')
  pass(`chip_events_anon readable — ${anonCount} rows`)

  const signedCount  = await tableCount('chip_events')
  pass(`chip_events readable     — ${signedCount} rows`)

  console.log('\n→ Service-role connection works. /admin/analytics/chips will render.\n')
} catch (err) {
  fail(`Query failed: ${err.message}\n` +
       '  Likely causes:\n' +
       '    - Wrong project (URL/key mismatch)\n' +
       '    - Migration 0006_chip_events.sql not applied to this project\n' +
       '    - Service-role key regenerated since you copied it')
}
