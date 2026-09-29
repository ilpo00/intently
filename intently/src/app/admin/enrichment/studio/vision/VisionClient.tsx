'use client'

// ─────────────────────────────────────────────────────────────────
// Vision enrichment preview — PIM-sourced context vs vision-enriched context.
// Renders the cached batch output; no model call here.
// ─────────────────────────────────────────────────────────────────

import { useState } from 'react'
import Link from 'next/link'
import RunEnrichmentButton from '@/components/admin/RunEnrichmentButton'

// Contracts live in @/types/vision — they now cross the client/server boundary
// in both directions (the enrichment core and store are server-side).
import type { VisionRecord, VisionReport } from '@/types/vision'

const FORMALITY = ['', 'very casual', 'casual', 'smart casual', 'formal', 'black tie']

export default function VisionClient({ report }: { report: VisionReport | null }) {
  const records = report?.records.filter(r => r.vision) ?? []
  const [selectedId, setSelectedId] = useState<string | null>(records[0]?.id ?? null)
  const selected = records.find(r => r.id === selectedId) ?? null

  return (
    <div className="max-w-6xl">
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="font-sans text-2xl font-light text-intently-ink">Vision enrichment</h1>
          {report && <span className="text-[11px] uppercase tracking-wider bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">preview · {report.version}</span>}
          <div className="ml-auto flex items-center gap-4">
            <RunEnrichmentButton scope="sample" />
            <Link href="/admin/enrichment/studio" className="text-xs text-intently-pebble hover:text-intently-ink underline underline-offset-4">
              ← Studio
            </Link>
          </div>
        </div>
        <p className="text-intently-pebble text-sm leading-relaxed max-w-3xl">
          The PIM is the system of record; <strong className="text-intently-slate font-medium">vision enrichment reads the photo</strong> and
          fills the context the PIM never had — colour, pattern, materials, silhouette, situational occasions,
          and <em>discovery queries</em> the shopper would actually type. PIM-sourced and vision-enriched context are kept separate below.
        </p>
      </header>

      {!report ? (
        <div className="border border-intently-cloud rounded-lg p-8 text-sm text-intently-pebble">
          Nothing enriched yet — press <strong className="text-intently-slate">Run vision enrichment</strong> above
          to analyse the product photos. It runs in batches and shows progress; the results are saved as it goes,
          so you can stop and resume without losing (or re-paying for) work.
        </div>
      ) : (
        <>
          {/* where it runs + cost */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <Stat label="Model" value={report.model.replace(/-\d{8}$/, '')} />
            <Stat label="Avg tokens / product" value={String(report.avgPerProduct)} />
            <Stat label="Est. cost / product" value={`$${report.estCostPerProductUSD.toFixed(4)}`} />
            <Stat label="Batch" value={`${report.ok}/${report.count} · ${(report.durationMs / 1000).toFixed(0)}s`} />
          </div>
          <p className="text-xs text-intently-pebble mb-6 -mt-3">
            Runs as a cached batch, never in the discovery hot path — the shopper never waits for a vision call. {report.rateNote}.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
            {/* list */}
            <div className="border border-intently-cloud rounded-lg overflow-hidden h-[640px] overflow-y-auto">
              {records.map(r => (
                <button key={r.id} onClick={() => setSelectedId(r.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-intently-cloud flex items-center gap-3 ${r.id === selectedId ? 'bg-intently-paper' : 'hover:bg-intently-paper/60'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.image} alt="" className="w-10 h-10 object-cover rounded bg-intently-paper shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm text-intently-ink truncate">{r.vision!.garmentType}</div>
                    <div className="text-xs text-intently-pebble truncate">{r.vision!.primaryColour} · {r.vision!.pattern}</div>
                  </div>
                </button>
              ))}
            </div>

            {/* detail */}
            {selected && selected.vision && <Detail r={selected} />}
          </div>
        </>
      )}
    </div>
  )
}

function Detail({ r }: { r: VisionRecord }) {
  const v = r.vision!
  const pimKeys = ['title', 'articleType', 'gender', 'baseColour'] as const
  const pim = r.pim ?? {}
  const pimFilled = pimKeys.filter(k => pim[k]).length
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={r.image} alt="" className="w-24 h-32 object-cover rounded bg-intently-paper shrink-0" />
        <div className="min-w-0">
          <h2 className="font-sans text-lg text-intently-ink">{v.garmentType}</h2>
          <div className="text-xs text-intently-pebble font-mono mt-1">{r.id}</div>
          <div className="text-xs text-intently-pebble mt-1">
            confidence <span className="font-mono text-intently-slate">{(v.confidence * 100).toFixed(0)}%</span>
            {r.usage && <> · <span className="font-mono">{r.usage.input}+{r.usage.output} tok</span></>}
            {r.flags && r.flags.length > 0 && <> · <span className="text-amber-600">validator: {r.flags.join('; ')}</span></>}
          </div>
        </div>
      </div>

      {/* PIM vs Vision, separated */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="border border-intently-cloud rounded-lg p-4 bg-white">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-wider text-intently-pebble">PIM-sourced context</span>
            <span className="text-[11px] text-intently-pebble">{pimFilled}/4 fields</span>
          </div>
          <Row k="Title" v={pim.title} />
          <Row k="Article type" v={pim.articleType} />
          <Row k="Gender" v={pim.gender} />
          <Row k="Base colour" v={pim.baseColour ?? undefined} />
          <p className="text-xs text-intently-pebble mt-3 leading-relaxed">Thin master data — what a real PIM reliably holds. No pattern, materials, silhouette, occasions or situational context.</p>
        </div>

        <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50/40">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs uppercase tracking-wider text-indigo-700">Vision-enriched</span>
            <span className="text-[11px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">📷 from the photo</span>
          </div>
          <Row k="Primary colour" v={v.primaryColour} accent />
          <ChipRow k="Colours" items={v.colours} />
          <Row k="Pattern" v={v.pattern} accent />
          <ChipRow k="Materials" items={v.materials} />
          <Row k="Silhouette" v={v.silhouette} accent />
          <Row k="Formality" v={`${FORMALITY[v.formality] ?? ''} (${v.formality})`} accent />
          <ChipRow k="Seasons" items={v.seasons} />
          <ChipRow k="Occasions" items={v.occasions} />
          <ChipRow k="Style" items={v.styleArchetypes} />
        </div>
      </div>

      {/* the discovery-facing payoff */}
      {v.discoveryQueries && v.discoveryQueries.length > 0 && (
        <div className="border border-intently-moss/40 rounded-lg p-4 bg-intently-moss/5">
          <div className="text-xs uppercase tracking-wider text-intently-moss mb-2">Feeds the discovery layer · example situations this should surface for</div>
          <div className="flex flex-wrap gap-2">
            {v.discoveryQueries.map((q, i) => (
              <span key={i} className="text-sm text-intently-slate bg-white border border-intently-cloud rounded-full px-3 py-1">“{q}”</span>
            ))}
          </div>
        </div>
      )}

      {/* merchandising description */}
      <div className="border border-intently-cloud rounded-lg p-4">
        <div className="text-xs uppercase tracking-wider text-intently-pebble mb-1">Merchandising description (generated)</div>
        <p className="text-sm text-intently-slate leading-relaxed">{v.description}</p>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-intently-cloud rounded-lg p-3">
      <div className="text-[11px] uppercase tracking-wider text-intently-pebble mb-1">{label}</div>
      <div className="text-sm font-mono text-intently-ink truncate">{value}</div>
    </div>
  )
}
function Row({ k, v, accent }: { k: string; v?: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 text-xs py-1 border-b border-intently-cloud/50 last:border-0">
      <span className="text-intently-pebble w-24 shrink-0">{k}</span>
      <span className={`font-mono ${v ? (accent ? 'text-indigo-800' : 'text-intently-slate') : 'text-intently-stone italic'}`}>{v || '—'}</span>
    </div>
  )
}
function ChipRow({ k, items }: { k: string; items: string[] }) {
  return (
    <div className="flex items-start gap-2 text-xs py-1 border-b border-intently-cloud/50 last:border-0">
      <span className="text-intently-pebble w-24 shrink-0">{k}</span>
      {items.length ? (
        <span className="flex flex-wrap gap-1">
          {items.map(i => <span key={i} className="bg-white border border-indigo-200 text-indigo-800 rounded px-1.5 py-0.5 text-xs">{i}</span>)}
        </span>
      ) : <span className="text-intently-stone italic font-mono">—</span>}
    </div>
  )
}
