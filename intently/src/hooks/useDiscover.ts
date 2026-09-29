'use client'

// ─────────────────────────────────────────────
// useDiscover — the single discovery contract.
//
// One entry point the UI calls: `discover(query)`. It folds the query into
// the running SessionContext, retrieves + ranks results, and writes the
// outcome to the store (messages, sessionContext, results, section).
//
// Live-only contract: every turn POSTs /api/discover (deterministic engine +
// opt-in Tier-1 LLM server-side). On any error, fall back to the client-side
// engine so the demo never dead-ends. One shape either way:
// { message, results, updatedSession }.
// ─────────────────────────────────────────────

import { useCallback } from 'react'
import { useIntentlyStore } from '@/store/intently-store'
import { discover as runEngine } from '@/lib/discovery/engine'
import { inferCatalog } from '@/lib/discovery/infer-catalog'
import type { ConsultAnswer } from '@/lib/discovery/consult'
import type {
  Catalog, SessionContext, DiscoveryResult, ConsultQuestion, CompanionSuggestion,
} from '@/types'

// Re-exported for callers that historically imported it from the hook.
export { inferCatalog }

interface DiscoverOutcome {
  message: string
  results: DiscoveryResult[]
  updatedSession: SessionContext
  question?: ConsultQuestion | null
  addOns?: CompanionSuggestion[]
}

export interface DiscoverOpts {
  // A tapped consultation option. The label travels as the query (it's what
  // the user-bubble shows, and it parses if typed); the answer applies the
  // option's structured patch deterministically.
  answer?: ConsultAnswer
}

export function useDiscover() {
  const {
    addMessage,
    setLoading,
    setSessionContext,
    setResults,
    setAddOns,
    setActiveSection,
    setStickyActive,
    setContextChips,
    setIntent,
    setPendingQuestion,
  } = useIntentlyStore()

  const discover = useCallback(async (rawQuery: string, opts: DiscoverOpts = {}) => {
    const query = rawQuery.trim()
    if (!query) return

    const ctx = useIntentlyStore.getState().sessionContext
    const catalog = inferCatalog(query, ctx)
    // Cart context: the engine never re-offers carted items, and a cart item
    // anchors follow-up turns ("cold evenings" + carted dress → layers).
    const cartContext = useIntentlyStore.getState().cart.items.map(i => ({
      id: i.asset.product.id,
      category: i.asset.product.category,
      name: i.asset.name,
    }))

    addMessage({ role: 'user', content: query })
    setPendingQuestion(null) // any new turn supersedes an open question
    setStickyActive(true)
    setLoading(true)

    let outcome: DiscoverOutcome
    try {
      // Prefix the basePath so the call resolves under the embed zone
      // (/discover/api/discover) as well as standalone (/api/discover).
      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, session: ctx, catalog, answer: opts.answer, cart: cartContext }),
      })
      if (!res.ok) throw new Error(`discover failed: ${res.status}`)
      outcome = await res.json()
    } catch (err) {
      // Resilient fallback: never dead-end a demo. Run the engine locally.
      console.warn('[useDiscover] falling back to local engine:', err)
      const r = runEngine(query, ctx, catalog, undefined, { answer: opts.answer, cart: cartContext })
      outcome = { message: r.message, results: r.results, updatedSession: r.updatedContext, question: r.question, addOns: r.addOns }
    }

    const question = outcome.question ?? null
    setSessionContext(outcome.updatedSession)
    addMessage({ role: 'assistant', content: outcome.message })
    setPendingQuestion(question)

    if (outcome.results.length === 0 && question) {
      // Blocking consultation turn (ask-before-offer): stay in the
      // conversation — no results yet, no navigation to discovery.
      setIntent('discover')
      setContextChips([])
      setLoading(false)
      return
    }

    setResults(outcome.results)
    setAddOns(outcome.addOns ?? [])
    setIntent(outcome.results.length > 0 ? 'discover' : 'browse')
    setActiveSection('discovery')
    // When the tailor has a sharpening question, its options ARE the chips.
    setContextChips(question ? [] : suggestChips(outcome.updatedSession, catalog))
    setLoading(false)
  }, [
    addMessage, setLoading, setSessionContext, setResults, setAddOns, setActiveSection,
    setStickyActive, setContextChips, setIntent, setPendingQuestion,
  ])

  return { discover }
}

// Suggested refinement chips, situation-aware. These are the one-tap
// "progressive context" affordances from the UX doc.
function suggestChips(ctx: SessionContext, catalog: Catalog): string[] {
  if (catalog === 'outdoor') {
    return ["it'll be cold in the evenings", 'keep it lightweight', 'something more affordable']
  }
  const chips = ['something more formal', 'something more relaxed']
  if (!ctx.exclusions.includes('floral')) chips.push('nothing floral')
  return chips
}
