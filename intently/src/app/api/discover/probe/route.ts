// ─────────────────────────────────────────────
// POST /api/discover/probe  ·  ADMIN — the Studio model bench backend
//
// Runs one discovery turn with an EXPLICIT provider/model (request-time
// override; the shopper route stays env-driven) and returns per-stage
// diagnostics: the complexity-gate verdict, the parsed patch + latency, the
// deterministic engine outcome, and the re-voiced prose with its
// faithfulness/grounding verdicts. This is how PMs test and validate models
// and use cases before an env default changes.
//
// LLM probes draw from the same daily budget as shopper turns — a bench run
// is real spend and should count against the cap.
// ─────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { assertAdminApi } from '@/lib/auth/admin-guard'
import { discover } from '@/lib/discovery/engine'
import { llmParseContext } from '@/lib/discovery/parse-llm'
import { rephraseProse, type RephraseInput } from '@/lib/discovery/generate-llm'
import { shouldEscalate } from '@/lib/discovery/escalate'
import { grounded } from '@/lib/discovery/verify'
import { sanitizeQuery, takeLlmBudget } from '@/lib/discovery/guardrails'
import { newSignals } from '@/lib/discovery/voice'
import { inferCatalog } from '@/lib/discovery/infer-catalog'
import { getAllProducts } from '@/lib/data'
import type { Provider } from '@/lib/discovery/llm-client'
import { emptySessionContext, type SessionContext } from '@/types'

interface ProbeBody {
  query?: string
  session?: SessionContext
  // null/undefined provider = deterministic-only probe (Tier-0 baseline).
  provider?: Provider | null
  model?: string
  stages?: ('parse' | 'generate')[]
}

const PROVIDERS = new Set<string>(['deepseek', 'haiku', 'openai'])

export async function POST(req: Request) {
  const denied = await assertAdminApi()
  if (denied) return denied

  let body: ProbeBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const query = sanitizeQuery(body.query ?? '')
  if (!query) return NextResponse.json({ error: 'query is required' }, { status: 400 })

  const provider = body.provider && PROVIDERS.has(body.provider) ? body.provider : null
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined
  const stages = new Set(body.stages ?? ['parse', 'generate'])
  const session = body.session ?? emptySessionContext()
  // Catalog is INFERRED, exactly as the live shopper path does (useDiscover) —
  // never hand-picked. A "wedding outfit" routes to fashion no matter what.
  const catalog = inferCatalog(query, session)

  const escalate = shouldEscalate(query)

  // ── Tier-1 comprehension (explicit provider; bypasses the gate so the
  //    bench can probe simple turns too) ──
  let parse: { ok: boolean; ms: number; patch: unknown; budget: boolean } | null = null
  let patch
  if (provider && stages.has('parse')) {
    const budget = takeLlmBudget()
    const t0 = Date.now()
    patch = budget ? (await llmParseContext(query, session, provider, model)) ?? undefined : undefined
    parse = { ok: !!patch, ms: Date.now() - t0, patch: patch ?? null, budget }
  }

  // ── Tier-0 deterministic engine (always) ──
  const t1 = Date.now()
  const outcome = discover(query, session, catalog, undefined, { contextPatch: patch })
  const engineMs = Date.now() - t1

  // ── Tier-1 generation + the faithfulness/grounding gates ──
  let generate: {
    ok: boolean; ms: number; budget: boolean
    message: string | null; prompt: string | null
    grounded: boolean | null
  } | null = null
  if (provider && stages.has('generate')) {
    const budget = takeLlmBudget()
    const input: RephraseInput = {
      message: outcome.message,
      prompt: outcome.question?.prompt,
      options: outcome.question?.options.map(o => ({ id: o.id, label: o.label })),
      leads: outcome.addOns?.length ? outcome.addOns.map(a => ({ slotId: a.slotId, lead: a.lead })) : undefined,
      facts: {
        count: outcome.results.length,
        learned: newSignals(session, outcome.updatedContext),
        gapGarment: outcome.gapGarment,
      },
    }
    const t2 = Date.now()
    const re = budget ? await rephraseProse(input, provider, model) : null
    const ms = Date.now() - t2
    const isGrounded = re
      ? grounded(
          [re.message, re.prompt, ...(re.options ?? []).map(o => o.label), ...(re.leads ?? []).map(l => l.lead)],
          outcome.results.map(r => r.product.name),
          getAllProducts().map(p => p.name),
        )
      : null
    generate = {
      ok: !!re && isGrounded === true,
      ms,
      budget,
      message: re?.message ?? null,
      prompt: re?.prompt ?? null,
      grounded: isGrounded,
    }
  }

  return NextResponse.json({
    catalog, // inferred, not chosen — shown read-only in the bench
    escalate,
    parse,
    engine: {
      ms: engineMs,
      message: outcome.message,
      question: outcome.question?.prompt ?? null,
      results: outcome.results.map(r => ({ id: r.product.id, name: r.product.name })),
    },
    generate,
  })
}
