// ─────────────────────────────────────────────
// useDiscover + store flow for the consultation beat.
//
// The invariant under test: a BLOCKING ask (question, no results) must keep
// the shopper in the conversation — it must NOT navigate the river to the
// discovery section or write results. Only a reveal moves the river.
// ─────────────────────────────────────────────

import { renderHook, act } from '@testing-library/react'
import { useDiscover } from '@/hooks/useDiscover'
import { useIntentlyStore } from '@/store/intently-store'
import { discover as runEngine } from '@/lib/discovery/engine'
import type { SessionContext, Catalog, CartContextItem } from '@/types'
import type { ConsultAnswer } from '@/lib/discovery/consult'

// The hook is live-only: every turn POSTs /api/discover. jsdom has no server,
// so stub fetch with the same deterministic engine the route runs — the test
// exercises the real request path shape plus the store invariants.
const realFetch = global.fetch
beforeEach(() => {
  act(() => useIntentlyStore.getState().resetSession())
  global.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      query: string; session: SessionContext; catalog: Catalog
      answer?: ConsultAnswer; cart?: CartContextItem[]
    }
    const r = runEngine(body.query, body.session, body.catalog, undefined, {
      answer: body.answer, cart: body.cart ?? [],
    })
    return {
      ok: true,
      json: async () => ({
        message: r.message, results: r.results, updatedSession: r.updatedContext,
        question: r.question, addOns: r.addOns,
      }),
    }
  }) as unknown as typeof fetch
})
afterEach(() => { global.fetch = realFetch })

describe('blocking ask keeps the shopper in the conversation', () => {
  it('does not navigate to discovery and does not write results', async () => {
    const { result } = renderHook(() => useDiscover())
    await act(async () => { await result.current.discover('I need a dress') })

    const s = useIntentlyStore.getState()
    expect(s.pendingQuestion).not.toBeNull()
    expect(s.results).toHaveLength(0)
    expect(s.activeSection).toBe('entry')          // unchanged — no navigation
    expect(s.messages[s.messages.length - 1].role).toBe('assistant')
  })

  it('answering through to the reveal navigates to discovery', async () => {
    const { result } = renderHook(() => useDiscover())
    await act(async () => { await result.current.discover('I need a dress') })

    // Tap the concluding escape — the tailor decides, results reveal.
    const q = useIntentlyStore.getState().pendingQuestion!
    const escape = q.options.find(o => o.id === 'open')!
    await act(async () => {
      await result.current.discover(escape.label, {
        answer: { questionId: q.id, optionId: escape.id },
      })
    })

    const s = useIntentlyStore.getState()
    expect(s.results.length).toBeGreaterThan(0)
    expect(s.activeSection).toBe('discovery')
    expect(s.pendingQuestion).toBeNull()           // concluded — no pestering
  })

  it('a new free-text submit supersedes an open question', async () => {
    const { result } = renderHook(() => useDiscover())
    await act(async () => { await result.current.discover('I need a dress') })
    expect(useIntentlyStore.getState().pendingQuestion).not.toBeNull()

    await act(async () => {
      await result.current.discover("for a friend's wedding in July, outdoors, smart casual")
    })
    const s = useIntentlyStore.getState()
    // The rich brief reveals. A pending question here is the NON-blocking
    // sharpener (results are visible) — and since the shopper typed past the
    // palette ask without answering, the tailor may gently circle back to it.
    expect(s.results.length).toBeGreaterThan(0)
    expect(s.activeSection).toBe('discovery')
  })
})
