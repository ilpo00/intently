'use client'

// ─────────────────────────────────────────────────────────────────
// Catalogue management — multiple levels of detail over the vision-enriched
// catalogue: Overview (distributions), Coverage (cohort intersections),
// Segments, an Action list, and a product grid driven by whichever lens is in
// focus. All computed client-side from the cached vision.
// ─────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react'
import Link from 'next/link'
import RunEnrichmentButton from '@/components/admin/RunEnrichmentButton'

import { type AttnItem, coarseCategory, buildAttention } from './insights'

export interface CatItem extends AttnItem {
  image: string
  primaryColour: string; colours: string[]
  formality: number; seasons: string[]
}
export interface ReadinessComponent {
  key: string; label: string; value: number; weight: number; how: string; outcome: string
}
export interface Readiness {
  score: number
  components: ReadinessComponent[]
  situations: { label: string; top: number; served: boolean }[]
}
export interface CatData {
  items: CatItem[]
  readiness: Readiness
  darkThreshold: number
  summary: { total: number; ok: number; model: string; cost: number; tokens: number }
}

type Dim = 'category' | 'style' | 'pattern' | 'occasion' | 'formality' | 'season'
const KEYS: Record<Dim, (it: CatItem) => string[]> = {
  category: it => [coarseCategory(it.garmentType)],
  style: it => it.styleArchetypes,
  pattern: it => [it.pattern],
  occasion: it => it.occasions,
  formality: it => [String(it.formality)],
  season: it => it.seasons,
}

type Focus =
  | { kind: 'segment'; dim: Dim; value: string }
  | { kind: 'cohort'; cat: string; formality: number }
  | { kind: 'quality'; id: string }
  | null

function tally(items: CatItem[], keyFn: (it: CatItem) => string[]): [string, number][] {
  const m = new Map<string, number>()
  for (const it of items) for (const k of keyFn(it)) if (k) m.set(k, (m.get(k) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

export default function CatalogClient({ data }: { data: CatData | null }) {
  const [dim, setDim] = useState<Dim>('category')
  const [focus, setFocus] = useState<Focus>(null)

  const agg = useMemo(() => {
    if (!data) return null
    const it = data.items
    const formality = ['1', '2', '3', '4', '5'].map(k => [k, it.filter(x => String(x.formality) === k).length] as [string, number])
    const season = ['spring', 'summer', 'autumn', 'winter'].map(k => [k, it.filter(x => x.seasons.includes(k)).length] as [string, number])
    const category = tally(it, KEYS.category)
    const formalwear = it.filter(x => x.formality >= 4).length
    const winter = it.filter(x => x.seasons.includes('winter')).length
    const maxSeason = Math.max(...season.map(s => s[1]))
    return {
      category, style: tally(it, KEYS.style), pattern: tally(it, KEYS.pattern),
      occasion: tally(it, KEYS.occasion), colour: tally(it, x => [x.primaryColour]),
      formality, season, formalwear, winter, maxSeason,
      avgConfidence: it.reduce((s, x) => s + x.confidence, 0) / (it.length || 1),
    }
  }, [data])

  const attentionDefs = useMemo(() => (data ? buildAttention(data.items) : []), [data])
  const attention = useMemo(
    () => attentionDefs.map(q => ({ ...q, count: (data?.items ?? []).filter(q.test).length })).filter(q => q.count > 0).sort((a, b) => b.count - a.count),
    [attentionDefs, data],
  )

  const filtered = useMemo(() => {
    if (!data) return []
    const f = focus
    if (!f) return data.items
    if (f.kind === 'segment') return data.items.filter(it => KEYS[f.dim](it).includes(f.value))
    if (f.kind === 'cohort') return data.items.filter(it => coarseCategory(it.garmentType) === f.cat && it.formality === f.formality)
    const q = attentionDefs.find(x => x.id === f.id)
    return q ? data.items.filter(q.test) : data.items
  }, [data, focus, attentionDefs])

  if (!data || !agg) {
    return (
      <div className="max-w-6xl">
        <Head />
        <div className="border border-intently-cloud rounded-lg p-8 text-sm text-intently-pebble">
          No vision-enriched catalogue yet. Press <strong className="text-intently-slate">Run vision enrichment</strong> above to analyse every catalogue photo — it runs in batches you can stop and resume.
        </div>
      </div>
    )
  }

  const focusLabel =
    focus?.kind === 'segment' ? `${focus.dim}: ${focus.value}`
      : focus?.kind === 'cohort' ? `${focus.cat} · formality ${focus.formality}`
        : focus?.kind === 'quality' ? attentionDefs.find(q => q.id === focus.id)?.label
          : null

  const cohortCats = agg.category.slice(0, 9).map(c => c[0])
  const cohortMax = Math.max(1, ...cohortCats.flatMap(c => [1, 2, 3, 4, 5].map(f => data.items.filter(it => coarseCategory(it.garmentType) === c && it.formality === f).length)))

  return (
    <div className="max-w-6xl">
      <Head summary={data.summary} avgConf={agg.avgConfidence} />

      <ReadinessCard r={data.readiness} />
      <Explainer />

      {/* ── Overview · the whole range ── */}
      <SectionLabel level="Overview" title="The whole range — how the catalogue is distributed" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-9">
        <BarPanel title="Formality (1 casual → 5 black-tie)" rows={agg.formality} onPick={v => setFocus({ kind: 'segment', dim: 'formality', value: v })} />
        <BarPanel title="Season coverage" rows={agg.season} onPick={v => setFocus({ kind: 'segment', dim: 'season', value: v })} />
        <BarPanel title="Pattern mix" rows={agg.pattern} onPick={v => setFocus({ kind: 'segment', dim: 'pattern', value: v })} />
        <BarPanel title="Style archetypes" rows={agg.style.slice(0, 9)} onPick={v => setFocus({ kind: 'segment', dim: 'style', value: v })} />
        <BarPanel title="Top colours" rows={agg.colour.slice(0, 9)} />
        <BarPanel title="Top occasions covered" rows={agg.occasion.slice(0, 9)} onPick={v => setFocus({ kind: 'segment', dim: 'occasion', value: v })} />
      </div>

      {/* ── Coverage · cohort intersections ── */}
      <SectionLabel level="Coverage" title="Coverage gaps — category × formality (red = a gap, click a cell to drill)" />
      <div className="overflow-x-auto mb-9">
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left font-normal text-intently-pebble px-2 py-1 sticky left-0 bg-white">category ╲ formality</th>
              {[1, 2, 3, 4, 5].map(f => (
                <th key={f} className="font-mono font-normal text-intently-pebble px-2 py-1 text-center w-16">{f}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohortCats.map(cat => (
              <tr key={cat}>
                <td className="capitalize text-intently-slate px-2 py-1 sticky left-0 bg-white whitespace-nowrap">{cat}</td>
                {[1, 2, 3, 4, 5].map(f => {
                  const n = data.items.filter(it => coarseCategory(it.garmentType) === cat && it.formality === f).length
                  const active = focus?.kind === 'cohort' && focus.cat === cat && focus.formality === f
                  const bg = n === 0 ? 'rgba(220,38,38,0.06)' : `rgba(29,158,117,${0.1 + 0.7 * (n / cohortMax)})`
                  return (
                    <td key={f} className="p-0.5">
                      <button disabled={n === 0} onClick={() => setFocus({ kind: 'cohort', cat, formality: f })}
                        title={`${cat} · formality ${f}: ${n}`}
                        className={`w-full h-8 rounded font-mono text-xs transition ${n === 0 ? 'text-red-300 cursor-default' : 'text-intently-ink hover:ring-1 hover:ring-intently-pebble'} ${active ? 'ring-2 ring-intently-ink' : ''}`}
                        style={{ backgroundColor: bg }}>
                        {n === 0 ? '—' : n}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Segments · segment explorer ── */}
      <SectionLabel level="Segments" title="By segment — pick a lens, then drill into a segment" />
      <div className="flex flex-wrap gap-2 mb-4">
        {(['category', 'style', 'pattern', 'occasion', 'formality', 'season'] as Dim[]).map(d => (
          <button key={d} onClick={() => { setDim(d); setFocus(null) }}
            className={`text-xs px-3 py-1.5 rounded-full border capitalize transition-colors ${
              dim === d ? 'border-intently-ink bg-intently-ink text-white' : 'border-intently-cloud text-intently-slate hover:border-intently-pebble'
            }`}>
            {d}
          </button>
        ))}
      </div>
      <div className="border border-intently-cloud rounded-lg p-3 mb-9">
        <div className="text-xs uppercase tracking-wider text-intently-pebble mb-2">{dim} · {agg[dim].length} segments</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-1 max-h-72 overflow-y-auto">
          {(agg[dim] as [string, number][]).map(([label, n]) => {
            const active = focus?.kind === 'segment' && focus.dim === dim && focus.value === label
            return (
              <button key={label} onClick={() => setFocus(active ? null : { kind: 'segment', dim, value: label })}
                className={`text-left rounded px-2 py-1 ${active ? 'bg-intently-paper' : 'hover:bg-intently-paper/60'}`}>
                <div className="flex items-center justify-between text-xs">
                  <span className={`capitalize truncate ${active ? 'text-intently-ink font-medium' : 'text-intently-slate'}`}>{label}</span>
                  <span className="font-mono text-intently-pebble">{n}</span>
                </div>
                <div className="h-1 bg-intently-paper rounded mt-0.5">
                  <div className="h-1 bg-intently-moss rounded" style={{ width: `${(n / (agg[dim] as [string, number][])[0][1]) * 100}%` }} />
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Needs-attention query + gaps ── */}
      <SectionLabel level="Action list" title="Needs attention — query the products to act on (click a reason)" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-9">
        <div className="border border-intently-cloud rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider text-intently-pebble">Reasons (click to query the grid below)</span>
            <Link href="/admin/enrichment/studio/attention" className="text-xs text-amber-600 hover:text-amber-700 underline underline-offset-4 whitespace-nowrap">open work queue →</Link>
          </div>
          {attention.length === 0 ? (
            <div className="text-xs text-intently-pebble py-2">Nothing needs attention — every product is fully attributed and reachable by a situation.</div>
          ) : (
            <ul className="space-y-1">
              {attention.map(q => {
                const active = focus?.kind === 'quality' && focus.id === q.id
                return (
                  <li key={q.id}>
                    <button onClick={() => setFocus(active ? null : { kind: 'quality', id: q.id })}
                      className={`w-full text-left rounded px-2 py-1.5 ${active ? 'bg-intently-paper' : 'hover:bg-intently-paper/60'}`}>
                      <div className="flex items-center justify-between text-xs">
                        <span className={active ? 'text-intently-ink font-medium' : 'text-intently-slate'}>{q.label}</span>
                        <span className="font-mono text-amber-600">{q.count}</span>
                      </div>
                      <div className="text-[11px] text-intently-pebble leading-snug">{q.hint} <span className="text-intently-pebble/80">→ {q.outcome}</span></div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="border border-intently-cloud rounded-lg p-3">
          <div className="text-xs uppercase tracking-wider text-intently-pebble mb-2">Catalogue gaps (buying signals)</div>
          <ul className="space-y-2 text-xs text-intently-slate">
            <Gap ok={agg.formalwear >= 15} label={`Formalwear: ${agg.formalwear} items at formality 4–5 of ${data.summary.ok}`} note="Office / black-tie situations can’t be served." />
            <Gap ok={agg.winter >= agg.maxSeason * 0.6} label={`Winter coverage: ${agg.winter} (vs ${agg.maxSeason} peak season)`} note="Cold-weather situations are thinly stocked." />
            <Gap ok={(agg.style.find(s => s[0] === 'elegant')?.[1] ?? 0) >= 30} label={`Elegant pieces: ${(agg.style.find(s => s[0] === 'elegant')?.[1] ?? 0)}`} note="Dressy / refined intents have little to match." />
          </ul>
        </div>
      </div>

      {/* ── product level · the products in focus ── */}
      <SectionLabel level="Products" title="Products in focus" />
      <div className="text-xs uppercase tracking-wider text-intently-pebble mb-2">
        {focusLabel
          ? <>In focus · <span className="text-intently-ink normal-case font-medium">{focusLabel}</span> · {filtered.length} products
              <button onClick={() => setFocus(null)} className="ml-2 text-intently-pebble hover:text-intently-ink lowercase">clear</button></>
          : `All ${filtered.length} products`}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {filtered.slice(0, 48).map(it => (
          <article key={it.id} className="border border-intently-cloud rounded-lg overflow-hidden bg-white">
            <div className="aspect-[3/4] bg-intently-paper">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.image} alt="" loading="lazy" className="w-full h-full object-cover" />
            </div>
            <div className="p-2">
              <div className="text-xs text-intently-ink truncate" title={it.garmentType}>{it.garmentType}</div>
              <div className="text-[11px] text-intently-pebble mt-0.5">{it.primaryColour} · {it.pattern} · f{it.formality}</div>
            </div>
          </article>
        ))}
      </div>
      {filtered.length > 48 && <p className="text-xs text-intently-pebble mt-2">showing 48 of {filtered.length}</p>}
    </div>
  )
}

function Gap({ ok, label, note }: { ok: boolean; label: string; note: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className={ok ? 'text-intently-moss' : 'text-red-500'}>{ok ? '✓' : '!'}</span>
      <span>
        <span className={ok ? 'text-intently-slate' : 'text-intently-ink'}>{label}</span>
        {!ok && <span className="text-intently-pebble block text-xs">{note}</span>}
      </span>
    </li>
  )
}

function ReadinessCard({ r }: { r: Readiness }) {
  const band = r.score >= 70 ? 'text-intently-moss' : r.score >= 45 ? 'text-amber-600' : 'text-red-600'
  const label = r.score >= 70 ? 'ready' : r.score >= 45 ? 'partly ready' : 'not ready'
  return (
    <div className="border border-intently-cloud rounded-lg p-4 mb-4">
      <div className="flex flex-col sm:flex-row items-start gap-5">
        <div className="text-center shrink-0 w-28">
          <div className={`text-4xl font-light font-mono ${band}`}>{r.score}</div>
          <div className="text-[11px] uppercase tracking-wider text-intently-pebble">/ 100 · {label}</div>
          <div className="text-xs uppercase tracking-[0.16em] text-intently-ink mt-1">Discovery readiness</div>
        </div>
        <div className="flex-1 min-w-0 space-y-3 w-full">
          {r.components.map(c => (
            <div key={c.key}>
              <div className="flex items-center justify-between text-xs">
                <span className="text-intently-slate">{c.label} <span className="text-intently-pebble">· weight {c.weight}%</span></span>
                <span className="font-mono text-intently-ink">{Math.round(c.value * 100)}%</span>
              </div>
              <div className="h-1.5 bg-intently-paper rounded mt-0.5">
                <div className="h-1.5 rounded bg-intently-moss" style={{ width: `${c.value * 100}%` }} />
              </div>
              <div className="text-[11px] text-intently-pebble leading-snug mt-1">
                <span className="text-intently-slate">How:</span> {c.how}{' '}
                <span className="text-intently-slate">Impact:</span> {c.outcome}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-intently-cloud">
        <div className="text-xs uppercase tracking-wider text-intently-pebble mb-2">Situation serviceability · best match per situation (strong ≥0.65 · weak ≥0.50)</div>
        <div className="flex flex-wrap gap-2">
          {r.situations.map(s => {
            const cls = s.top >= 0.65 ? 'border-intently-moss/40 bg-intently-moss/5 text-intently-moss'
              : s.top >= 0.5 ? 'border-amber-300 bg-amber-50 text-amber-600'
                : 'border-red-200 bg-red-50 text-red-500'
            const sym = s.top >= 0.65 ? '✓' : s.top >= 0.5 ? '~' : '✕'
            return (
              <span key={s.label} title={`best match ${s.top.toFixed(2)}`}
                className={`text-xs rounded-full px-2.5 py-1 border ${cls}`}>
                {s.label} · {s.top.toFixed(2)} {sym}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Explainer() {
  return (
    <details className="border border-intently-cloud rounded-lg mb-9 group">
      <summary className="cursor-pointer list-none px-4 py-2.5 text-xs text-intently-slate flex items-center justify-between hover:bg-intently-paper/50 rounded-lg">
        <span>How this works — and what these numbers mean for sales</span>
        <span className="text-intently-pebble">▾</span>
      </summary>
      <div className="px-4 pb-4 text-xs text-intently-pebble leading-relaxed space-y-2 max-w-3xl">
        <p><span className="text-intently-slate font-medium">The pipeline, in plain terms.</span> AI reads each product <em>photo</em> and writes its attributes — colour, pattern, material, formality, occasions, style. Those attributes are what let a shopper find products by describing a <em>situation</em> (“something warm for a cold evening”) instead of guessing categories.</p>
        <p><span className="text-intently-slate font-medium">Discovery readiness (0–100)</span> is how prepared the catalogue is for that, from three things you control: are products fully described (<em>completeness</em>), does the range span enough situations (<em>coverage</em>), and can we actually answer the situations shoppers ask for (<em>serviceability</em>). Every number on this page shows exactly how it’s computed and the cost of the gap.</p>
        <p><span className="text-intently-slate font-medium">Why it matters for e-commerce.</span> A situation we can’t answer is a dead-end search — a shopper who leaves empty-handed. Higher readiness = more situations served = more searches that end on a product (and a sale). The “needs attention” list and the catalogue gaps are the specific, fixable reasons readiness isn’t 100.</p>
      </div>
    </details>
  )
}

function Head({ summary, avgConf }: { summary?: CatData['summary']; avgConf?: number }) {
  return (
    <header className="mb-6">
      <div className="flex items-center gap-3 mb-2">
        <h1 className="font-sans text-2xl font-light text-intently-ink">Catalogue management</h1>
        <span className="text-[11px] uppercase tracking-wider bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">vision-enriched</span>
        <div className="ml-auto flex items-center gap-4">
          <RunEnrichmentButton scope="catalog" />
          <Link href="/admin/enrichment/studio" className="text-xs text-intently-pebble hover:text-intently-ink underline underline-offset-4">← Studio</Link>
        </div>
      </div>
      <p className="text-intently-pebble text-sm leading-relaxed max-w-3xl">
        The whole catalogue understood from its photos — manage it at every level of detail: an overview of the
        range, coverage gaps, by segment, down to the product. The lens a merchandiser uses to spot gaps
        (“no formal outerwear”, “all dresses are summer”), over-supply, and enrichment quality.
      </p>
      {summary && (
        <div className="text-xs text-intently-pebble mt-2 font-mono">
          {summary.ok}/{summary.total} photos vision-enriched · {summary.model.replace(/-\d{8}$/, '')} · {summary.tokens.toLocaleString()} tok · ~${summary.cost}
          {typeof avgConf === 'number' && <> · avg confidence {(avgConf * 100).toFixed(0)}%</>}
        </div>
      )}
    </header>
  )
}

function SectionLabel({ level, title }: { level: string; title: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-3">
      <span className="text-[11px] uppercase tracking-[0.18em] text-intently-moss font-mono shrink-0">{level}</span>
      <h2 className="text-sm text-intently-ink font-medium">{title}</h2>
    </div>
  )
}

function BarPanel({ title, rows, onPick }: { title: string; rows: [string, number][]; onPick?: (v: string) => void }) {
  const max = Math.max(1, ...rows.map(r => r[1]))
  return (
    <div className="border border-intently-cloud rounded-lg p-3">
      <div className="text-xs uppercase tracking-wider text-intently-pebble mb-2">{title}</div>
      <div className="space-y-1">
        {rows.map(([label, n]) => (
          <button key={label} disabled={!onPick} onClick={() => onPick?.(label)}
            className={`w-full text-left ${onPick ? 'cursor-pointer' : 'cursor-default'}`}>
            <div className="flex items-center justify-between text-xs">
              <span className="capitalize text-intently-slate truncate">{label}</span>
              <span className="font-mono text-intently-pebble">{n}</span>
            </div>
            <div className="h-1.5 bg-intently-paper rounded">
              <div className="h-1.5 bg-intently-moss rounded" style={{ width: `${(n / max) * 100}%` }} />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
