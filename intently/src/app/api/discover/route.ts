// ─────────────────────────────────────────────
// POST /api/discover
//
// The discovery endpoint. Takes the shopper's latest query + the running
// SessionContext + which catalog, and returns an explained, re-ranked
// shortlist plus the updated context.
//
// Retrieval is pluggable behind one contract:
//   - default (deterministic): the in-memory engine over the whole catalogue.
//     No infra, instant, used by CI/offline and as the universal fallback.
//   - DISCOVERY_RETRIEVAL=vector: candidates come from the enrichment layer's
//     Xenova-embedding + VectorStore (LocalJSON / Supabase pgvector) retrieval,
//     then the SAME deterministic prefilter + explanation runs over them. This
//     is the "vector narrows the catalogue, the rest reasons over candidates"
//     architecture (docs/data-architecture.md). On any vector error it falls
//     back to deterministic — the demo never dead-ends.
// ─────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { discover, composeFromCandidates, type ComposeOpts } from '@/lib/discovery/engine'
import { isVectorRetrievalEnabled, vectorRetrieve } from '@/lib/discovery/retrieve'
import { loadActiveProfiles } from '@/lib/discovery/situation-overrides'
import { llmParseContext } from '@/lib/discovery/parse-llm'
import { rephraseProse, type RephraseInput } from '@/lib/discovery/generate-llm'
import { sanitizeQuery } from '@/lib/discovery/guardrails'
import { checkRateLimitShared, takeLlmBudgetShared } from '@/lib/discovery/guardrails-shared'
import { shouldEscalate } from '@/lib/discovery/escalate'
import { grounded } from '@/lib/discovery/verify'
import { readRuntimeConfig, stageProvider, armFor } from '@/lib/discovery/runtime-config'
import { emitEvent, newMeter, costUsd } from '@/lib/analytics/events'
import { getAllProducts } from '@/lib/data'
import { newSignals } from '@/lib/discovery/voice'
import type { ConsultAnswer } from '@/lib/discovery/consult'
import {
  emptySessionContext, type Catalog, type SessionContext, type CartContextItem,
} from '@/types'

interface DiscoverBody {
  query?: string
  session?: SessionContext
  catalog?: Catalog
  // A tapped consultation option (questionId + optionId) — applied as a
  // structured patch server-side; `query` then carries the option's label.
  answer?: ConsultAnswer
  // The shopper's cart: never re-offered, and it can anchor follow-up turns
  // (dress in cart + "cold evenings" → layers become the primary answer).
  cart?: CartContextItem[]
  // Anonymous analytics ids (client-minted; optional — a turn without them
  // still answers, it just isn't attributable to a session).
  sessionId?: string
  turn?: number
}

export async function POST(req: Request) {
  const t0 = Date.now()
  let body: DiscoverBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  // Ground rules: size-capped input, per-IP rate limit. (Topic containment is
  // structural — see guardrails.ts header — so no content filter is needed
  // here; off-topic text simply parses to nothing and the engine stays on
  // shopping. The shopper-facing path never errors on LLM limits — only on
  // outright request hammering.)
  // The PM-editable runtime config (env defaults ⊕ Studio overrides): which
  // model answers each stage, and the LLM-use limits. Read per request so a
  // saved change takes effect without a redeploy.
  const cfg = await readRuntimeConfig()
  // Online A/B: sticky per-session arm; arm B swaps the stage configs, arm A
  // (and every un-attributed turn) runs the base config. Recorded per event.
  const arm = armFor(typeof body.sessionId === 'string' ? body.sessionId : undefined, cfg.experiment)
  const parseCfg = arm === 'B' && cfg.experiment ? cfg.experiment.b.parse : cfg.parse
  const genCfg = arm === 'B' && cfg.experiment ? cfg.experiment.b.generation : cfg.generation
  const PARSER = stageProvider(parseCfg)
  const GENERATOR = stageProvider(genCfg)

  const ip = (req.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim()
  // Replica-safe when Upstash is configured; in-memory otherwise (ADR-012 C1).
  const rate = await checkRateLimitShared(ip, { perMin: cfg.limits.ratePerMin, perDay: cfg.limits.ratePerDay })
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'Take a breath — a moment between requests, please.' },
      { status: 429, headers: { 'retry-after': String(rate.retryAfterSeconds ?? 60) } },
    )
  }

  const query = sanitizeQuery(body.query ?? '')
  if (!query) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 })
  }
  const catalog: Catalog = body.catalog === 'outdoor' ? 'outdoor' : 'fashion'
  const session = body.session ?? emptySessionContext()
  const answer = body.answer
  const cart = body.cart ?? []

  // The ACTIVE, curator-tuned situation profiles (defaults + custom ⊕ overrides,
  // minus any the PM switched off) feed the soft re-rank; server-only read.
  // None active → no situation emphasis.
  const activeProfiles = await loadActiveProfiles()
  const profiles = activeProfiles.length ? activeProfiles : undefined

  // Tier-1 comprehension (opt-in). A tapped option already carries structured
  // intent, so skip the LLM parse on answer turns — and the complexity gate
  // (escalate.ts) keeps simple turns on the free regex path even when the
  // provider is on. Null = regex-only fallback; the daily LLM budget degrades
  // to the same fallback, silently.
  const complex = !answer && shouldEscalate(query, cfg.limits.escalateMinWords)
  const parseMeter = newMeter()
  const parseRan = !!(PARSER && complex && (await takeLlmBudgetShared(cfg.limits.llmDailyCap)))
  const contextPatch = parseRan
    ? (await llmParseContext(query, session, PARSER, parseCfg.model ?? undefined, parseMeter)) ?? undefined
    : undefined

  const baseOpts: ComposeOpts = { answer, cart, contextPatch }

  let outcome
  if (isVectorRetrievalEnabled()) {
    // Outfit completion needs a wider universe than the query-narrowed top-k
    // (a dress query hides every jacket) — one extra retrieval targeted at the
    // companion vocabulary. Independent of the primary, so run them together.
    const [candidates, extra] = await Promise.all([
      vectorRetrieve(query, catalog),
      vectorRetrieve(`${query} layer jacket sweatshirt shirt trousers backpack cap`, catalog),
    ])
    if (candidates) {
      const seen = new Set(candidates.map(p => p.id))
      const companionPool = [
        ...candidates,
        ...(extra ?? []).filter(p => !seen.has(p.id)),
      ]
      outcome = composeFromCandidates(query, session, candidates, profiles, { ...baseOpts, companionPool })
    } else {
      outcome = discover(query, session, catalog, profiles, baseOpts) // fallback on vector error
    }
  } else {
    outcome = discover(query, session, catalog, profiles, baseOpts)
  }

  // Re-voice the spoken prose (opt-in). The engine's deterministic text is the
  // ground truth, the verification reference, and the fallback — rephraseProse
  // returns null on any unfaithful/unavailable result and we keep the template.
  // Same complexity gate as the parse: trivial turns keep the instant template.
  let message = outcome.message
  let question = outcome.question ?? null
  let addOns = outcome.addOns ?? []
  const genMeter = newMeter()
  const genRan = !!(GENERATOR && complex && (await takeLlmBudgetShared(cfg.limits.llmDailyCap)))
  let genAccepted = false
  let groundingRejected = false
  if (genRan) {
    const input: RephraseInput = {
      message: outcome.message,
      prompt: question?.prompt,
      options: question?.options.map(o => ({ id: o.id, label: o.label })),
      leads: addOns.length ? addOns.map(a => ({ slotId: a.slotId, lead: a.lead })) : undefined,
      facts: {
        count: outcome.results.length,
        learned: newSignals(session, outcome.updatedContext),
        cartSettled: cart[0]?.category,
        gapGarment: outcome.gapGarment,
      },
    }
    const re = await rephraseProse(input, GENERATOR!, genCfg.model ?? undefined, genMeter)
    // Layer-2 grounding (verify.ts): reject prose that promises what Intently
    // can't deliver — an unshown product, or an action the assistant can't
    // perform. Rejection keeps the deterministic template, silently.
    const isGrounded = !re || grounded(
      [re.message, re.prompt, ...(re.options ?? []).map(o => o.label), ...(re.leads ?? []).map(l => l.lead)],
      outcome.results.map(r => r.product.name),
      getAllProducts().map(p => p.name),
    )
    groundingRejected = !!re && !isGrounded
    if (re && isGrounded) {
      genAccepted = true
      message = re.message
      if (question && re.prompt) {
        const byId = new Map((re.options ?? []).map(o => [o.id, o.label]))
        question = {
          ...question,
          prompt: re.prompt,
          options: question.options.map(o => ({ ...o, label: byId.get(o.id) ?? o.label })),
        }
      }
      if (re.leads) {
        const bySlot = new Map(re.leads.map(l => [l.slotId, l.lead]))
        addOns = addOns.map(a => ({ ...a, lead: bySlot.get(a.slotId) ?? a.lead }))
      }
    }
  }

  // Analytics: one turn event per request, fire-and-forget (never blocks or
  // breaks the shopper turn). Raw query is the sanitized ≤280-char string.
  emitEvent({
    type: 'turn',
    ts: new Date().toISOString(),
    sessionId: typeof body.sessionId === 'string' ? body.sessionId.slice(0, 64) : 'anon',
    turn: typeof body.turn === 'number' ? body.turn : 0,
    queryChars: query.length,
    query,
    escalated: complex,
    answered: !!answer,
    resultCount: outcome.results.length,
    questionAsked: !!question,
    parse: parseRan && PARSER ? {
      provider: PARSER, model: parseCfg.model,
      tokensIn: parseMeter.tokensIn, tokensOut: parseMeter.tokensOut,
      costUsd: costUsd(PARSER, parseMeter), ok: contextPatch !== undefined,
    } : null,
    generate: genRan && GENERATOR ? {
      provider: GENERATOR, model: genCfg.model,
      tokensIn: genMeter.tokensIn, tokensOut: genMeter.tokensOut,
      costUsd: costUsd(GENERATOR, genMeter), ok: genAccepted,
      accepted: genAccepted, groundingRejected,
    } : null,
    latencyMs: Date.now() - t0,
    ...(cfg.experiment?.enabled ? { arm } : {}),
  })

  return NextResponse.json({
    message,
    results: outcome.results,
    updatedSession: outcome.updatedContext,
    question,
    addOns,
  })
}
