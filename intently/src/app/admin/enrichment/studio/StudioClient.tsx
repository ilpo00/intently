'use client'

// ─────────────────────────────────────────────────────────────────
// Enrichment Studio · interactive workspace
//
// Opens the enrichment black box for a merchandiser:
//   · pipeline ribbon + health band — is the catalogue discovery-ready?
//   · product list with a derived enrichment-quality score
//   · per-product anatomy: raw → enriched attributes → embed text → vector
//   · discovery preview: type a situation, see what surfaces (selected
//     product highlighted) — the feedback loop
//   · tune: a what-if on the embed text (the single biggest match lever)
//
// All reads reuse the existing /api/enrichment/* endpoints.
// ─────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { PimProduct, SearchResult } from '@/types/enrichment'
import {
  assessQuality,
  readRaw,
  needsAttention,
  formalityLabel,
  provenanceFor,
  BAND_META,
  PROVENANCE_KIND,
  PROBES,
  type StudioRow,
} from './lib'

interface Summary {
  source: string
  total: number
  embedded: number
  vectorCount: number
  storeKind: string
  embedderKind: string
  model: string
}
interface Neighbour { id: string; title: string; score: number }
type Filter = 'all' | 'attention'

const pct = (n: number) => `${(Math.max(0, Math.min(1, n)) * 100).toFixed(1)}%`

// Curatable attribute vocabularies — must mirror the edit API's coercion
// (src/app/api/enrichment/products/[id]/route.ts).
const ARCHES = ['classic', 'minimalist', 'romantic', 'bohemian', 'sporty', 'edgy', 'preppy', 'relaxed', 'elegant'] as const
const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const
const FORMALITY: { v: number; label: string }[] = [
  { v: 1, label: 'very casual' }, { v: 2, label: 'casual' }, { v: 3, label: 'smart casual' },
  { v: 4, label: 'formal' }, { v: 5, label: 'black tie' },
]
type Arch = typeof ARCHES[number]
type Season = typeof SEASONS[number]
interface EditForm {
  color: string          // comma-separated
  pattern: string
  occasionTags: string   // comma-separated
  styleTags: Arch[]
  formalityLevel: number
  season: Season[]
  fabric: string         // comma-separated
}
const splitCsv = (s: string) => s.split(',').map(x => x.trim().toLowerCase()).filter(Boolean)
const rankOf = (rs: SearchResult[], id: string) => rs.findIndex(r => r.id === id)

export default function StudioClient({ rows, summary, overriddenIds, initialProduct, vision }: { rows: StudioRow[]; summary: Summary; overriddenIds: string[]; initialProduct: string | null; vision: boolean }) {
  const overridden = useMemo(() => new Set(overriddenIds), [overriddenIds])
  const assessed = useMemo(
    () => rows.map(r => ({ row: r, q: assessQuality(r) })),
    [rows],
  )

  const health = useMemo(() => {
    const strong = assessed.filter(a => a.q.band === 'strong').length
    const fair = assessed.filter(a => a.q.band === 'fair').length
    const thin = assessed.filter(a => a.q.band === 'thin').length
    const attention = assessed.filter(a => needsAttention(a.q)).length
    return { strong, fair, thin, attention }
  }, [assessed])

  const [filter, setFilter] = useState<Filter>('all')
  const [listQuery, setListQuery] = useState('')
  // Deep link from the needs-attention queue ("Fix"): ?product=<id> (resolved
  // server-side) preselects that product; else the first row.
  const [selectedId, setSelectedId] = useState<string | null>(
    (initialProduct && rows.some(r => r.productId === initialProduct) ? initialProduct : rows[0]?.productId) ?? null,
  )

  const visible = useMemo(() => {
    const lq = listQuery.trim().toLowerCase()
    return assessed.filter(({ row, q }) => {
      if (filter === 'attention' && !needsAttention(q)) return false
      if (lq && !(`${row.productTitle} ${row.productId}`.toLowerCase().includes(lq))) return false
      return true
    })
  }, [assessed, filter, listQuery])

  const selected = useMemo(
    () => assessed.find(a => a.row.productId === selectedId) ?? null,
    [assessed, selectedId],
  )

  return (
    <div className="max-w-6xl">
      <Header summary={summary} />
      <HealthBand health={health} total={summary.total} embedded={summary.embedded}
        onPick={f => setFilter(f)} active={filter} />

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 mt-8">
        <ProductList
          items={visible}
          total={assessed.length}
          selectedId={selectedId}
          onSelect={setSelectedId}
          filter={filter}
          setFilter={setFilter}
          listQuery={listQuery}
          setListQuery={setListQuery}
        />
        {selected ? (
          <Detail key={selected.row.productId} entry={selected} initiallyOverridden={overridden.has(selected.row.productId)} vision={vision} />
        ) : (
          <div className="border border-intently-cloud rounded-lg p-10 text-center text-intently-pebble text-sm">
            Select a product to open its enrichment.
          </div>
        )}
      </div>
    </div>
  )
}

// ── Header ──
function Header({ summary }: { summary: Summary }) {
  return (
    <header className="mb-8">
      <div className="flex items-center gap-3 mb-2">
        <h1 className="font-sans text-2xl font-light text-intently-ink">Enrichment Studio</h1>
        <span className="text-[11px] uppercase tracking-wider bg-intently-paper text-intently-pebble px-2 py-0.5 rounded">cockpit</span>
      </div>
      <p className="text-intently-pebble text-sm leading-relaxed max-w-3xl">
        The enrichment layer is what lets a flat catalogue answer <em>situations</em>{' '}
        (“a dress for an outdoor July wedding”), not just keywords. This is where you
        see whether the catalogue is <strong className="text-intently-slate font-medium">discovery-ready</strong>,
        why a product does or doesn’t surface, and what to change — without an engineer.
      </p>
      <p className="text-xs text-intently-pebble/80 font-mono mt-2">
        {summary.source} · {summary.embedderKind} embedder · {summary.storeKind} store · {summary.model}
      </p>
    </header>
  )
}

// ── Health band ──
function HealthBand({
  health, total, embedded, onPick, active,
}: {
  health: { strong: number; fair: number; thin: number; attention: number }
  total: number; embedded: number
  onPick: (f: Filter) => void; active: Filter
}) {
  const seg = (n: number) => (total ? (n / total) * 100 : 0)
  return (
    <div className="mt-4 border border-intently-cloud rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs tracking-[0.2em] text-intently-pebble uppercase">Catalogue health</h2>
        <span className="text-xs text-intently-pebble">
          {embedded}/{total} embedded ·{' '}
          <button onClick={() => onPick('attention')}
            className={`underline underline-offset-4 ${active === 'attention' ? 'text-intently-ink' : 'text-intently-slate hover:text-intently-ink'}`}>
            {health.attention} need attention
          </button>
        </span>
      </div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-intently-paper">
        <div className="bg-intently-moss" style={{ width: `${seg(health.strong)}%` }} title={`Strong: ${health.strong}`} />
        <div className="bg-amber-400" style={{ width: `${seg(health.fair)}%` }} title={`Fair: ${health.fair}`} />
        <div className="bg-red-400" style={{ width: `${seg(health.thin)}%` }} title={`Thin: ${health.thin}`} />
      </div>
      <div className="flex gap-5 mt-2 text-xs text-intently-pebble">
        <Legend dot="bg-intently-moss" label="Strong" n={health.strong} />
        <Legend dot="bg-amber-400" label="Fair" n={health.fair} />
        <Legend dot="bg-red-400" label="Thin" n={health.thin} />
      </div>
    </div>
  )
}
function Legend({ dot, label, n }: { dot: string; label: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${dot}`} />{label} <span className="font-mono text-intently-slate">{n}</span>
    </span>
  )
}

// ── Product list ──
function ProductList({
  items, total, selectedId, onSelect, filter, setFilter, listQuery, setListQuery,
}: {
  items: { row: StudioRow; q: ReturnType<typeof assessQuality> }[]
  total: number
  selectedId: string | null
  onSelect: (id: string) => void
  filter: Filter; setFilter: (f: Filter) => void
  listQuery: string; setListQuery: (s: string) => void
}) {
  // Single catalogue: no fashion/outdoor split in the UI (project memory).
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'attention', label: 'Needs attention' },
  ]
  return (
    <div className="border border-intently-cloud rounded-lg overflow-hidden flex flex-col h-[640px]">
      <div className="p-3 border-b border-intently-cloud space-y-2">
        <input
          value={listQuery}
          onChange={e => setListQuery(e.target.value)}
          placeholder="Filter products…"
          className="w-full text-sm font-sans text-intently-ink bg-white border border-intently-cloud rounded px-2.5 py-1.5 focus:outline-none focus:border-intently-ink"
        />
        <div className="flex flex-wrap gap-1.5">
          {filters.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                filter === f.id
                  ? 'border-intently-ink bg-intently-ink text-white'
                  : 'border-intently-cloud text-intently-slate hover:border-intently-pebble'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-y-auto flex-1">
        {items.map(({ row, q }) => {
          const meta = BAND_META[q.band]
          const isSel = row.productId === selectedId
          return (
            <button key={row.productId} onClick={() => onSelect(row.productId)}
              className={`w-full text-left px-3 py-2.5 border-b border-intently-cloud flex items-center gap-3 transition-colors ${
                isSel ? 'bg-intently-paper' : 'hover:bg-intently-paper/60'
              }`}>
              <Thumb src={row.product?.imageUrl} title={row.productTitle} size={36} />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-intently-ink truncate">{row.productTitle}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                  <span className={`text-xs ${meta.text}`}>{meta.label}</span>
                  <span className="text-xs text-intently-pebble font-mono">{q.score}</span>
                  {!row.hasVector && <span className="text-[11px] text-red-600">no vector</span>}
                </div>
              </div>
            </button>
          )
        })}
        {items.length === 0 && (
          <div className="p-6 text-center text-xs text-intently-pebble">No products match.</div>
        )}
      </div>
      <div className="px-3 py-2 border-t border-intently-cloud text-xs text-intently-pebble">
        {items.length} of {total}
      </div>
    </div>
  )
}

// ── Detail ──
function Detail({ entry, initiallyOverridden, vision }: { entry: { row: StudioRow; q: ReturnType<typeof assessQuality> }; initiallyOverridden: boolean; vision: boolean }) {
  const { row, q } = entry
  const p = row.product
  const raw = readRaw(p)
  const meta = BAND_META[q.band]
  const prov = provenanceFor(row, vision)
  const provKinds = [...new Set(prov.map(r => r.kind))]

  const [neighbours, setNeighbours] = useState<Neighbour[] | null>(null)
  const [embedText, setEmbedText] = useState<string>(row.embedText ?? '')

  // curator edit
  const [overridden, setOverridden] = useState(initiallyOverridden)
  const curateRef = useRef<HTMLDivElement>(null)

  // Arriving from the queue's "Fix" (…?product=<id>#curate) → scroll to the
  // editor, then drop the hash so flipping between products doesn't re-scroll.
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hash !== '#curate') return
    const t = setTimeout(() => {
      curateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }, 300)
    return () => clearTimeout(t)
  }, [])

  // discovery probe
  const [probe, setProbe] = useState('')
  const [probeRan, setProbeRan] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)

  // tuning
  const [tuneText, setTuneText] = useState(row.embedText ?? '')
  const [tunePreview, setTunePreview] = useState<SearchResult[] | null>(null)
  const [tuning, setTuning] = useState(false)
  const [reembedding, setReembedding] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setNeighbours(null)
    fetch(`/api/enrichment/vectors/${encodeURIComponent(row.productId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!alive || !d) return
        setNeighbours((d.neighbours as Neighbour[]).slice(0, 6))
        if (typeof d.record?.embedText === 'string') {
          setEmbedText(d.record.embedText)
          setTuneText(d.record.embedText)
        }
      })
      .catch(() => {})
    return () => { alive = false }
  }, [row.productId])

  const runProbe = useCallback(async (text: string): Promise<SearchResult[]> => {
    const queryText = text.trim()
    if (!queryText) return []
    setSearching(true); setProbeRan(queryText)
    try {
      const res = await fetch('/api/enrichment/search', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: queryText, k: 6 }),
      })
      const d = await res.json()
      const rs: SearchResult[] = d.results ?? []
      setResults(rs)
      return rs
    } finally { setSearching(false) }
  }, [])

  const runTune = useCallback(async () => {
    const t = tuneText.trim()
    if (!t) return
    setTuning(true)
    try {
      const res = await fetch('/api/enrichment/search', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: t, k: 6 }),
      })
      const d = await res.json()
      setTunePreview((d.results as SearchResult[]).filter(r => r.id !== row.productId).slice(0, 5))
    } finally { setTuning(false) }
  }, [tuneText, row.productId])

  const reembed = useCallback(async () => {
    setReembedding(true); setToast(null)
    try {
      const res = await fetch(`/api/enrichment/sync/${encodeURIComponent(row.productId)}`, { method: 'POST' })
      setToast(res.ok ? 'Re-indexed from source ✓' : 'Re-index failed')
    } finally { setReembedding(false); setTimeout(() => setToast(null), 3000) }
  }, [row.productId])

  // ── curate: edit the structured attributes → PUT → re-embed → measure shift ──
  const initialForm = useMemo<EditForm>(() => ({
    color: raw.colors.join(', '),
    pattern: raw.pattern ?? '',
    occasionTags: raw.occasionTags.join(', '),
    styleTags: raw.styleTags.filter((s): s is Arch => (ARCHES as readonly string[]).includes(s)),
    formalityLevel: raw.formalityLevel ?? 2,
    season: raw.seasons.filter((s): s is Season => (SEASONS as readonly string[]).includes(s)),
    fabric: raw.fabric.join(', '),
  }), [raw])
  const [form, setForm] = useState<EditForm>(initialForm)
  const [saving, setSaving] = useState(false)
  const [impact, setImpact] = useState<{ probe: string; before: number; after: number } | null>(null)
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialForm), [form, initialForm])

  const save = useCallback(async () => {
    setSaving(true); setToast(null)
    // Baseline rank for the probe we'll measure against (reuse the last probe
    // the PM ran, else a sensible default) — captured BEFORE the edit lands.
    const probeForImpact = (probeRan || PROBES[3]).trim()
    const before = results && probeRan ? rankOf(results, row.productId) : rankOf(await runProbe(probeForImpact), row.productId)
    try {
      const res = await fetch(`/api/enrichment/products/${encodeURIComponent(row.productId)}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          color: splitCsv(form.color),
          pattern: form.pattern.trim() || 'solid',
          occasionTags: splitCsv(form.occasionTags),
          styleTags: form.styleTags,
          formalityLevel: form.formalityLevel,
          season: form.season,
          fabric: splitCsv(form.fabric),
        }),
      })
      if (!res.ok) { setToast('Save failed'); return }
      setOverridden(true)
      const after = rankOf(await runProbe(probeForImpact), row.productId) // re-embedded; re-rank
      setImpact({ probe: probeForImpact, before, after })
      setToast('Saved · re-indexed ✓')
    } finally { setSaving(false); setTimeout(() => setToast(null), 3500) }
  }, [form, probeRan, results, runProbe, row.productId])

  const revert = useCallback(async () => {
    setSaving(true); setToast(null)
    try {
      const res = await fetch(`/api/enrichment/products/${encodeURIComponent(row.productId)}`, { method: 'DELETE' })
      if (!res.ok) { setToast('Revert failed'); return }
      setOverridden(false); setForm(initialForm); setImpact(null)
      await runProbe((probeRan || PROBES[3]).trim())
      setToast('Reverted to catalogue ✓')
    } finally { setSaving(false); setTimeout(() => setToast(null), 3500) }
  }, [initialForm, probeRan, runProbe, row.productId])

  // Dev/demo: ?demo=1 auto-runs a probe + tune preview so a still screenshot
  // shows the discovery loop populated. Gated; zero effect in normal use.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (!params.get('demo')) return
    const pq = params.get('q') || PROBES[0]
    setProbe(pq)
    const t1 = setTimeout(() => runProbe(pq), 500)
    const t2 = setTimeout(() => runTune(), 1100)
    return () => { clearTimeout(t1); clearTimeout(t2) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rank = results?.findIndex(r => r.id === row.productId) ?? -1

  return (
    <div className="space-y-6">
      {/* product header */}
      <div className="flex items-start gap-4">
        <div className="shrink-0 text-center">
          <Thumb src={p?.imageUrl} title={row.productTitle} size={72} />
          <div className={`text-[10px] mt-1 uppercase tracking-wide ${vision ? 'text-indigo-600' : 'text-intently-pebble'}`}
            title={vision ? 'This photo was read by a vision model to derive the attributes below' : 'The image is displayed but never read by a model'}>
            {vision ? 'vision-analysed' : 'not analysed'}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-2">
            <h2 className="font-sans text-lg text-intently-ink">{row.productTitle}</h2>
            <span className={`inline-flex items-center gap-1.5 text-xs ${meta.text}`}>
              <span className={`w-2 h-2 rounded-full ${meta.dot}`} /> {meta.label} · {q.score}
            </span>
            {overridden && (
              <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded"
                title="A curator override is active — discovery uses your edited attributes, not the catalogue's.">
                ✎ edited by curator
              </span>
            )}
          </div>
          <div className="text-xs text-intently-pebble font-mono mt-1">
            {row.productId} · {p?.category}{p?.subcategory ? ` › ${p.subcategory}` : ''}
            {raw.brand ? ` · ${raw.brand}` : ''}
          </div>
        </div>
        <button onClick={reembed} disabled={reembedding}
          className="text-xs border border-intently-cloud rounded px-3 py-1.5 text-intently-slate hover:border-intently-pebble disabled:opacity-40">
          {reembedding ? 'indexing…' : 're-index'}
        </button>
      </div>
      {toast && <div className="text-xs text-intently-moss">{toast}</div>}

      {/* anatomy: raw → enriched → embed text → vector */}
      <Section title="From data to discovery" hint="What the PIM gives us, what we derive, the exact string the model reads, and what gets indexed.">
        <div className="grid sm:grid-cols-2 gap-3">
          <Panel label="1 · From the PIM (raw product data)">
            <KV k="Category" v={p?.category} />
            <KV k="Type" v={p?.subcategory} />
            <KV k="Colour" v={p?.color} missing={!p?.color} />
            <KV k="Season" v={p?.season} missing={!p?.season} />
            <KV k="Occasion" v={p?.usage} missing={!p?.usage} />
            <KV k="Gender" v={p?.gender} missing={!p?.gender} />
          </Panel>
          <Panel label="2 · Enriched (attributes Intently derives)">
            <ChipsRow label="Occasions" items={raw.occasionTags} />
            <ChipsRow label="Styles" items={raw.styleTags} />
            <KV k="Formality" v={formalityLabel(raw.formalityLevel)} missing={raw.formalityLevel == null} />
            <KV k="Pattern" v={raw.pattern} />
          </Panel>
        </div>
        <Panel label="3 · Search text — the exact words discovery matches against" className="mt-3">
          <pre className="whitespace-pre-wrap font-mono text-xs text-intently-slate leading-relaxed">{embedText || '—'}</pre>
          <div className="text-xs text-intently-pebble mt-2">{embedText.length} chars · composed in <code className="font-mono">enrich-text.ts</code></div>
        </Panel>
        <Panel label="4 · Indexed (searchable for discovery)" className="mt-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
            <KV inline k="Status" v={row.hasVector ? 'embedded' : 'pending'} />
            <KV inline k="Model" v={(row.model ?? '—').replace(/^Xenova\//, '')} />
            <KV inline k="Embedded" v={row.embeddedAt ? new Date(row.embeddedAt).toLocaleString() : '—'} />
            {row.hasVector && (
              <Link href={`/admin/enrichment/${encodeURIComponent(row.productId)}`}
                className="ml-auto text-intently-slate hover:text-intently-ink underline underline-offset-4"
                title="The raw vector internals: embedding preview, distribution, and cosine neighbours">
                details →
              </Link>
            )}
          </div>
        </Panel>
      </Section>

      {/* attribute provenance — how each attribute is made, and is the image used? */}
      <Section title="How these attributes are made — is the photo analysed?"
        hint={vision
          ? 'Yes — each product’s photo is read by a vision model to derive these attributes. They compose the search text; the text (not the pixels) is what gets indexed.'
          : 'Every attribute the discovery layer uses is computed from text. The image is shown, but never read by a model.'}>
        {vision ? (
          <div className="flex items-start gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3 mb-4">
            <span className="text-base leading-none">👁️</span>
            <p className="text-xs text-indigo-900 leading-relaxed">
              <strong>Vision-analysed.</strong> Each product’s <strong>photo</strong> is read by a vision model
              (<code className="font-mono">Claude Haiku</code>) to extract colour, pattern, material, silhouette,
              formality, occasions and style (see each row). Those attributes compose the search text, which a text
              embedder (<code className="font-mono">MiniLM</code>) indexes — so the model reasons over the photo’s
              <em> description</em>, not the pixels themselves.
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 mb-4">
            <span className="text-base leading-none">📷</span>
            <p className="text-xs text-amber-900 leading-relaxed">
              <strong>No vision analysis in this catalogue.</strong> Colour, pattern, occasion, style and formality are
              derived deterministically from the PIM’s text fields and the product name (see each row).
              Two image-only attributes — <code className="font-mono">fabric</code> and{' '}
              <code className="font-mono">silhouette</code> — are left blank because they’d require reading
              the photo. (Switch to the vision-enriched catalogue to derive these from the image.)
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
          {provKinds.map(k => (
            <span key={k} className="inline-flex items-center gap-1.5 text-xs text-intently-pebble">
              <span className={`w-2 h-2 rounded-full ${PROVENANCE_KIND[k].dot}`} />{PROVENANCE_KIND[k].label}
            </span>
          ))}
        </div>

        <div className="border border-intently-cloud rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-intently-paper text-left text-xs uppercase tracking-wider text-intently-pebble">
              <tr>
                <th className="px-3 py-2">Attribute</th>
                <th className="px-3 py-2">Value</th>
                <th className="px-3 py-2">Derived from</th>
                <th className="px-3 py-2">Method</th>
              </tr>
            </thead>
            <tbody>
              {prov.map(pr => {
                const k = PROVENANCE_KIND[pr.kind]
                return (
                  <tr key={pr.attr} className="border-t border-intently-cloud align-top">
                    <td className="px-3 py-2 text-intently-ink whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${k.dot}`} />{pr.attr}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-intently-slate">{pr.value}</td>
                    <td className={`px-3 py-2 ${k.text}`}>{pr.signal}</td>
                    <td className="px-3 py-2 text-intently-pebble">{pr.method}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* quality checklist */}
      <Section title="Enrichment quality" hint="The signals a merchandiser can improve. Each lifts how reliably the product matches a situation.">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 h-2 bg-intently-paper rounded-full overflow-hidden">
            <div className={`h-2 rounded-full ${q.band === 'strong' ? 'bg-intently-moss' : q.band === 'fair' ? 'bg-amber-400' : 'bg-red-400'}`}
              style={{ width: `${q.score}%` }} />
          </div>
          <span className="font-mono text-sm text-intently-ink">{q.score}/100</span>
        </div>
        <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {q.signals.map(s => (
            <li key={s.key} className="flex items-start gap-2 text-xs">
              <span className={s.present ? 'text-intently-moss' : 'text-red-500'}>{s.present ? '✓' : '✕'}</span>
              <span className={s.present ? 'text-intently-slate' : 'text-intently-ink'}>
                {s.label}
                {!s.present && <span className="text-intently-pebble block">{s.hint}</span>}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {/* discovery preview / surfacing */}
      <Section title="Discovery preview" hint="Type a shopper situation (e.g. “a dress for a summer wedding”). The enrichment layer returns the top matches — the selected product is highlighted if it surfaces.">
        <div className="flex flex-wrap gap-1.5 mb-3">
          {PROBES.map(pq => (
            <button key={pq} onClick={() => { setProbe(pq); runProbe(pq) }}
              className="text-xs px-2.5 py-1 rounded-full border border-intently-cloud text-intently-slate hover:border-intently-pebble">
              {pq}
            </button>
          ))}
        </div>
        <form onSubmit={e => { e.preventDefault(); runProbe(probe) }} className="flex gap-2 mb-3">
          <input value={probe} onChange={e => setProbe(e.target.value)}
            placeholder='e.g. "a warm layer for a cold evening"'
            className="flex-1 text-sm font-sans text-intently-ink bg-white border border-intently-cloud rounded px-3 py-2 focus:outline-none focus:border-intently-ink" />
          <button type="submit" disabled={searching || !probe.trim()}
            className="bg-intently-ink text-white text-sm px-4 py-2 rounded hover:bg-intently-slate disabled:opacity-40">
            {searching ? '…' : 'preview'}
          </button>
        </form>

        {results && (
          <>
            <div className="text-xs mb-2">
              {rank >= 0 ? (
                <span className="text-intently-moss">✓ This product surfaces at #{rank + 1} for “{probeRan}”.</span>
              ) : (
                <span className="text-red-600">✕ Not in the top {results.length} for “{probeRan}” — its enrichment may be too thin for this situation.</span>
              )}
            </div>
            <ol className="border border-intently-cloud rounded-lg overflow-hidden divide-y divide-intently-cloud">
              {results.map((r, i) => {
                const isThis = r.id === row.productId
                return (
                  <li key={r.id} className={`flex items-center gap-3 px-3 py-2 ${isThis ? 'bg-intently-paper' : ''}`}>
                    <span className="w-5 text-xs text-intently-pebble font-mono">{i + 1}</span>
                    <Thumb src={r.metadata.imageUrl} title={r.metadata.title} size={32} />
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm truncate ${isThis ? 'text-intently-ink font-medium' : 'text-intently-slate'}`}>
                        {r.metadata.title}{isThis && ' ← this product'}
                      </div>
                      <div className="text-xs text-intently-pebble truncate">{r.metadata.category}{r.metadata.subcategory ? ` › ${r.metadata.subcategory}` : ''}</div>
                    </div>
                    <ScoreBar score={r.score} />
                  </li>
                )
              })}
            </ol>
          </>
        )}
      </Section>

      {/* curate attributes → re-embed → see the rank shift (the scalpel) */}
      <div id="curate" ref={curateRef} className="scroll-mt-4">
      <Section title="Curate attributes"
        hint="Edit the structured attributes the discovery layer reads. Save re-embeds the product immediately — the change reaches live discovery and the probe above. Non-destructive: it's a runtime override, the committed catalogue is untouched.">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Colours" hint="comma-separated">
            <input value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
              placeholder="navy, cream" className={INPUT} />
          </Field>
          <Field label="Pattern">
            <input value={form.pattern} onChange={e => setForm(f => ({ ...f, pattern: e.target.value }))}
              placeholder="solid" className={INPUT} />
          </Field>
          <Field label="Occasions" hint="the situations this should answer">
            <input value={form.occasionTags} onChange={e => setForm(f => ({ ...f, occasionTags: e.target.value }))}
              placeholder="office, dinner" className={INPUT} />
          </Field>
          <Field label="Materials / fabric" hint="comma-separated">
            <input value={form.fabric} onChange={e => setForm(f => ({ ...f, fabric: e.target.value }))}
              placeholder="wool, cotton" className={INPUT} />
          </Field>
        </div>

        <Field label="Formality" className="mt-4">
          <div className="flex flex-wrap gap-1.5">
            {FORMALITY.map(o => (
              <Toggle key={o.v} active={form.formalityLevel === o.v} onClick={() => setForm(f => ({ ...f, formalityLevel: o.v }))}>
                {o.v} · {o.label}
              </Toggle>
            ))}
          </div>
        </Field>
        <Field label="Style archetypes" className="mt-4">
          <div className="flex flex-wrap gap-1.5">
            {ARCHES.map(a => (
              <Toggle key={a} active={form.styleTags.includes(a)} onClick={() => setForm(f => ({ ...f, styleTags: toggle(f.styleTags, a) }))}>
                {a}
              </Toggle>
            ))}
          </div>
        </Field>
        <Field label="Seasons" className="mt-4">
          <div className="flex flex-wrap gap-1.5">
            {SEASONS.map(s => (
              <Toggle key={s} active={form.season.includes(s)} onClick={() => setForm(f => ({ ...f, season: toggle(f.season, s) }))}>
                {s}
              </Toggle>
            ))}
          </div>
        </Field>

        <div className="flex items-center flex-wrap gap-3 mt-5">
          <button onClick={save} disabled={saving || (!dirty && !overridden)}
            className="text-sm bg-intently-ink text-white px-4 py-2 rounded hover:bg-intently-slate disabled:opacity-40">
            {saving ? 'saving…' : 'Save & re-embed'}
          </button>
          <button onClick={revert} disabled={saving || !overridden}
            className="text-sm border border-intently-cloud px-3 py-2 rounded text-intently-slate hover:border-intently-pebble disabled:opacity-40">
            Revert to catalogue
          </button>
          <span className="text-xs text-intently-pebble">
            Persists to a runtime override · re-embeds on save · reaches <code className="font-mono">/api/discover</code>.
          </span>
        </div>

        {impact && (
          <div className="mt-4 rounded-lg border border-intently-cloud bg-intently-paper/50 p-3">
            <div className="text-xs uppercase tracking-wider text-intently-pebble mb-1">Impact on discovery</div>
            <ImpactLine probe={impact.probe} before={impact.before} after={impact.after} />
          </div>
        )}
      </Section>
      </div>

      {/* tune (what-if) + neighbours */}
      <Section title="Tune the search text" hint="The search text is the single biggest lever on match quality. Edit it and preview which products it would rank beside — without changing anything yet.">
        <textarea value={tuneText} onChange={e => setTuneText(e.target.value)} rows={3}
          className="w-full text-xs font-mono text-intently-slate bg-white border border-intently-cloud rounded p-3 focus:outline-none focus:border-intently-ink leading-relaxed" />
        <div className="flex items-center gap-3 mt-2">
          <button onClick={runTune} disabled={tuning || tuneText.trim() === embedText.trim()}
            className="text-xs bg-intently-ink text-white px-3 py-1.5 rounded hover:bg-intently-slate disabled:opacity-40">
            {tuning ? 'previewing…' : 'Preview impact'}
          </button>
          <span className="text-xs text-intently-pebble">
            Free-form what-if on the raw string. To <em>persist</em> a change, edit the structured attributes in <strong className="text-intently-slate font-medium">Curate</strong> above (re-embeds on save) — this box is preview-only.
          </span>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mt-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-intently-pebble mb-2">Current cohort (nearest now)</div>
            <CohortList items={neighbours ?? []} loading={neighbours === null} />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-intently-pebble mb-2">With edited text</div>
            {tunePreview
              ? <CohortList items={tunePreview.map(r => ({ id: r.id, title: r.metadata.title, score: r.score }))} loading={false} />
              : <div className="text-xs text-intently-pebble py-3">Edit the text and hit “Preview impact”.</div>}
          </div>
        </div>
      </Section>
    </div>
  )
}

// ── small building blocks ──
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border border-intently-cloud rounded-lg p-4">
      <h3 className="text-sm text-intently-ink font-medium">{title}</h3>
      {hint && <p className="text-xs text-intently-pebble mt-0.5 mb-3 max-w-2xl leading-relaxed">{hint}</p>}
      {children}
    </section>
  )
}
function Panel({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`border border-intently-cloud rounded-lg p-3 bg-white ${className}`}>
      <div className="text-xs uppercase tracking-wider text-intently-pebble mb-2">{label}</div>
      {children}
    </div>
  )
}
function KV({ k, v, missing, inline }: { k: string; v?: string | null; missing?: boolean; inline?: boolean }) {
  return (
    <div className={inline ? 'inline-flex items-baseline gap-1.5' : 'flex items-baseline gap-2 text-xs py-0.5'}>
      <span className="text-intently-pebble">{k}</span>
      <span className={`font-mono ${missing ? 'text-red-500 italic' : 'text-intently-slate'}`}>{missing ? 'missing' : (v && String(v).trim() ? v : '—')}</span>
    </div>
  )
}
function ChipsRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex items-start gap-2 text-xs py-0.5">
      <span className="text-intently-pebble shrink-0">{label}</span>
      {items.length ? (
        <span className="flex flex-wrap gap-1">
          {items.map(i => <span key={i} className="bg-intently-paper text-intently-slate rounded px-1.5 py-0.5 text-xs">{i}</span>)}
        </span>
      ) : <span className="text-red-500 italic font-mono">missing</span>}
    </div>
  )
}
function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2 w-28 shrink-0">
      <div className="flex-1 h-1 bg-intently-paper rounded">
        <div className="h-1 bg-intently-moss rounded" style={{ width: pct(score) }} />
      </div>
      <span className="font-mono text-xs text-intently-slate w-12 text-right">{pct(score)}</span>
    </div>
  )
}
function CohortList({ items, loading }: { items: Neighbour[]; loading: boolean }) {
  if (loading) return <div className="text-xs text-intently-pebble py-3">loading…</div>
  if (!items.length) return <div className="text-xs text-intently-pebble py-3">—</div>
  return (
    <ol className="space-y-1.5">
      {items.map(n => (
        <li key={n.id} className="flex items-center gap-2">
          <span className="text-sm text-intently-slate truncate flex-1">{n.title}</span>
          <ScoreBar score={n.score} />
        </li>
      ))}
    </ol>
  )
}

// ── curate editor building blocks ──
const INPUT = 'w-full text-sm font-sans text-intently-ink bg-white border border-intently-cloud rounded px-2.5 py-1.5 focus:outline-none focus:border-intently-ink'
function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]
}
function Field({ label, hint, className = '', children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <div className="text-xs uppercase tracking-wider text-intently-pebble mb-1.5">
        {label}{hint && <span className="normal-case tracking-normal text-intently-pebble/70"> · {hint}</span>}
      </div>
      {children}
    </div>
  )
}
function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border capitalize transition-colors ${
        active ? 'border-intently-ink bg-intently-ink text-white' : 'border-intently-cloud text-intently-slate hover:border-intently-pebble'
      }`}>
      {children}
    </button>
  )
}
function ImpactLine({ probe, before, after }: { probe: string; before: number; after: number }) {
  const fmt = (r: number) => (r >= 0 ? `#${r + 1}` : 'not in top 6')
  const improved = after >= 0 && (before < 0 || after < before)
  const worse = before >= 0 && (after < 0 || after > before)
  const tone = improved ? 'text-intently-moss' : worse ? 'text-red-600' : 'text-intently-slate'
  const arrow = improved ? '↑' : worse ? '↓' : '→'
  return (
    <div className="text-xs text-intently-slate">
      For “{probe}”: <span className="font-mono">{fmt(before)}</span> <span className={tone}>{arrow}</span>{' '}
      <span className={`font-mono ${tone}`}>{fmt(after)}</span>
      {!improved && !worse && <span className="text-intently-pebble"> · no rank change (try a query your edit targets)</span>}
    </div>
  )
}

// Image with graceful fallback (catalogue jpg paths don't all resolve).
function Thumb({ src, title, size }: { src?: string; title: string; size: number }) {
  const [broken, setBroken] = useState(false)
  const ok = src && !broken
  return ok ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" onError={() => setBroken(true)}
      className="object-cover rounded bg-intently-paper shrink-0"
      style={{ width: size, height: size }} />
  ) : (
    <div className="rounded bg-intently-paper shrink-0 flex items-center justify-center text-intently-stone"
      style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {title.trim()[0]?.toUpperCase() ?? '·'}
    </div>
  )
}
