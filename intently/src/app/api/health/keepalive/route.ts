// ─────────────────────────────────────────────
// GET /api/health/keepalive — daily Vercel cron (vercel.json).
//
// The demo runs on free tiers that reclaim idle resources: a Supabase project
// pauses after about a week without activity, and an idle Upstash database can
// be removed. Both happened to this deployment (2026-09-30) and took the Studio
// and the shared limits down silently. One tiny read against each, once a day,
// keeps them counted as active — and the response says whether they answered.
//
// Authenticated by Vercel's cron secret (Authorization: Bearer $CRON_SECRET),
// so it is reachable through the site gate (proxy.ts) without a password.
// ─────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { select, supabaseConfigured } from '@/lib/supabase/rest'
import { sharedStoreStatus } from '@/lib/discovery/guardrails-shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = supabaseConfigured()
    ? ((await select('runtime_kv', 'select=key&limit=1')) === null ? 'unavailable' : 'ok')
    : 'not-configured'
  const redis = await sharedStoreStatus()

  const healthy = supabase !== 'unavailable' && redis !== 'unavailable'
  if (!healthy) console.error('[keepalive] backing store unavailable', { supabase, redis })
  return NextResponse.json({ ok: healthy, supabase, redis }, { status: healthy ? 200 : 503 })
}
