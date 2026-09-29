/**
 * @jest-environment node
 */
// ─────────────────────────────────────────────
// Custom situations: create → merges into loadMergedProfiles alongside the
// defaults → the same runtime override applies → delete removes it.
// Hermetic: a temp cwd so the doc-store's <cwd>/.enrichment path is isolated.
// ─────────────────────────────────────────────

import { rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = mkdtempSync(join(tmpdir(), 'intently-sit-'))
const realCwd = process.cwd()
beforeAll(() => process.chdir(dir))
afterAll(() => { process.chdir(realCwd); rmSync(dir, { recursive: true, force: true }) })

import {
  readCustomProfiles, saveCustomProfile, deleteCustomProfile, seedCustomProfile, slugId,
} from '@/lib/discovery/situation-custom'
import { loadMergedProfiles, readOverrides, writeOverrides } from '@/lib/discovery/situation-overrides'
import { DEFAULT_PROFILES } from '@/lib/discovery/situation-match'

afterEach(() => { try { rmSync(join(dir, '.enrichment'), { recursive: true, force: true }) } catch { /* absent */ } })

describe('slugId', () => {
  it('slugs a label and suffixes on collision', () => {
    const taken = new Set(['school-run'])
    expect(slugId('School Run!', new Set())).toBe('school-run')
    expect(slugId('School Run', taken)).toBe('school-run-2')
  })
})

describe('custom situations feed loadMergedProfiles', () => {
  it('a created custom profile appears alongside the defaults', async () => {
    const id = slugId('School run', new Set(DEFAULT_PROFILES.map(p => p.id)))
    await saveCustomProfile(seedCustomProfile(id, 'School run', ['school']))
    const merged = await loadMergedProfiles()
    expect(merged).toHaveLength(DEFAULT_PROFILES.length + 1)
    expect(merged.find(p => p.id === id)?.label).toBe('School run')
    expect(Object.keys(await readCustomProfiles())).toContain(id)
  })

  it('a runtime override applies to a custom base the same way it does to a default', async () => {
    await saveCustomProfile(seedCustomProfile('school-run', 'School run', []))
    // Simulate the PUT save-override path.
    await writeOverrides({
      'school-run': { emphasis: { formality: 2 } as never },
    })
    const merged = await loadMergedProfiles()
    const p = merged.find(x => x.id === 'school-run')!
    expect(p.emphasis.formality).toBe(2)              // override merged
    expect(p.weights.occasion).toBe(50)               // seed weight preserved
    expect(Object.keys(await readOverrides())).toContain('school-run')
  })

  it('delete removes it from the merged set', async () => {
    await saveCustomProfile(seedCustomProfile('school-run', 'School run', []))
    expect(await loadMergedProfiles()).toHaveLength(DEFAULT_PROFILES.length + 1)
    expect(await deleteCustomProfile('school-run')).toBe(true)
    expect(await loadMergedProfiles()).toHaveLength(DEFAULT_PROFILES.length)
    expect(await deleteCustomProfile('school-run')).toBe(false) // idempotent
  })
})
