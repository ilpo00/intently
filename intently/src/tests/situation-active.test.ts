/**
 * @jest-environment node
 */
// ─────────────────────────────────────────────
// Per-situation on/off: default active, deactivation persists as an exception,
// and loadActiveProfiles filters out the inactive ones for live discovery.
// Hermetic: a temp cwd so the doc-store's <cwd>/.enrichment path is isolated.
// ─────────────────────────────────────────────

import { rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = mkdtempSync(join(tmpdir(), 'intently-act-'))
const realCwd = process.cwd()
beforeAll(() => process.chdir(dir))
afterAll(() => { process.chdir(realCwd); rmSync(dir, { recursive: true, force: true }) })

import { isActive, setActive, readInactiveIds, forgetActive } from '@/lib/discovery/situation-active'
import { loadActiveProfiles, loadMergedProfiles } from '@/lib/discovery/situation-overrides'
import { DEFAULT_PROFILES } from '@/lib/discovery/situation-match'

afterEach(() => { try { rmSync(join(dir, '.enrichment'), { recursive: true, force: true }) } catch { /* absent */ } })

describe('per-situation active state', () => {
  it('everything is active by default (no doc)', async () => {
    expect(await readInactiveIds()).toEqual([])
    expect(await isActive('office-day')).toBe(true)
    expect(await loadActiveProfiles()).toHaveLength((await loadMergedProfiles()).length)
  })

  it('deactivating persists as an exception and drops it from the active set', async () => {
    await setActive('office-day', false)
    expect(await isActive('office-day')).toBe(false)
    expect(await readInactiveIds()).toEqual(['office-day'])
    const active = await loadActiveProfiles()
    expect(active.find(p => p.id === 'office-day')).toBeUndefined()
    expect(active).toHaveLength(DEFAULT_PROFILES.length - 1)
  })

  it('reactivating clears the exception (back to the all-active default)', async () => {
    await setActive('office-day', false)
    await setActive('office-day', true)
    expect(await isActive('office-day')).toBe(true)
    expect(await readInactiveIds()).toEqual([])
  })

  it('deactivating is idempotent and dedupes', async () => {
    await setActive('beach-holiday', false)
    await setActive('beach-holiday', false)
    expect(await readInactiveIds()).toEqual(['beach-holiday'])
  })

  it('forgetActive removes an id entirely (custom delete cleanup)', async () => {
    await setActive('some-custom', false)
    await setActive('keep-me', false)
    expect(await readInactiveIds()).toContain('some-custom')
    await forgetActive('some-custom')
    expect(await readInactiveIds()).not.toContain('some-custom')
    expect(await readInactiveIds()).toContain('keep-me')
  })
})
