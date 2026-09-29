'use client'

// ─────────────────────────────────────────────
// /next · live discovery adapter
//
// Calls the real /api/discover (semantic vector retrieval over the
// vision-enriched catalogue) and maps the response into the overlay's
// DiscoverTurn shape. This is what makes the consumer demo real: actual photos,
// actual situational matching, actual explanations — not scripted data.
// ─────────────────────────────────────────────

import {
  emptySessionContext, type SessionContext, type ConsultQuestion, type CartContextItem,
} from '@/types'
import type { ConsultAnswer } from '@/lib/discovery/consult'
import type {
  DiscoverTurn, ExplainedResult, ParsedChip, RefineChip, TurnAsk, TurnAddOnGroup,
} from './scripted'

// In plugin mode the app is served under a basePath (e.g. /discover) and proxied
// by the host storefront, which only forwards /discover/*. A bare fetch('/api/…')
// would escape the proxy → 404, so prefix the basePath. Empty standalone.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

interface ApiProduct {
  id: string; name: string; brand?: string; price: number; imageUrl: string; category: string; variantId?: string
}
interface ApiResult { product: ApiProduct; matchExplanation: string; relevanceScore: number }
interface ApiAddOn { slotId: string; lead: string; results: ApiResult[] }
interface ApiResponse {
  message: string
  results: ApiResult[]
  updatedSession: SessionContext
  question?: ConsultQuestion | null
  addOns?: ApiAddOn[]
}

function toExplained(r: ApiResult, isBest = false): ExplainedResult {
  return {
    product: {
      id: r.product.id, name: r.product.name, brand: r.product.brand ?? '',
      price: r.product.price, image: r.product.imageUrl, category: r.product.category,
      variantId: r.product.variantId,
    },
    why: r.matchExplanation,
    isBest,
  }
}

// Quiet, editable context chips from the parsed SessionContext (the "understood"
// moment) — removing one becomes an exclusion (handled in the overlay).
function chipsFromSession(s: SessionContext): ParsedChip[] {
  const chips: ParsedChip[] = []
  if (s.occasion) chips.push({ id: 'occasion', label: s.occasion, kind: 'occasion' })
  if (s.activity) chips.push({ id: 'activity', label: s.activity, kind: 'occasion' })
  if (s.audience) {
    const label = s.audience === 'men' ? 'for him' : s.audience === 'women' ? 'for her' : 'unisex'
    chips.push({ id: 'audience', label, kind: 'pref' })
  }
  if (s.formality) chips.push({ id: 'formality', label: s.formality, kind: 'formality' })
  if (s.season) chips.push({ id: 'season', label: s.season, kind: 'season' })
  for (const c of s.constraints) chips.push({ id: `c-${c}`, label: c, kind: 'constraint' })
  for (const p of s.preferences) chips.push({ id: `p-${p}`, label: p, kind: 'pref' })
  for (const e of s.exclusions) chips.push({ id: `x-${e}`, label: `no ${e}`, kind: 'pref' })
  return chips
}

const REFINE: RefineChip[] = [
  { id: 'warmer', label: 'something warmer', query: 'something warmer for a cold evening' },
  { id: 'smarter', label: 'more formal', query: 'something more formal and elegant' },
  { id: 'relaxed', label: 'more relaxed', query: 'something more relaxed and casual' },
  { id: 'noblack', label: 'nothing black', query: 'nothing black' },
]

export async function liveDiscover(
  query: string,
  session?: SessionContext,
  answer?: ConsultAnswer,
  cart?: CartContextItem[],
  meta?: { sessionId: string; turn: number }, // anonymous analytics ids
): Promise<{ turn: DiscoverTurn; session: SessionContext }> {
  const res = await fetch(`${BASE}/api/discover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query, session: session ?? emptySessionContext(), catalog: 'fashion', answer,
      cart: cart ?? [],
      sessionId: meta?.sessionId, turn: meta?.turn,
    }),
  })
  if (!res.ok) throw new Error(`discover ${res.status}`)
  const d = (await res.json()) as ApiResponse
  const results: ExplainedResult[] = d.results.map((r, i) => toExplained(r, i === 0))
  const addOns: TurnAddOnGroup[] = (d.addOns ?? []).map(g => ({
    slotId: g.slotId,
    lead: g.lead,
    items: g.results.map(r => toExplained(r)),
  }))
  const ask: TurnAsk | undefined = d.question
    ? {
        id: d.question.id,
        prompt: d.question.prompt,
        options: d.question.options.map(o => ({ id: o.id, label: o.label })),
      }
    : undefined
  const turn: DiscoverTurn = {
    scenario: 'city', // filler; the scripted refine router isn't used on the live path
    message: d.message,
    chips: chipsFromSession(d.updatedSession),
    results,
    ask,
    addOns: addOns.length > 0 ? addOns : undefined,
    // The tailor's options ARE the affordance while a question is open.
    refineChips: ask ? [] : REFINE,
    // A blocking ask is a question, not a failed search.
    noMatch: results.length === 0 && !ask,
  }
  return { turn, session: d.updatedSession }
}
