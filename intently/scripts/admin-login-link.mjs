#!/usr/bin/env node
/**
 * Intently · admin-login-link
 *
 * Generates a magic-link URL via the Supabase admin API and prints it.
 * No email sent — the URL is returned directly from the admin endpoint
 * and pasted into the browser. Bypasses:
 *   - Email delivery flakiness (Supabase default mailer / Gmail spam)
 *   - Email-based rate limits (admin API has separate, higher limits)
 *
 * Strictly a dev utility. Requires SUPABASE_SERVICE_ROLE_KEY in env
 * (set in ~/.zshenv or .env.local).
 *
 * Usage:
 *   npm run admin:login-link -- you@example.com
 *   npm run admin:login-link -- you@example.com /admin/analytics/chips
 *   ADMIN_LOGIN_EMAIL=you@example.com npm run admin:login-link
 *
 * The optional second arg is where to land after sign-in (defaults to /).
 *
 * The user must already exist in auth.users — generateLink with type
 * 'magiclink' fails for unknown emails. To create a new test user, use
 * Supabase Dashboard → Authentication → Users → Add user, or extend
 * this script with a --signup flag.
 */

import { createClient } from '@supabase/supabase-js'
import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

const envLocalPath = resolve(process.cwd(), '.env.local')
if (existsSync(envLocalPath)) loadEnv({ path: envLocalPath })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('\n✗ Missing env. Run `npm run check:service-role` first to diagnose.\n')
  process.exit(1)
}

const email = process.argv[2] ?? process.env.ADMIN_LOGIN_EMAIL
const redirectPath = process.argv[3] ?? '/'

if (!email) {
  console.error('\n✗ Usage: npm run admin:login-link -- you@example.com [/redirect/path]')
  console.error('  Or set ADMIN_LOGIN_EMAIL in ~/.zshenv to skip the arg.\n')
  process.exit(1)
}

const callbackOrigin = process.env.INTENTLY_DEV_ORIGIN ?? process.env.MISE_DEV_ORIGIN ?? 'http://localhost:3017'
const redirectTo = `${callbackOrigin}/auth/callback?redirect=${encodeURIComponent(redirectPath)}`

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data, error } = await db.auth.admin.generateLink({
  type: 'magiclink',
  email,
  options: { redirectTo },
})

if (error) {
  console.error(`\n✗ generateLink failed: ${error.message}\n`)
  if (/not found|does not exist/i.test(error.message)) {
    console.error('  The email has no auth.users row yet. Either:')
    console.error('    - Add user via Supabase Dashboard → Authentication → Users')
    console.error('    - Or sign up via /auth/login (one magic link send, then this works forever)\n')
  }
  process.exit(1)
}

const actionLink = data?.properties?.action_link
if (!actionLink) {
  console.error('\n✗ generateLink returned no action_link. Unexpected response:\n')
  console.error(JSON.stringify(data, null, 2))
  process.exit(1)
}

console.log('\n── Magic link generated (no email sent) ──\n')
console.log(`  Email:    ${email}`)
console.log(`  Lands on: ${redirectPath}`)
console.log(`  Expires:  1 hour\n`)
console.log('  Paste this URL into your browser:\n')
console.log(`  ${actionLink}\n`)
