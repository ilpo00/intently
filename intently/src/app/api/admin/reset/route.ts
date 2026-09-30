// ─────────────────────────────────────────────
// /api/admin/reset  ·  ADMIN — put the demo back to a known state.
//
//   POST { targets: ResetTarget[], confirm: 'RESET' }
//
// Deliberately TIERED rather than one "wipe everything" button, because the
// tiers have very different costs to undo:
//
//   demoState  — situations, config, curated attributes, attention queue.
//                Reverts to the shipped defaults. Free to undo (just re-tune).
//   enriched   — the vision-enrichment output. Undoing means RE-RUNNING the
//                batch: ~15 minutes and real Anthropic spend for a full
//                catalogue. Destructive in the way that matters.
//   analytics  — the event history. Unrecoverable; there is no way to
//                re-derive past funnel or spend data. Opt-in only.
//
// `confirm` must be the literal string RESET. It is not security (the admin
// guard is), it is a misclick guard on an irreversible action — the UI makes
// the user type it.
// ─────────────────────────────────────────────

import { NextResponse } from 'next/server'

import { assertAdminApi } from '@/lib/auth/admin-guard'
import { isPublicDemo } from '@/lib/public-demo'
import { clearSandboxDocs } from '@/lib/store/doc-store'
import { clearVisionRecords, clearVisionRun } from '@/lib/enrichment/vision/store'
import { deleteDoc } from '@/lib/store/doc-store'
import { clearAnalytics } from '@/lib/analytics/events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export type ResetTarget = 'demoState' | 'enriched' | 'analytics'

const ALL: ResetTarget[] = ['demoState', 'enriched', 'analytics']

export async function POST(req: Request) {
  const deny = await assertAdminApi(); if (deny) return deny

  const body = (await req.json().catch(() => ({}))) as { targets?: ResetTarget[]; confirm?: string }
  if (body.confirm !== 'RESET') {
    return NextResponse.json({ error: 'confirmation required — type RESET to proceed' }, { status: 400 })
  }
  // Public demo: there is no shared data a visitor may wipe. "Reset" means
  // "drop MY changes" — whatever targets were ticked.
  if (isPublicDemo()) {
    const had = await clearSandboxDocs()
    return NextResponse.json({
      ok: true,
      publicDemo: true,
      cleared: had ? ['your session’s Studio changes (situations, config, curated attributes, attention queue)'] : [],
      failed: [],
    })
  }

  const targets = (body.targets ?? []).filter((t): t is ResetTarget => ALL.includes(t))
  if (!targets.length) {
    return NextResponse.json({ error: 'nothing selected to reset' }, { status: 400 })
  }

  const cleared: string[] = []
  const failed: { target: string; error: string }[] = []

  const step = async (target: ResetTarget, label: string, fn: () => Promise<void>) => {
    if (!targets.includes(target)) return
    try {
      await fn()
      cleared.push(label)
    } catch (err) {
      failed.push({ target, error: err instanceof Error ? err.message : String(err) })
    }
  }

  await step('demoState', 'PM tuning (situations, config, curated attributes, attention queue)', async () => {
    await Promise.all([
      deleteDoc('situation-custom'),
      deleteDoc('situation-overrides'),
      deleteDoc('situation-active'),
      deleteDoc('runtime-config'),
      deleteDoc('product-overrides'),
      deleteDoc('attention-state'),
    ])
  })

  await step('enriched', 'vision enrichment output', async () => {
    await clearVisionRecords('sample')
    await clearVisionRecords('catalog')
    await clearVisionRun()
  })

  await step('analytics', 'analytics events', async () => {
    await clearAnalytics()
  })

  // Partial failure is reported honestly rather than swallowed: a reset that
  // half-worked is worse to discover mid-demo than one that says so.
  return NextResponse.json({ ok: failed.length === 0, cleared, failed }, { status: failed.length ? 500 : 200 })
}
