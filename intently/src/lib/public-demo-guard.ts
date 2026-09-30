// ─────────────────────────────────────────────
// public-demo-guard.ts
//
// The route-level refusal for the public demo (see public-demo.ts). Kept apart
// from the core module so that one stays free of next/server.
// ─────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { isPublicDemo } from './public-demo'

/**
 * Guard for routes that spend money or mutate shared data. Returns a 403 the
 * Studio renders as "simulated in the public demo", or null when allowed.
 */
export function blockInPublicDemo(action: string): NextResponse | null {
  if (!isPublicDemo()) return null
  return NextResponse.json(
    {
      error: 'disabled in the public demo',
      publicDemo: true,
      action,
      message: `${action} is switched off in the public demo — it would spend real AI budget or change data every visitor shares. Everything you change here stays in your own session.`,
    },
    { status: 403 },
  )
}
