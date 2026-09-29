/**
 * @jest-environment node
 */
// ─────────────────────────────────────────────
// Situation mining: uncovered demand clusters into suggestions; queries an
// existing situation already matches are excluded; zero-result demand ranks
// first. Hermetic via its own events dir.
// ─────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = mkdtempSync(join(tmpdir(), 'intently-mine-'))
process.env.INTENTLY_EVENTS_DIR = dir

import { emitEvent, type TurnEvent } from '@/lib/analytics/events'
import { mineSituationSuggestions } from '@/lib/analytics/mine-situations'
import { DEFAULT_PROFILES } from '@/lib/discovery/situation-match'

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const turn = (query: string, over: Partial<TurnEvent> = {}): TurnEvent => ({
  type: 'turn', ts: new Date().toISOString(), sessionId: `s-${Math.random()}`, turn: 1,
  queryChars: query.length, query, escalated: false, answered: false,
  resultCount: 5, questionAsked: false, parse: null, generate: null, latencyMs: 10,
  ...over,
})

describe('mineSituationSuggestions', () => {
  it('clusters uncovered demand, excludes covered queries, ranks zero-result first', async () => {
    // Uncovered demand: "festival" (3 distinct queries, 2 zero-result).
    // NOTE: fixtures must avoid words from built-in situation LABELS
    // ("summer", "weekend"…) — matchSituation is deliberately lenient and
    // counts those as covered demand.
    emitEvent(turn('going to a music festival next month'))
    emitEvent(turn('festival look with boots', { resultCount: 0 }))
    emitEvent(turn('what should i pack for a festival', { resultCount: 0 }))
    // Uncovered but below threshold alone: one-off query.
    emitEvent(turn('clothes for horseback riding'))
    // Covered by the built-in beach-holiday situation → must be excluded.
    emitEvent(turn('beach holiday essentials'))
    emitEvent(turn('beach holiday looks'))
    // Tapped answers never count as typed demand.
    emitEvent(turn('darker tones', { answered: true }))

    const s = await mineSituationSuggestions(DEFAULT_PROFILES)
    expect(s.length).toBeGreaterThan(0)
    expect(s[0].label).toBe('Festival')
    expect(s[0].queries).toBe(3)
    expect(s[0].zeroResults).toBe(2)
    expect(s[0].keywords[0]).toBe('festival')
    expect(s[0].examples.length).toBeGreaterThan(0)
    // Covered demand must not appear.
    expect(s.find(x => x.label.toLowerCase().includes('beach'))).toBeUndefined()
    // One-off queries don't clear MIN_QUERIES.
    expect(s.find(x => x.label.toLowerCase().includes('horseback'))).toBeUndefined()
  })
})
