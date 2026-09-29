// ─────────────────────────────────────────────
// /api/admin/config  ·  ADMIN — the Studio "how it runs" config
//
//   GET → { config, defaults, overridden, available }
//   PUT → save a full RuntimeConfig (env defaults ⊕ this)
//   DELETE → revert to env defaults
//
// The saved override is what the live /api/discover reads per request, so a
// change here takes effect on the next turn without a redeploy. Provider keys
// are never returned — only which providers HAVE a key (so the UI greys out
// the rest).
// ─────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { assertAdminApi } from '@/lib/auth/admin-guard'
import {
  readRuntimeConfig, runtimeConfigDefaults, writeRuntimeConfig,
  clearRuntimeConfig, hasRuntimeOverride, type RuntimeConfig,
} from '@/lib/discovery/runtime-config'

function payload() {
  return {
    config: readRuntimeConfig(),
    defaults: runtimeConfigDefaults(),
    overridden: hasRuntimeOverride(),
    available: {
      deepseek: !!process.env.DEEPSEEK_API_KEY,
      haiku: !!process.env.ANTHROPIC_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
    },
  }
}

export async function GET() {
  const denied = await assertAdminApi()
  if (denied) return denied
  return NextResponse.json(payload())
}

export async function PUT(req: Request) {
  const denied = await assertAdminApi()
  if (denied) return denied
  let body: RuntimeConfig
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  // writeRuntimeConfig re-validates/clamps every field onto the env baseline,
  // so a malformed edit can never corrupt the live path.
  writeRuntimeConfig(body)
  return NextResponse.json(payload())
}

export async function DELETE() {
  const denied = await assertAdminApi()
  if (denied) return denied
  clearRuntimeConfig()
  return NextResponse.json(payload())
}
