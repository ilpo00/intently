'use client'

// ─────────────────────────────────────────────────────────────────
// Analytics client — renders the aggregates with an explanation on every
// metric (what · how · why). Dataviz rules applied: stat tiles for headlines,
// single-hue bars for magnitude, fixed categorical hues for providers
// (validated trio), direct labels everywhere, values in ink tokens.
// ─────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { RangePicker, type RangeKey } from '@/components/admin/RangePicker'
import type { Aggregates } from '@/lib/analytics/aggregate'

type Tab = 'commerce' | 'conversation' | 'budget'

// Fixed categorical order + hues (validated: CVD ≥ 32, labels carry relief).
const PROVIDER_COLOR: Record<string, string> = {
  deepseek: '#6366f1', haiku: '#10b981', openai: '#f59e0b',
}

const usd = (v: number | null | undefined, digits = 4) =>
  v === null || v === undefined ? '—' : `$${v.toFixed(digits)}`
const pctFmt = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(0)}%`)
const num = (v: number | null) => (v === null ? '—' : v % 1 === 0 ? String(v) : v.toFixed(1))

export default function AnalyticsClient({ agg, range, initialTab }: { agg: Aggregates; range: RangeKey; initialTab: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab)

  return (
    <div className="max-w-6xl">
      <header className="mb-4">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="font-sans text-2xl font-light text-intently-ink">Analytics</h1>
          <span className="text-[11px] uppercase tracking-wider bg-intently-paper text-intently-pebble px-2 py-0.5 rounded">local events · {agg.range.events} in range</span>
        </div>
        <p className="text-intently-pebble text-sm leading-relaxed max-w-3xl">
          Three lenses over the discovery conversation: standard <strong className="text-intently-slate font-medium">commerce</strong> signals,
          the <strong className="text-intently-slate font-medium">conversation</strong> metrics only Intently can produce, and the
          LLM <strong className="text-intently-slate font-medium">budget</strong>. Hover any ⓘ for what a metric is, how it&apos;s
          computed, and why it matters.
        </p>
      </header>

      <RangePicker basePath="/admin/analytics" current={range} />

      {/* tabs */}
      <div className="flex gap-2 mb-6 -mt-6">
        {(['commerce', 'conversation', 'budget'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`text-sm px-4 py-1.5 rounded-full border capitalize transition-colors ${
              tab === t ? 'border-intently-ink bg-intently-ink text-white' : 'border-intently-cloud text-intently-slate hover:border-intently-pebble'
            }`}>
            {t}
          </button>
        ))}
      </div>

      {agg.range.events === 0 && (
        <div className="border border-amber-300 bg-amber-50 rounded-lg p-4 text-sm text-amber-800 mb-6">
          No events in this range yet. Events are recorded automatically from real discovery turns and cart adds —
          use the shopper surface (or the Models bench with real turns), or seed demo data with{' '}
          <code className="font-mono text-xs">node scripts/seed-analytics.mjs</code>.
        </div>
      )}

      {tab === 'commerce' && <Commerce agg={agg} />}
      {tab === 'conversation' && <Conversation agg={agg} />}
      {tab === 'budget' && <Budget agg={agg} />}
    </div>
  )
}

// ── Commerce ──

function Commerce({ agg }: { agg: Aggregates }) {
  const maxFunnel = Math.max(1, ...agg.funnel.filter(f => f.sessions >= 0).map(f => f.sessions))
  const surfaceTotal = Math.max(1, agg.cartAdds)
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Sessions" value={String(agg.sessions)}
          tip={{ what: 'Distinct anonymous browser sessions that made at least one discovery query.', how: 'Count of unique session ids on turn events in the range. Ids are random, per browser session — no identity, no PII.', why: 'The top of every other rate on this page. If sessions are flat, look at acquisition, not at Intently.' }} />
        <Stat label="Add-to-carts" value={String(agg.cartAdds)}
          tip={{ what: 'Products added to the cart from Intently results.', how: 'Count of cart events (fired on every Add click, both embedded and standalone).', why: 'The strongest purchase-intent signal Intently can observe — checkout happens in the host storefront.' }} />
        <Stat label="Items / cart session" value={num(agg.itemsPerCartSession)}
          tip={{ what: 'Average items added per session that added anything.', how: 'Cart events ÷ distinct sessions with ≥1 cart event.', why: 'Basket depth: outfit completion should push this above 1 — one moment, several pieces.' }} />
        <Stat label="Session → cart" value={pctFmt(agg.funnel[2] && agg.sessions ? agg.funnel[2].sessions / agg.sessions : null)}
          tip={{ what: 'Share of sessions that added at least one product (the proxy conversion).', how: 'Sessions with a cart event ÷ all sessions. True purchase conversion is not observable — the host storefront owns checkout.', why: 'The single number that says whether situational discovery turns browsers into buyers.' }} />
      </div>

      {agg.orders > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Orders" value={String(agg.orders)}
            tip={{ what: 'Completed orders reported by the host storefront’s webhook.', how: 'Order events in range (Medusa order.placed → /api/analytics/order).', why: 'Real conversion, not a proxy — the number a buyer asks for first.' }} />
          <Stat label="Attributed to Intently" value={String(agg.attributedOrders)}
            tip={{ what: 'Orders whose checkout carried an Intently session id.', how: 'Order events with a sessionId (set via cart metadata by the storefront). Orders without it still count above, honestly unattributed.', why: 'The defensible “Intently drove this purchase” number.' }} />
          <Stat label="Revenue" value={agg.revenueUsd === null ? '—' : `$${agg.revenueUsd.toFixed(2)}`}
            tip={{ what: 'Sum of order totals in range.', how: 'Σ totalUsd over order events that carried a total.', why: 'The top line the funnel feeds.' }} />
          <Stat label="AOV" value={agg.aovUsd === null ? '—' : `$${agg.aovUsd.toFixed(2)}`}
            tip={{ what: 'Average order value.', how: 'Revenue ÷ orders with totals.', why: 'Basket economics: outfit completion should lift this over time.' }} />
        </div>
      )}

      <Section title="Funnel — where shoppers leave"
        tip={{ what: 'Session counts at each step of the discovery journey.', how: 'Each bar counts distinct sessions reaching that step, in order. The biggest step-to-step drop is where shoppers leave.', why: 'Exit points are the to-do list: a drop before results means comprehension/catalogue gaps; a drop after results means the shortlist isn’t convincing.' }}>
        <div className="space-y-1.5">
          {agg.funnel.map(f => (
            <div key={f.key} className="flex items-center gap-3">
              <span className="w-40 text-xs text-intently-slate shrink-0">{f.label}</span>
              {f.sessions >= 0 ? (
                <>
                  <div className="flex-1 h-5 bg-intently-paper rounded overflow-hidden" title={`${f.label}: ${f.sessions} sessions`}>
                    <div className="h-full rounded bg-intently-ink/80" style={{ width: `${(f.sessions / maxFunnel) * 100}%` }} />
                  </div>
                  <span className="w-14 text-right font-mono text-xs text-intently-ink">{f.sessions}</span>
                </>
              ) : (
                <span className="text-xs text-intently-pebble italic">{f.note}</span>
              )}
              {f.sessions >= 0 && f.note && <span className="text-[11px] text-intently-pebble">({f.note})</span>}
            </div>
          ))}
        </div>
      </Section>

      <div className="grid md:grid-cols-2 gap-6">
        <Section title="Where cart adds happened"
          tip={{ what: 'The surface each add-to-cart came from.', how: '“reveal” = the main shortlist; “companion” = the outfit-completion rail (“complete the look”).', why: 'The companion share IS the attach rate — the upsell working. If it’s ~0, the rails aren’t earning their place.' }}>
          {agg.cartAddsBySurface.length === 0 && <Empty />}
          <div className="space-y-1.5">
            {agg.cartAddsBySurface.map(s => (
              <BarRow key={s.surface} label={s.surface} value={s.count} max={surfaceTotal} color="#6366f1" />
            ))}
          </div>
        </Section>

        <Section title="Top added products"
          tip={{ what: 'Products most added to the cart from Intently.', how: 'Cart events grouped by product, top 10.', why: 'What situational discovery actually sells — compare against the merchandising plan for surprises.' }}>
          {agg.topProducts.length === 0 && <Empty />}
          <div className="space-y-1.5">
            {agg.topProducts.map(p => (
              <BarRow key={p.title} label={p.title} value={p.count} max={Math.max(1, agg.topProducts[0]?.count ?? 1)} color="#6366f1" />
            ))}
          </div>
        </Section>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Section title="Top queries"
          tip={{ what: 'What shoppers actually type (tapped options excluded).', how: 'Typed queries grouped case-insensitively, top 10. ⚠ marks queries that returned zero results without a follow-up question.', why: 'Demand in the shopper’s own words — the raw material for new situations and match keywords.' }}>
          {agg.topQueries.length === 0 && <Empty />}
          <ol className="space-y-1 text-sm">
            {agg.topQueries.map(q => (
              <li key={q.query} className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-intently-pebble w-6 text-right shrink-0">{q.count}×</span>
                <span className="text-intently-ink truncate">{q.query}</span>
                {q.zeroResult && <span className="text-[11px] text-red-600 shrink-0" title="Returned zero results at least once">⚠ zero-result</span>}
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Zero-result queries"
          tip={{ what: 'Typed queries that produced no results and no consultation question.', how: 'Turns with resultCount = 0 and no question asked, grouped by query.', why: 'Every entry is a shopper the engine failed — a catalogue gap or a vocabulary miss to fix. This should be near-empty.' }}>
          {agg.zeroResultQueries.length === 0 && <p className="text-xs text-intently-moss">None in range — the engine always answered or asked. 🎉</p>}
          <ol className="space-y-1 text-sm">
            {agg.zeroResultQueries.map(q => (
              <li key={q.query} className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-intently-pebble w-6 text-right shrink-0">{q.count}×</span>
                <span className="text-intently-ink truncate">{q.query}</span>
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </div>
  )
}

// ── Conversation ──

function Conversation({ agg }: { agg: Aggregates }) {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Escalation rate" value={pctFmt(agg.escalationRate)}
          tip={{ what: 'Share of typed turns the complexity gate sent to the LLM.', how: 'Escalated turns ÷ typed (non-tapped) turns. The gate escalates on negation, long briefs, or wording outside the engine’s vocabulary.', why: 'THE operating number: it drives both comprehension quality and cost. Tune it with the complexity threshold in Configuration.' }} />
        <Stat label="Turns / session" value={num(agg.turnsPerSession)}
          tip={{ what: 'Average discovery turns per session.', how: 'Turn events ÷ distinct sessions.', why: 'Conversation depth. ~2–4 is a healthy consult-then-reveal; 1 = one-shot search; very high may mean shoppers can’t get to a good shortlist.' }} />
        <Stat label="Question answer rate" value={pctFmt(agg.answerRate)}
          tip={{ what: 'How often shoppers answer the tailor’s questions by tapping an option.', how: 'Tapped-answer turns ÷ questions asked.', why: 'Consultation health: a low rate means questions feel like friction — shoppers type past them or leave.' }} />
        <Stat label="Latency p50 / p95" value={`${num(agg.latencyP50)} / ${num(agg.latencyP95)} ms`}
          tip={{ what: 'Median and tail response time of a discovery turn.', how: 'Whole-route latency per turn event; 50th and 95th percentile.', why: 'Deterministic turns are ~instant; LLM turns add 1–2s. A rising p95 usually means a slow provider or model.' }} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="LLM turn rate" value={pctFmt(agg.llmTurnRate)}
          tip={{ what: 'Share of ALL turns where an LLM actually ran (parse or re-voice).', how: 'Turns with an LLM stage ÷ all turns. Differs from escalation rate: providers may be off, budget may be exhausted, tapped answers never escalate.', why: 'The real AI-usage number the bill follows — escalation rate × provider availability.' }} />
        <Stat label="Questions asked" value={String(agg.questionsAsked)}
          tip={{ what: 'Consultation questions the tailor asked (blocking or sharpening).', how: 'Turns whose response carried a question.', why: 'Ask-before-offer is Intently’s signature; zero questions means briefs are always rich (unlikely) or consultation is broken.' }} />
        <Stat label="Re-voice accepted" value={`${agg.genAccepted} / ${agg.genAccepted + agg.genRejected}`}
          tip={{ what: 'LLM rephrasings that passed the faithfulness + grounding gates and were shown.', how: 'Accepted ÷ attempted re-voicings. Rejections keep the deterministic template — the shopper never sees a failure.', why: 'Model quality per model: a low acceptance rate means the model mangles structure or over-promises; compare models in the bench.' }} />
        <Stat label="Grounding rejections" value={String(agg.groundingRejections)}
          tip={{ what: 'Times the verifier blocked prose naming an unshown product or promising an action Intently can’t perform.', how: 'Re-voicings rejected specifically by the grounding check (verify.ts).', why: 'Each one is a prevented over-promise — the safety layer visibly earning its keep. Rising numbers = the model needs a look.' }} />
      </div>

      {agg.arms && (
        <Section title="Experiment — arm A vs arm B"
          tip={{ what: 'Live comparison of the two model configurations in the running A/B (Configuration → Experiment).', how: 'Every turn is tagged with its sticky per-session arm; rows aggregate per arm. Cart adds credit the arm the session was assigned to.', why: 'The bench compares models offline; this is how they behave with real shoppers — the number that decides which config wins.' }}>
          <div className="overflow-x-auto">
            <table className="text-sm w-full">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-intently-pebble text-left">
                  <th className="py-1 pr-4 font-normal">Arm</th>
                  <th className="py-1 pr-4 font-normal">Sessions</th>
                  <th className="py-1 pr-4 font-normal">Turns</th>
                  <th className="py-1 pr-4 font-normal">Escalated</th>
                  <th className="py-1 pr-4 font-normal">Re-voice accepted</th>
                  <th className="py-1 pr-4 font-normal">Grounding rej.</th>
                  <th className="py-1 pr-4 font-normal">Cost</th>
                  <th className="py-1 pr-4 font-normal">Latency p50</th>
                  <th className="py-1 font-normal">Cart adds</th>
                </tr>
              </thead>
              <tbody>
                {agg.arms.map(a => (
                  <tr key={a.arm} className="border-t border-intently-cloud/60">
                    <td className="py-1.5 pr-4 font-medium text-intently-ink">{a.arm}</td>
                    <td className="py-1.5 pr-4 font-mono text-xs">{a.sessions}</td>
                    <td className="py-1.5 pr-4 font-mono text-xs">{a.turns}</td>
                    <td className="py-1.5 pr-4 font-mono text-xs">{a.escalated}</td>
                    <td className="py-1.5 pr-4 font-mono text-xs">{a.genAttempted ? `${a.genAccepted}/${a.genAttempted}` : '—'}</td>
                    <td className="py-1.5 pr-4 font-mono text-xs">{a.groundingRejections}</td>
                    <td className="py-1.5 pr-4 font-mono text-xs">{usd(a.costUsd)}</td>
                    <td className="py-1.5 pr-4 font-mono text-xs">{a.latencyP50 === null ? '—' : `${a.latencyP50} ms`}</td>
                    <td className="py-1.5 font-mono text-xs">{a.cartAdds}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-intently-pebble mt-2">
            At demo traffic these are directional comparisons, not statistical significance — treat a
            consistent multi-day gap as signal, a single-day gap as noise.
          </p>
        </Section>
      )}
    </div>
  )
}

// ── Budget ──

function Budget({ agg }: { agg: Aggregates }) {
  const maxProv = Math.max(1e-9, ...agg.costByProvider.map(p => p.costUsd))
  const maxDay = Math.max(1e-9, ...agg.daily.map(d => d.costUsd))
  const anyEstimated = agg.costByProvider.some(p => p.estimated)
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="LLM spend (range)" value={usd(agg.totalCostUsd, 4)}
          tip={{ what: 'Total LLM cost across parse + re-voice in the selected range.', how: 'Per-call token usage (from each provider’s usage block) × the per-1M-token price table. OpenAI prices are verified list prices; DeepSeek/Haiku defaults are estimates (env-overridable).', why: 'The absolute bill. Everything below explains where it goes and what it buys.' }} />
        <Stat label="Cost / session" value={usd(agg.costPerSession)}
          tip={{ what: 'What one shopper session costs in LLM spend — “cost per user”.', how: 'Total cost ÷ distinct sessions.', why: 'The unit economics headline: compare against the value of a session (AOV × conversion) to judge if the AI pays for itself.' }} />
        <Stat label="Cost / turn" value={usd(agg.costPerTurn)}
          tip={{ what: 'Average LLM cost of a single discovery turn — including free deterministic ones.', how: 'Total cost ÷ all turns. Effective cost = per-token price × tokens × escalation rate.', why: 'Shows the complexity gate working: this should sit far below the cost of an escalated turn.' }} />
        <Stat label="Cost / escalated turn" value={usd(agg.costPerEscalatedTurn)}
          tip={{ what: 'Average cost of the turns that DID use the LLM.', how: 'Total cost ÷ escalated turns.', why: 'The true per-call price of comprehension + re-voicing — the number to compare across models in the bench.' }} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Projected month" value={usd(agg.projectedMonthUsd, 2)}
          tip={{ what: 'Forward 28-day burn at the current pace.', how: 'Trailing-7-day average daily cost × 28. A pace projection, not a forecast model.', why: 'The “am I about to blow the budget” number — check it after changing models, thresholds, or traffic.' }} />
        <Stat label="Cost / cart add" value={usd(agg.costPerCartAdd)}
          tip={{ what: 'LLM spend per proxy conversion — the AI’s acquisition cost.', how: 'Total cost ÷ cart adds.', why: 'The ROI ratio: if this approaches the margin of an average item, the model mix is too expensive.' }} />
        <Stat label="Turns in range" value={String(agg.turns)}
          tip={{ what: 'All discovery turns in the range.', how: 'Count of turn events.', why: 'Volume context for every rate above — costs scale with this.' }} />
        <Stat label="Prices" value={anyEstimated ? 'partly estimated' : 'list'}
          tip={{ what: 'Whether the cost numbers rest on verified or estimated prices.', how: 'OpenAI gpt-5.4-nano: verified list price. DeepSeek / Haiku: estimated defaults — override with ANALYTICS_PRICE_* env vars. Tokens are always exact.', why: 'Honesty about precision: treat estimated-cost providers as directionally right, token counts as ground truth.' }} />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Section title="Spend by provider"
          tip={{ what: 'Where the money goes, per model provider.', how: 'Per-call costs grouped by provider; ≈ marks estimated prices.', why: 'The input to the model decision: pair with the bench’s quality verdicts to pick the cheapest model that’s good enough.' }}>
          {agg.costByProvider.length === 0 && <Empty />}
          <div className="space-y-1.5">
            {agg.costByProvider.map(p => (
              <BarRow key={p.provider}
                label={`${p.provider}${p.estimated ? ' ≈' : ''}`}
                valueLabel={`${usd(p.costUsd)} · ${((p.tokensIn + p.tokensOut) / 1000).toFixed(1)}k tok`}
                value={p.costUsd} max={maxProv}
                color={PROVIDER_COLOR[p.provider] ?? '#6366f1'} />
            ))}
          </div>
        </Section>

        <Section title="Spend by stage"
          tip={{ what: 'Comprehension (parse) vs re-voicing (generate) share of the bill.', how: 'Per-call costs grouped by pipeline stage.', why: 'If re-voicing dominates while acceptance is low, that spend buys nothing — switch its model or turn the stage off.' }}>
          <div className="space-y-1.5">
            {agg.costByStage.map(s => (
              <BarRow key={s.stage} label={s.stage} valueLabel={usd(s.costUsd)}
                value={s.costUsd} max={Math.max(1e-9, ...agg.costByStage.map(x => x.costUsd))} color="#6366f1" />
            ))}
          </div>
        </Section>
      </div>

      <Section title="Daily spend (trailing 28 days in range)"
        tip={{ what: 'LLM cost per day.', how: 'Per-call costs bucketed by UTC day; the last 28 days with events.', why: 'The burn trend behind the projection — spikes line up with launches, model switches, or traffic.' }}>
        {agg.daily.length === 0 && <Empty />}
        <div className="flex items-end gap-1 h-28">
          {agg.daily.map(d => (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-1 min-w-0"
              title={`${d.day}: ${usd(d.costUsd)} · ${d.turns} turns · ${d.llmCalls} LLM calls`}>
              <div className="w-full max-w-6 rounded-t bg-intently-ink/80" style={{ height: `${Math.max(2, (d.costUsd / maxDay) * 96)}px` }} />
              <span className="text-[10px] text-intently-pebble font-mono rotate-0 truncate w-full text-center">{d.day.slice(5)}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

// ── Shared pieces ──

interface Tip { what: string; how: string; why: string }

function InfoTip({ tip }: { tip: Tip }) {
  return (
    <span className="relative inline-flex group/info align-middle">
      <span tabIndex={0}
        className="w-3.5 h-3.5 rounded-full border border-intently-pebble text-intently-pebble text-[10px] leading-none grid place-items-center cursor-help select-none group-hover/info:border-intently-ink group-hover/info:text-intently-ink">
        i
      </span>
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-20 hidden group-hover/info:block group-focus-within/info:block w-80 bg-intently-ink text-white text-xs leading-relaxed rounded-md px-3 py-2.5 shadow-lg normal-case tracking-normal text-left space-y-1.5">
        <span className="block"><strong className="text-white/95">What:</strong> {tip.what}</span>
        <span className="block"><strong className="text-white/95">How:</strong> {tip.how}</span>
        <span className="block"><strong className="text-white/95">Why it matters:</strong> {tip.why}</span>
      </span>
    </span>
  )
}

function Stat({ label, value, tip }: { label: string; value: string; tip: Tip }) {
  return (
    <div className="border border-intently-cloud rounded-lg px-4 py-3">
      <div className="text-xs uppercase tracking-wider text-intently-pebble flex items-center gap-1.5">{label} <InfoTip tip={tip} /></div>
      <div className="text-xl font-light text-intently-ink font-mono mt-0.5 truncate">{value}</div>
    </div>
  )
}

function Section({ title, tip, children }: { title: string; tip: Tip; children: React.ReactNode }) {
  return (
    <section className="border border-intently-cloud rounded-lg p-4">
      <h2 className="text-sm text-intently-ink font-medium mb-3 flex items-center gap-1.5">{title} <InfoTip tip={tip} /></h2>
      {children}
    </section>
  )
}

function BarRow({ label, value, valueLabel, max, color }: { label: string; value: number; valueLabel?: string; max: number; color: string }) {
  return (
    <div className="flex items-center gap-3" title={`${label}: ${valueLabel ?? value}`}>
      <span className="w-44 text-xs text-intently-slate truncate shrink-0">{label}</span>
      <div className="flex-1 h-4 bg-intently-paper rounded overflow-hidden">
        <div className="h-full rounded" style={{ width: `${Math.max(1, (value / max) * 100)}%`, backgroundColor: color }} />
      </div>
      <span className="w-28 text-right font-mono text-xs text-intently-ink shrink-0">{valueLabel ?? value}</span>
    </div>
  )
}

function Empty() {
  return <p className="text-xs text-intently-pebble italic">No data in range.</p>
}
