// ─────────────────────────────────────────────────────────────────
// GET    /api/enrichment/situations  — merged profiles (defaults + custom ⊕ overrides) + state
// PUT    /api/enrichment/situations  — save an override AND/OR toggle active for one id
// POST   /api/enrichment/situations  — create a NEW custom situation
// DELETE /api/enrichment/situations?id=…  — remove a custom situation (+ its override/state)
//
// Overrides persist to .enrichment/situation-overrides.json; custom situations
// to situation-custom.json; per-situation on/off to situation-active.json (all
// gitignored). Only ACTIVE situations bias live discovery. The "tune, don't
// re-code" seam — add situations a store needs, tune them, switch them on/off.
// ─────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'

import { assertAdminApi } from '@/lib/auth/admin-guard'
import { DEFAULT_PROFILES, mergeProfile, type SituationProfile } from '@/lib/discovery/situation-match'
import { readOverrides, writeOverrides, loadMergedProfiles } from '@/lib/discovery/situation-overrides'
import {
  readCustomProfiles, saveCustomProfile, deleteCustomProfile, seedCustomProfile, slugId,
} from '@/lib/discovery/situation-custom'
import { readInactiveIds, setActive, forgetActive } from '@/lib/discovery/situation-active'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const deny = await assertAdminApi(); if (deny) return deny
  const [profiles, overrides, custom, inactive] = await Promise.all([
    loadMergedProfiles(), readOverrides(), readCustomProfiles(), readInactiveIds(),
  ])
  return NextResponse.json({
    profiles,
    overridden: Object.keys(overrides),
    custom: Object.keys(custom),
    inactive,
  })
}

export async function PUT(req: Request) {
  const deny = await assertAdminApi(); if (deny) return deny
  let body: { id?: string; profile?: Partial<SituationProfile>; active?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }
  // The base can be a committed default OR a PM-created custom situation.
  const custom = await readCustomProfiles()
  const base = DEFAULT_PROFILES.find(p => p.id === body.id) ?? custom[body.id ?? '']
  if (!body.id || !base) {
    return NextResponse.json({ error: 'valid id required' }, { status: 400 })
  }
  // Two independent, composable ops: save tuned weights/emphasis, and/or flip
  // the per-situation on/off. Either or both may be present.
  if (body.profile) {
    const ovr = await readOverrides()
    ovr[body.id] = body.profile
    await writeOverrides(ovr)
  }
  let inactive = await readInactiveIds()
  if (typeof body.active === 'boolean') inactive = await setActive(body.id, body.active)
  return NextResponse.json({
    ok: true,
    profile: mergeProfile(base, (await readOverrides())[body.id]),
    inactive,
  })
}

export async function POST(req: Request) {
  const deny = await assertAdminApi(); if (deny) return deny
  let body: { label?: string; keywords?: string[]; profile?: Partial<SituationProfile> }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }
  const label = (body.label ?? '').trim()
  if (!label) return NextResponse.json({ error: 'label required' }, { status: 400 })

  const taken = new Set([...DEFAULT_PROFILES.map(p => p.id), ...Object.keys(await readCustomProfiles())])
  const id = slugId(label, taken)
  const keywords = (body.keywords ?? []).map(k => k.trim().toLowerCase()).filter(Boolean)
  const seed = seedCustomProfile(id, label, keywords)
  // The draft flow saves the PM's tuned weights/emphasis in the same request,
  // so a "Save new situation" is one atomic create — no orphaned neutral seed.
  const profile = body.profile
    ? mergeProfile(seed, { weights: body.profile.weights, emphasis: body.profile.emphasis })
    : seed
  await saveCustomProfile(profile)
  return NextResponse.json({ ok: true, profile, custom: Object.keys(await readCustomProfiles()) }, { status: 201 })
}

export async function DELETE(req: Request) {
  const deny = await assertAdminApi(); if (deny) return deny
  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!(await deleteCustomProfile(id))) {
    return NextResponse.json({ error: 'no such custom situation (defaults cannot be deleted)' }, { status: 400 })
  }
  // Drop any override + active-state keyed to it so the store stays clean.
  const ovr = await readOverrides()
  if (id in ovr) { delete ovr[id]; await writeOverrides(ovr) }
  await forgetActive(id)
  return NextResponse.json({ ok: true, custom: Object.keys(await readCustomProfiles()), inactive: await readInactiveIds() })
}
