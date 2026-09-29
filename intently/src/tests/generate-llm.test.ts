// ─────────────────────────────────────────────
// Tier-1 generation — the deterministic faithfulness gate (no network).
//
// The re-voicer may make the prose warmer, but the deterministic engine's text
// is ground truth: a rephrase that drops the piece count, sneaks in an apology,
// or mangles the option/lead structure is rejected, and the route keeps the
// template. These tests pin that gate.
// ─────────────────────────────────────────────

import { faithful, coerce, type RephraseInput } from '@/lib/discovery/generate-llm'

const base: RephraseInput = {
  message: 'A summer wedding and smart casual — a clear brief. 12 pieces chosen for it.',
  facts: { count: 12, learned: ['smart casual'] },
}

describe('faithful — accepts a clean rephrase, rejects unfaithful ones', () => {
  it('accepts a warmer rephrase that keeps the count and adds no apology', () => {
    expect(faithful(base, { message: 'A smart-casual summer wedding — lovely. Here are 12 I’d stand behind.' }))
      .toBe(true)
  })

  it('rejects a dropped count', () => {
    expect(faithful(base, { message: 'A smart-casual summer wedding — here are some lovely options.' }))
      .toBe(false)
  })

  it('rejects a sneaked-in apology / lack framing', () => {
    expect(faithful(base, { message: 'Sorry, only 12 pieces — we’re a bit limited.' })).toBe(false)
    expect(faithful(base, { message: 'Unfortunately just 12 here.' })).toBe(false)
  })

  it('rejects an empty message', () => {
    expect(faithful(base, { message: '' })).toBe(false)
  })

  it('keeps option structure intact — same ids, all labelled', () => {
    const input: RephraseInput = {
      message: 'Two questions first. 0 pieces.',
      prompt: 'Darker or lighter?',
      options: [{ id: 'darker', label: 'darker, richer tones' }, { id: 'open', label: 'surprise me' }],
      facts: { count: 0, learned: [] },
    }
    expect(faithful(input, {
      message: 'Two questions first. 0 pieces.', prompt: 'Do you lean deep or soft?',
      options: [{ id: 'darker', label: 'deeper, richer' }, { id: 'open', label: 'you pick' }],
    })).toBe(true)
    // a missing option id is rejected
    expect(faithful(input, {
      message: 'Two questions first. 0 pieces.', prompt: 'Deep or soft?',
      options: [{ id: 'darker', label: 'deeper' }],
    })).toBe(false)
    // a blank label is rejected
    expect(faithful(input, {
      message: 'Two questions first. 0 pieces.', prompt: 'Deep or soft?',
      options: [{ id: 'darker', label: 'deeper' }, { id: 'open', label: '' }],
    })).toBe(false)
  })

  it('keeps lead structure intact — same slotIds', () => {
    const input: RephraseInput = {
      message: '12 pieces.',
      leads: [{ slotId: 'layer', lead: 'A layer for the evening.' }],
      facts: { count: 12, learned: [] },
    }
    expect(faithful(input, { message: '12 pieces.', leads: [{ slotId: 'layer', lead: 'Something to throw over.' }] }))
      .toBe(true)
    expect(faithful(input, { message: '12 pieces.', leads: [{ slotId: 'carry', lead: 'A bag.' }] }))
      .toBe(false)
  })
})

describe('coerce — tolerates loose model JSON', () => {
  it('pulls message + structured fields, ignoring junk', () => {
    const out = coerce(
      { message: ' Here are 12. ', prompt: ' Deep or soft? ', options: [{ id: 'darker', label: ' deeper ' }], junk: 1 },
      { message: 'x', prompt: 'y', options: [{ id: 'darker', label: 'z' }], facts: { count: 12, learned: [] } },
    )
    expect(out?.message).toBe('Here are 12.')
    expect(out?.prompt).toBe('Deep or soft?')
    expect(out?.options).toEqual([{ id: 'darker', label: 'deeper' }])
  })

  it('returns null for non-objects', () => {
    expect(coerce(null, base)).toBeNull()
    expect(coerce('a string', base)).toBeNull()
  })
})
