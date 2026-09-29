/**
 * @jest-environment node
 */
// ─────────────────────────────────────────────
// runtime-config: env defaults ⊕ saved override, with validation clamping.
// Uses a temp override path so the real .enrichment file is never touched.
// ─────────────────────────────────────────────

import { readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Point the config path at a temp file (env override) so the real .enrichment
// file is never touched — no cwd dance, plain import.
const dir = mkdtempSync(join(tmpdir(), 'intently-cfg-'))
process.env.INTENTLY_RUNTIME_CONFIG_PATH = join(dir, 'runtime-config.json')

import * as cfg from '@/lib/discovery/runtime-config'

afterAll(() => rmSync(dir, { recursive: true, force: true }))
afterEach(() => {
  try { rmSync(cfg.runtimeConfigPath(), { force: true }) } catch { /* absent */ }
  delete process.env.DISCOVERY_PARSER
  delete process.env.DISCOVERY_LLM_DAILY_CAP
})

describe('readRuntimeConfig', () => {
  it('with no file and no env, both stages are off and limits are the documented defaults', async () => {
    const c = await cfg.readRuntimeConfig()
    expect(c.parse.provider).toBe('off')
    expect(c.generation.provider).toBe('off')
    expect(c.limits.llmDailyCap).toBe(2000)
    expect(c.limits.escalateMinWords).toBe(8)
    expect(await cfg.hasRuntimeOverride()).toBe(false)
  })

  it('env vars seed the defaults', async () => {
    process.env.DISCOVERY_PARSER = 'openai'
    process.env.DISCOVERY_LLM_DAILY_CAP = '50'
    const c = cfg.runtimeConfigDefaults()
    expect(c.parse.provider).toBe('openai')
    expect(c.limits.llmDailyCap).toBe(50)
  })

  it('a saved override wins over env and persists', async () => {
    await cfg.writeRuntimeConfig({
      parse: { provider: 'openai', model: 'gpt-5.4-mini' },
      generation: { provider: 'off', model: null },
      limits: { llmDailyCap: 100, ratePerMin: 20, ratePerDay: 400, escalateMinWords: 5 },
      experiment: null,
    })
    const c = await cfg.readRuntimeConfig()
    expect(c.parse.provider).toBe('openai')
    expect(c.parse.model).toBe('gpt-5.4-mini')
    expect(c.limits.escalateMinWords).toBe(5)
    expect(await cfg.hasRuntimeOverride()).toBe(true)
    // stageProvider maps 'off' → null for the route.
    expect(cfg.stageProvider(c.generation)).toBeNull()
    expect(cfg.stageProvider(c.parse)).toBe('openai')
  })

  it('clamps malformed fields onto the baseline instead of corrupting the path', async () => {
    const saved = await cfg.writeRuntimeConfig({
      // @ts-expect-error — deliberately bad provider + out-of-range cap
      parse: { provider: 'gpt-9-ultra', model: 42 },
      generation: { provider: 'haiku', model: null },
      limits: { llmDailyCap: -5, ratePerMin: 20, ratePerDay: 400, escalateMinWords: 999 },
    })
    expect(saved.parse.provider).toBe('off')        // bad provider → baseline
    expect(saved.parse.model).toBeNull()            // non-string model → null
    expect(saved.limits.llmDailyCap).toBe(2000)     // out-of-range → baseline
    expect(saved.limits.escalateMinWords).toBe(8)   // > max → baseline
    // What landed on disk equals what was returned.
    const onDisk = JSON.parse(readFileSync(cfg.runtimeConfigPath(), 'utf8'))
    expect(onDisk.parse.provider).toBe('off')
  })

  it('clearRuntimeConfig reverts to env defaults', async () => {
    await cfg.writeRuntimeConfig({
      parse: { provider: 'openai', model: null },
      generation: { provider: 'openai', model: null },
      limits: { llmDailyCap: 1, ratePerMin: 1, ratePerDay: 1, escalateMinWords: 1 },
      experiment: null,
    })
    await cfg.clearRuntimeConfig()
    const c = await cfg.readRuntimeConfig()
    expect(c.parse.provider).toBe('off')
    expect(c.limits.llmDailyCap).toBe(2000)
  })
})
