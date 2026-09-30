/**
 * @jest-environment node
 *
 * Records the public demo's model-bench fixtures (src/lib/discovery/probe-fixtures.json)
 * by running the REAL probe route once per sample query and provider.
 *
 *   npm run record:probe-fixtures
 *
 * Makes paid LLM calls: PROBE_SAMPLE_QUERIES × providers × 2 stages ≈ 30 small
 * calls (a few cents). Needs DEEPSEEK_API_KEY / OPENAI_API_KEY /
 * ANTHROPIC_API_KEY; a provider without a key is skipped. Runs against the
 * vision catalogue (the npm script sets NEXT_PUBLIC_CATALOG=vision) so the
 * recorded prose names products the deployed demo actually shows.
 *
 * Does nothing unless PROBE_RECORD=1 — it lives beside the evals but is never
 * part of `npm run eval` or CI.
 */
import fs from 'fs'
import path from 'path'
import { POST } from '@/app/api/discover/probe/route'
import { _resetGuardrails } from '@/lib/discovery/guardrails'
import {
  PROBE_SAMPLE_QUERIES, PROBE_FIXTURE_PROVIDERS, probeFixtureKey, type ProbeFixture,
} from '@/lib/discovery/probe-fixtures'
import type { Provider } from '@/lib/discovery/llm-client'

const OUT = path.join(__dirname, '..', 'src', 'lib', 'discovery', 'probe-fixtures.json')

const KEY: Record<Provider, string> = {
  deepseek: 'DEEPSEEK_API_KEY', openai: 'OPENAI_API_KEY', haiku: 'ANTHROPIC_API_KEY',
}
const MODEL: Record<Provider, string> = {
  deepseek: process.env.DISCOVERY_DEEPSEEK_MODEL || 'deepseek-v4-flash',
  openai: process.env.DISCOVERY_OPENAI_MODEL || 'gpt-5.4-nano',
  haiku: process.env.DISCOVERY_HAIKU_MODEL || 'claude-haiku-4-5',
}

const recording = process.env.PROBE_RECORD === '1'

;(recording ? describe : describe.skip)('record model-bench fixtures (paid, manual)', () => {
  it('records every sample query for every provider with a key', async () => {
    expect(process.env.INTENTLY_PUBLIC_DEMO).not.toBe('1') // must hit real models
    const out: Record<string, ProbeFixture> = {}
    const skipped: string[] = []

    for (const provider of PROBE_FIXTURE_PROVIDERS) {
      if (!process.env[KEY[provider]]) { skipped.push(provider); continue }
      for (const query of PROBE_SAMPLE_QUERIES) {
        _resetGuardrails()
        const res = await POST(new Request('http://localhost/api/discover/probe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query, provider }),
        }))
        const body = await res.json()
        out[probeFixtureKey(provider, query)] = {
          model: MODEL[provider],
          recordedAt: new Date().toISOString().slice(0, 10),
          parse: body.parse && { ok: body.parse.ok, ms: body.parse.ms, patch: body.parse.patch },
          generate: body.generate && {
            ok: body.generate.ok, ms: body.generate.ms,
            message: body.generate.message, prompt: body.generate.prompt, grounded: body.generate.grounded,
          },
        }
      }
    }

    fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
    console.log(`recorded ${Object.keys(out).length} fixtures → ${OUT}${skipped.length ? ` (skipped, no key: ${skipped.join(', ')})` : ''}`)
    expect(Object.keys(out).length).toBeGreaterThan(0)
  }, 300_000)
})
