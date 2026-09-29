'use client'

// ─────────────────────────────────────────────────────────────────
// Situation tuner — PMs tune SOFT emphasis (weights, formality target,
// per-garment lean) and watch the catalogue re-rank live, with a per-dimension
// score breakdown. Emphasis, not filters. Saves a runtime override.
//
// Creation is a DRAFT flow: "+ New situation" builds a local draft the PM
// tunes first; nothing persists until "Save new situation". Discard drops it;
// switching away from unsaved work asks first. Each situation has its own
// on/off switch; only active ones bias live discovery. A stats + filter +
// search bar keeps the list legible when a store has many situations.
// ─────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { SituationProfile, SituationDim, DimScore } from '@/lib/discovery/situation-match'
import type { SituationSuggestion } from '@/lib/analytics/mine-situations'

export interface ScoredRow {
  id: string; name: string; category: string; catalog: string
  formalityLevel: number; imageUrl: string; score: number; breakdown: DimScore[]
}

const DIMS: SituationDim[] = ['formality', 'occasion', 'garment', 'style', 'season', 'material']
const DIM_COLOR: Record<SituationDim, string> = {
  formality: '#6366f1', occasion: '#10b981', garment: '#f59e0b',
  style: '#0ea5e9', season: '#fb7185', material: '#8b5cf6',
}
const DIM_TIP: Record<SituationDim, string> = {
  formality: 'How much the dress-code level matters for this situation. High = a gala; low = anything goes.',
  occasion: 'How much a product’s occasion tags (office, party, wedding guest…) should count.',
  garment: 'How much the per-garment lean below matters — whether the situation calls for specific garment types.',
  style: 'How much style archetypes (classic, sporty, romantic…) should count.',
  season: 'How much seasonal fit matters (a linen dress in summer, wool in winter).',
  material: 'How much specific fabrics/materials matter (silk for a gala, technical fabrics for a hike).',
}
const CATEGORIES = ['dress', 'top', 'shirt', 'trousers', 'shorts', 'jacket', 'sweatshirt', 'heels', 'shoes', 'backpack', 'sunglasses', 'cap']
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

const DRAFT_ID = '__draft__'

// A blank slate: importance weights all at ZERO (nothing emphasised yet), so
// the PM builds the situation up from scratch rather than editing a copy of
// whatever was selected before.
function seedDraft(label: string, keywords: string[]): SituationProfile {
  return {
    id: DRAFT_ID,
    label,
    query: label.toLowerCase(),
    keywords,
    weights: { formality: 0, occasion: 0, garment: 0, style: 0, season: 0, material: 0 },
    emphasis: { formality: 3, garments: {}, occasionTags: [], styleArchetypes: [], seasons: [], materials: [] },
  }
}

type ActiveFilter = 'all' | 'active' | 'inactive'

export default function SituationsClient({
  initialProfiles, initialResults, initialCustomIds, initialInactiveIds, suggestions,
}: {
  initialProfiles: SituationProfile[]; initialResults: ScoredRow[]
  initialCustomIds: string[]; initialInactiveIds: string[]
  suggestions: SituationSuggestion[]
}) {
  const [profiles, setProfiles] = useState(initialProfiles)
  const [customIds, setCustomIds] = useState<string[]>(initialCustomIds)
  const [inactiveIds, setInactiveIds] = useState<Set<string>>(() => new Set(initialInactiveIds))
  const [selectedId, setSelectedId] = useState(initialProfiles[0]?.id ?? '')
  const [working, setWorking] = useState<SituationProfile>(() => clone(initialProfiles[0]))
  const [results, setResults] = useState<ScoredRow[]>(initialResults)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(false)
  const [filter, setFilter] = useState<ActiveFilter>('all')
  const [search, setSearch] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftRef = useRef<HTMLDivElement | null>(null)

  const isDraft = working.id === DRAFT_ID
  const base = profiles.find(p => p.id === selectedId)
  const dirty = isDraft || (base ? JSON.stringify(working) !== JSON.stringify(base) : false)
  const isCustom = customIds.includes(selectedId)

  const activeCount = profiles.length - profiles.filter(p => inactiveIds.has(p.id)).length
  const inactiveCount = profiles.length - activeCount
  const q = search.trim().toLowerCase()
  const visibleProfiles = profiles.filter(p => {
    const on = !inactiveIds.has(p.id)
    if (filter === 'active' && !on) return false
    if (filter === 'inactive' && on) return false
    if (q && !p.label.toLowerCase().includes(q) && !(p.keywords ?? []).some(k => k.includes(q))) return false
    return true
  })

  const score = useCallback(async (prof: SituationProfile) => {
    setLoading(true)
    try {
      const res = await fetch('/api/enrichment/situations/score', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile: prof, limit: 18 }),
      })
      const d = await res.json()
      setResults(d.results ?? [])
    } finally { setLoading(false) }
  }, [])

  // Debounced re-score on every edit.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => score(working), 220)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [working, score])

  const guardUnsaved = (): boolean => {
    if (!dirty) return true
    return window.confirm(
      isDraft
        ? 'Your new situation is not saved yet. Leave and lose it?'
        : 'You have unsaved slider changes. Switch and lose them?',
    )
  }

  const selectSituation = (id: string) => {
    if (id === selectedId && !isDraft) return
    if (!guardUnsaved()) return
    setSelectedId(id)
    setWorking(clone(profiles.find(p => p.id === id)!))
    setSaved(null)
  }

  const setWeight = (dim: SituationDim, v: number) =>
    setWorking(w => ({ ...w, weights: { ...w.weights, [dim]: v } }))
  const setFormality = (v: number) =>
    setWorking(w => ({ ...w, emphasis: { ...w.emphasis, formality: v } }))
  const setGarment = (cat: string, v: number) =>
    setWorking(w => ({ ...w, emphasis: { ...w.emphasis, garments: { ...w.emphasis.garments, [cat]: v } } }))

  // ── per-situation activate/deactivate ──
  const toggleSituationActive = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    const nextOn = inactiveIds.has(id) // currently inactive → turning on
    // Optimistic; reconcile from the server response.
    setInactiveIds(prev => {
      const s = new Set(prev)
      if (nextOn) s.delete(id); else s.add(id)
      return s
    })
    const res = await fetch('/api/enrichment/situations', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, active: nextOn }),
    })
    if (res.ok) {
      const d = await res.json()
      setInactiveIds(new Set(d.inactive ?? []))
    }
  }

  // ── existing-situation save (override) ──
  const save = async () => {
    const res = await fetch('/api/enrichment/situations', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: working.id, profile: { weights: working.weights, emphasis: working.emphasis } }),
    })
    if (!res.ok) { setSaved('Save failed.'); return }
    // Reconcile local state with the persisted merged profile so `base` matches
    // `working` — otherwise the view stays "unsaved" and switching away warns.
    const d = await res.json()
    const merged = d.profile as SituationProfile
    setProfiles(ps => ps.map(p => (p.id === merged.id ? merged : p)))
    setWorking(clone(merged))
    setSaved('Saved — this override now feeds discovery (when this situation is active).')
    setTimeout(() => setSaved(null), 4000)
  }
  const revert = () => { if (base) setWorking(clone(base)); setSaved(null) }

  // ── draft flow: one click opens a fresh, zeroed tuner; name is edited inline;
  //    Save or Discard is explicit ──
  const openDraft = () => {
    if (isDraft) return // already drafting
    if (!guardUnsaved()) return
    setSelectedId('')            // clear the current selection
    setWorking(seedDraft('', [])) // fresh, zero-valued tuner
    setSaved(null)
    setTimeout(() => draftRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  // One-click from a mined suggestion: draft pre-filled with the demand's
  // label + keywords; the PM tunes weights and saves like any new situation.
  const openDraftFrom = (s: SituationSuggestion) => {
    if (!guardUnsaved()) return
    setSelectedId('')
    setWorking(seedDraft(s.label, s.keywords))
    setSaved(null)
    setTimeout(() => draftRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const setDraftLabel = (label: string) =>
    setWorking(w => ({ ...w, label, query: label.toLowerCase() }))
  const setDraftKeywords = (raw: string) =>
    setWorking(w => ({ ...w, keywords: raw.split(',').map(k => k.trim().toLowerCase()).filter(Boolean) }))

  const saveDraft = async () => {
    if (!working.label.trim()) { setSaved('Give the situation a name first.'); return }
    const res = await fetch('/api/enrichment/situations', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: working.label.trim(),
        keywords: working.keywords ?? [],
        profile: { weights: working.weights, emphasis: working.emphasis },
      }),
    })
    if (!res.ok) { setSaved('Could not save the new situation.'); return }
    const d = await res.json()
    const p = d.profile as SituationProfile
    setProfiles(ps => [...ps, p])
    setCustomIds(d.custom ?? [])
    setSelectedId(p.id)
    setWorking(clone(p))
    setSaved(`“${p.label}” saved — it now joins live discovery like the built-in situations.`)
    setTimeout(() => setSaved(null), 5000)
  }

  const discardDraft = () => {
    const dirtyDraft = JSON.stringify(working) !== JSON.stringify(seedDraft(working.label, working.keywords ?? []))
      || working.label.trim() !== ''
    if (dirtyDraft && !window.confirm('Discard this new situation? Its tuning will be lost.')) return
    const fallback = profiles[0]
    setSelectedId(fallback?.id ?? '')
    if (fallback) setWorking(clone(fallback))
    setSaved(null)
  }

  const deleteSituation = async () => {
    if (!isCustom) return
    if (!window.confirm(`Delete “${working.label}”? This cannot be undone.`)) return
    const res = await fetch(`/api/enrichment/situations?id=${encodeURIComponent(selectedId)}`, { method: 'DELETE' })
    if (!res.ok) { setSaved('Could not delete.'); return }
    const d = await res.json()
    const remaining = profiles.filter(p => p.id !== selectedId)
    setProfiles(remaining)
    setCustomIds(d.custom ?? [])
    setInactiveIds(new Set(d.inactive ?? []))
    const next = remaining[0]
    setSelectedId(next?.id ?? '')
    if (next) setWorking(clone(next))
    setSaved('Deleted.')
    setTimeout(() => setSaved(null), 4000)
  }

  return (
    <div className="max-w-6xl">
      <header className="mb-4">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="font-sans text-2xl font-light text-intently-ink">Situation tuner</h1>
          <span className="text-[11px] uppercase tracking-wider bg-intently-paper text-intently-pebble px-2 py-0.5 rounded">soft ranking emphasis</span>
          <button onClick={() => setShowGuide(true)}
            className="text-xs border border-intently-cloud rounded-full px-3 py-1 text-intently-slate hover:border-intently-ink hover:text-intently-ink transition-colors">
            ? How situations work
          </button>
          <Link href="/admin/enrichment/studio" className="ml-auto text-xs text-intently-pebble hover:text-intently-ink underline underline-offset-4">← Studio</Link>
        </div>
        <p className="text-intently-pebble text-sm leading-relaxed max-w-3xl">
          Situations aren’t hard lines. These are <strong className="text-intently-slate font-medium">soft weights</strong>, not rules —
          they <em>emphasise</em> what people typically wear, and re-order the catalogue. Nothing is excluded: a de-emphasised garment
          (shorts for an office) still appears, just lower — so a shopper whose “office” means shorts is still served.
        </p>
      </header>

      {/* stats + filters — scales to many situations */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 border border-intently-cloud rounded-lg px-4 py-2.5">
        <div className="flex items-center gap-3 text-sm">
          <span className="inline-flex items-center gap-1.5"><Dot on /> <span className="text-intently-ink font-medium">{activeCount}</span> <span className="text-intently-slate">active</span></span>
          <span className="inline-flex items-center gap-1.5"><Dot on={false} /> <span className="text-intently-ink font-medium">{inactiveCount}</span> <span className="text-intently-slate">inactive</span></span>
          <span className="text-intently-pebble">· {profiles.length} total</span>
        </div>
        <div className="flex items-center gap-1 ml-auto">
          {(['all', 'active', 'inactive'] as ActiveFilter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-xs px-2.5 py-1 rounded-full border capitalize transition-colors ${
                filter === f ? 'border-intently-ink bg-intently-ink text-white' : 'border-intently-cloud text-intently-slate hover:border-intently-pebble'
              }`}>{f}</button>
          ))}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="search situations…"
            className="ml-2 border border-intently-cloud rounded px-2 py-1 text-xs w-40" />
        </div>
      </div>
      <p className="text-xs text-intently-pebble mb-3">
        Only <strong className="text-intently-slate">active</strong> situations bias live discovery. Click a chip’s
        <span className="mx-0.5 inline-flex align-middle"><Dot on /></span>/<span className="mx-0.5 inline-flex align-middle"><Dot on={false} /></span>
        to switch it on/off; click its name to tune it. Each query still matches at most one situation.
      </p>

      {/* mined suggestions — demand from real shopper queries that no
          existing situation covers (analytics → tuner, one click) */}
      {suggestions.length > 0 && !isDraft && (
        <div className="mb-4 border border-sky-200 bg-sky-50/50 rounded-lg px-4 py-3">
          <div className="text-xs uppercase tracking-wider text-sky-800 mb-2 flex items-center gap-1.5">
            Suggested from shopper demand
            <Info tip="Mined from real queries in analytics that NO existing situation matches (zero-result queries weigh double). Click one to open a pre-filled draft — nothing is created until you save." />
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map(s => (
              <button key={s.label} onClick={() => openDraftFrom(s)}
                title={`Examples: ${s.examples.join(' · ')}`}
                className="text-xs px-3 py-1.5 rounded-full border border-sky-300 bg-white text-intently-ink hover:border-intently-ink transition-colors">
                + {s.label}
                <span className="ml-1.5 text-intently-pebble">
                  {s.queries} queries{s.zeroResults > 0 && <span className="text-red-600"> · {s.zeroResults} zero-result</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* draft editor — the fresh, zeroed tuner. Name + keywords are edited
          inline here; the sliders below start at zero. */}
      {isDraft && (
        <div ref={draftRef} className="mb-4 border-2 border-amber-400 bg-amber-50 rounded-lg px-4 py-3 space-y-3">
          <div className="text-xs uppercase tracking-wider text-amber-800">New situation — a blank slate, not saved yet</div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-amber-900">
              <span className="mb-1 flex items-center gap-1">Name
                <Info tip="What the situation is called in this tuner. Shoppers never see it — pick a name that describes the moment, e.g. 'School run' or 'Festival weekend'." />
              </span>
              <input autoFocus value={working.label} onChange={e => setDraftLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveDraft()}
                placeholder="e.g. School run" className="border border-amber-300 rounded px-2 py-1.5 text-sm w-48" />
            </label>
            <label className="text-xs text-amber-900">
              <span className="mb-1 flex items-center gap-1">Match keywords <span className="text-amber-700">(comma-sep, optional)</span>
                <Info tip="Words in a shopper's message that trigger this situation — e.g. 'school, drop-off, practical'. The name also matches automatically. Add words you see real shoppers use." />
              </span>
              <input value={(working.keywords ?? []).join(', ')} onChange={e => setDraftKeywords(e.target.value)}
                placeholder="school, drop-off, practical" className="border border-amber-300 rounded px-2 py-1.5 text-sm w-64" />
            </label>
            <button onClick={saveDraft} disabled={!working.label.trim()}
              className="text-sm bg-intently-ink text-white px-4 py-2 rounded hover:bg-intently-slate disabled:opacity-40">Save new situation</button>
            <button onClick={discardDraft}
              className="text-sm border border-amber-400 text-amber-800 px-3 py-2 rounded hover:bg-amber-100">Discard</button>
          </div>
          <p className="text-xs text-amber-700">
            The sliders below start at <strong>zero</strong> — raise the importance of the signals this moment is about,
            set the emphasis, preview the ranking live, then Save.
          </p>
        </div>
      )}

      {/* situation selector — each chip: on/off toggle + click-to-tune */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {visibleProfiles.map(p => {
          const on = !inactiveIds.has(p.id)
          const selected = p.id === selectedId && !isDraft
          return (
            <div key={p.id}
              className={`inline-flex items-center rounded-full border text-xs transition-colors ${
                selected ? 'ring-2 ring-intently-ink border-intently-ink' : on ? 'border-emerald-300' : 'border-red-200'
              } ${on ? 'bg-emerald-50/50' : 'bg-red-50/40'}`}>
              <button onClick={e => toggleSituationActive(p.id, e)}
                title={on ? 'Active — click to deactivate' : 'Inactive — click to activate'}
                className="pl-2.5 pr-1.5 py-1.5 rounded-l-full hover:bg-white/60">
                <Dot on={on} />
              </button>
              <button onClick={() => selectSituation(p.id)}
                className={`pr-3 pl-0.5 py-1.5 rounded-r-full ${on ? 'text-intently-ink' : 'text-red-700 line-through decoration-red-300'}`}>
                {p.label}{customIds.includes(p.id) && <span className="ml-1.5 opacity-60 no-underline">·custom</span>}
              </button>
            </div>
          )
        })}
        {visibleProfiles.length === 0 && <span className="text-xs text-intently-pebble italic">No situations match this filter.</span>}
        <button onClick={openDraft}
          className={`text-xs px-3 py-1.5 rounded-full border border-dashed transition-colors ${
            isDraft ? 'border-amber-400 bg-amber-100 text-amber-800' : 'border-intently-pebble text-intently-slate hover:border-intently-ink hover:text-intently-ink'
          }`}>
          + New situation
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[330px_1fr] gap-6">
        {/* ── controls ── */}
        <div className="space-y-5">
          <Panel title="Importance — how much each signal matters"
            tip="These decide which signals count when ranking products for this situation. 0 = ignore the signal entirely; 100 = it dominates. They are relative to each other.">
            {DIMS.map(dim => (
              <Slider key={dim} label={dim} value={working.weights[dim]} min={0} max={100} step={5}
                color={DIM_COLOR[dim]} onChange={v => setWeight(dim, v)} suffix="" tip={DIM_TIP[dim]} />
            ))}
          </Panel>

          <Panel title="Emphasis — what to lean toward (soft)"
            tip="Where the situation should sit on each signal. The importance sliders above say HOW MUCH these targets matter.">
            <Slider label="formality target" value={working.emphasis.formality} min={1} max={5} step={0.5}
              onChange={setFormality} fmt={v => v.toFixed(1)}
              tip="The dress-code level this situation calls for: 1 = very casual, 3 = smart casual, 5 = black tie. Products near this level score higher (when formality importance is up)." />
            <div className="text-xs text-intently-pebble mt-2 mb-1 flex items-center gap-1">
              garment lean (0 = de-emphasise, still shown · 1 = strong)
              <Info tip="Per garment type: should this situation lean toward or away from it? 0.5 is neutral. Nothing is ever excluded — a 0 garment still appears, just lower." />
            </div>
            <div className="max-h-56 overflow-y-auto pr-1">
              {CATEGORIES.map(cat => (
                <Slider key={cat} label={cat} value={working.emphasis.garments[cat] ?? 0.5} min={0} max={1} step={0.05}
                  color={DIM_COLOR.garment} onChange={v => setGarment(cat, v)} fmt={v => v.toFixed(2)} compact />
              ))}
            </div>
          </Panel>

          {!isDraft && base && (
            <div className="flex items-center gap-2 text-xs border border-intently-cloud rounded-lg px-3 py-2">
              <Dot on={!inactiveIds.has(selectedId)} />
              <span className="text-intently-slate">
                This situation is <strong className="text-intently-ink">{inactiveIds.has(selectedId) ? 'inactive' : 'active'}</strong>
                {inactiveIds.has(selectedId) ? ' — it does not bias discovery.' : ' — it biases matching discovery turns.'}
              </span>
              <button onClick={() => toggleSituationActive(selectedId)}
                className="ml-auto px-2.5 py-1 rounded border border-intently-cloud text-intently-slate hover:border-intently-ink hover:text-intently-ink">
                {inactiveIds.has(selectedId) ? 'Activate' : 'Deactivate'}
              </button>
            </div>
          )}
          {!isDraft && (
            <div className="flex items-center gap-3">
              <button onClick={save} disabled={!dirty}
                className="text-sm bg-intently-ink text-white px-4 py-2 rounded hover:bg-intently-slate disabled:opacity-40">Save override</button>
              <button onClick={revert} disabled={!dirty}
                className="text-sm border border-intently-cloud px-3 py-2 rounded text-intently-slate hover:border-intently-pebble disabled:opacity-40">Revert</button>
              {isCustom && (
                <button onClick={deleteSituation}
                  className="text-sm border border-red-200 text-red-600 px-3 py-2 rounded hover:bg-red-50 ml-auto">Delete</button>
              )}
              {dirty && <span className="text-xs text-amber-600">unsaved</span>}
            </div>
          )}
          {isDraft && (
            <div className="flex items-center gap-3">
              <button onClick={saveDraft}
                className="text-sm bg-intently-ink text-white px-4 py-2 rounded hover:bg-intently-slate">Save new situation</button>
              <button onClick={discardDraft}
                className="text-sm border border-amber-400 text-amber-800 px-3 py-2 rounded hover:bg-amber-100">Discard</button>
            </div>
          )}
          {saved && <p className="text-xs text-intently-moss">{saved}</p>}
        </div>

        {/* ── live ranking ── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <h2 className="text-sm text-intently-ink font-medium">Catalogue ranked for “{working.label.trim() || 'your new situation'}”{loading && <span className="text-intently-pebble font-normal"> · scoring…</span>}</h2>
              <Coverage top={results[0]?.score ?? 0} />
            </div>
            <Legend />
          </div>
          <div className="border border-intently-cloud rounded-lg divide-y divide-intently-cloud overflow-hidden">
            {results.map((r, i) => (
              <Row key={r.id} r={r} rank={i + 1} />
            ))}
            {results.length === 0 && !loading && <div className="p-6 text-center text-xs text-intently-pebble">No results.</div>}
          </div>
          <p className="text-xs text-intently-pebble mt-2">
            Bar = total fit, split by dimension contribution. Everything is ranked, nothing filtered. Click a product to open
            it in the Cockpit.
          </p>
        </div>
      </div>

      {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}
    </div>
  )
}

function Row({ r, rank }: { r: ScoredRow; rank: number }) {
  return (
    <Link href={`/admin/enrichment/studio?product=${encodeURIComponent(r.id)}`}
      className="flex items-center gap-3 px-3 py-2 hover:bg-intently-paper/60 transition-colors group">
      <span className="w-5 text-xs text-intently-pebble font-mono">{rank}</span>
      <Thumb title={r.name} />
      <div className="min-w-0 w-48 shrink-0">
        <div className="text-sm text-intently-ink truncate group-hover:underline underline-offset-2">{r.name}</div>
        <div className="text-xs text-intently-pebble">{r.category} · f{r.formalityLevel}</div>
      </div>
      <div className="flex-1 flex items-center gap-2">
        <div className="flex-1 h-2.5 bg-intently-paper rounded-full overflow-hidden flex">
          {r.breakdown.map(b => (
            <div key={b.dim} style={{ width: `${Math.max(0, b.contribution) * 100}%`, backgroundColor: DIM_COLOR[b.dim] }}
              title={`${b.dim}: weight ${b.weight}, match ${b.match.toFixed(2)} → ${b.contribution.toFixed(3)}`} />
          ))}
        </div>
        <span className="font-mono text-xs text-intently-slate w-10 text-right">{r.score.toFixed(2)}</span>
      </div>
    </Link>
  )
}

/** Small ⓘ with a hover/focus tooltip. */
function Info({ tip }: { tip: string }) {
  return (
    <span className="relative inline-flex group/info align-middle">
      <span tabIndex={0}
        className="w-3.5 h-3.5 rounded-full border border-intently-pebble text-intently-pebble text-[10px] leading-none grid place-items-center cursor-help select-none group-hover/info:border-intently-ink group-hover/info:text-intently-ink">
        i
      </span>
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 z-20 hidden group-hover/info:block group-focus-within/info:block w-64 bg-intently-ink text-white text-xs leading-relaxed rounded-md px-3 py-2 shadow-lg normal-case tracking-normal">
        {tip}
      </span>
    </span>
  )
}

function Slider({ label, value, min, max, step, onChange, color, fmt, suffix, compact, tip }: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; color?: string; fmt?: (v: number) => string; suffix?: string; compact?: boolean; tip?: string
}) {
  return (
    <div className={compact ? 'flex items-center gap-2 py-0.5' : 'mb-2'}>
      <div className={`flex items-center justify-between ${compact ? 'w-20 shrink-0' : 'mb-0.5'}`}>
        <span className="text-xs text-intently-slate capitalize flex items-center gap-1.5">
          {color && !compact && <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: color }} />}
          {label}
          {tip && <Info tip={tip} />}
        </span>
        {!compact && <span className="text-xs font-mono text-intently-pebble">{fmt ? fmt(value) : value}{suffix}</span>}
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-intently-ink" style={color ? { accentColor: color } : undefined} />
      {compact && <span className="text-[11px] font-mono text-intently-pebble w-8 text-right">{fmt ? fmt(value) : value}</span>}
    </div>
  )
}

function Panel({ title, tip, children }: { title: string; tip?: string; children: React.ReactNode }) {
  return (
    <div className="border border-intently-cloud rounded-lg p-3">
      <div className="text-xs uppercase tracking-wider text-intently-pebble mb-2 flex items-center gap-1.5">
        {title}
        {tip && <Info tip={tip} />}
      </div>
      {children}
    </div>
  )
}

function Coverage({ top }: { top: number }) {
  const label = top >= 0.55 ? 'well-served' : top >= 0.45 ? 'partial fit' : 'under-served · catalogue gap'
  const cls = top >= 0.55 ? 'text-intently-moss' : top >= 0.45 ? 'text-amber-600' : 'text-red-500'
  return <span className={`text-xs ${cls}`} title="Best soft fit in the catalogue for this situation">coverage: {top.toFixed(2)} · {label}</span>
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-2.5 gap-y-1">
      {DIMS.map(d => (
        <span key={d} className="inline-flex items-center gap-1 text-[11px] text-intently-pebble">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: DIM_COLOR[d] }} />{d}
        </span>
      ))}
    </div>
  )
}

function Thumb({ title }: { title: string }) {
  return (
    <div className="w-9 h-9 rounded bg-intently-paper shrink-0 grid place-items-center text-intently-stone text-sm">
      {title.trim()[0]?.toUpperCase() ?? '·'}
    </div>
  )
}

/** Green (active) / red (inactive) status dot. */
function Dot({ on }: { on: boolean }) {
  return <span className={`w-2.5 h-2.5 rounded-full inline-block shrink-0 ${on ? 'bg-emerald-500' : 'bg-red-400'}`} />
}

/** The comprehensive "what are situations" guide. */
function GuideModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <h2 className="font-sans text-xl font-light text-intently-ink">Situations — what they are and how to make a good one</h2>
          <button onClick={onClose} className="text-intently-pebble hover:text-intently-ink text-xl leading-none px-1">×</button>
        </div>

        <div className="space-y-4 text-sm text-intently-slate leading-relaxed">
          <section>
            <h3 className="text-intently-ink font-medium mb-1">What a situation is</h3>
            <p>
              Shoppers don’t search with keywords — they arrive with a <em>moment</em>: “a friend’s wedding in July”,
              “the school run”, “a weekend in the mountains”. A <strong>situation</strong> is Intently’s model of one
              such moment: a set of <strong>soft weights</strong> describing what people typically wear for it.
            </p>
          </section>

          <section>
            <h3 className="text-intently-ink font-medium mb-1">How they work</h3>
            <p>
              When a shopper’s message matches a situation (by its name or keywords), discovery <strong>re-orders</strong> the
              catalogue toward that situation’s emphasis. Two layers of control:
            </p>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li><strong>Importance</strong> — how much each signal (formality, occasion, garment, style, season, material) counts.</li>
              <li><strong>Emphasis</strong> — where the situation sits on those signals: the formality target and the per-garment lean.</li>
            </ul>
            <p className="mt-1">
              Crucially, situations <strong>never exclude</strong>. A de-emphasised product still appears, only lower.
              Hard exclusions belong to the shopper alone (“nothing floral”). Each situation has its own
              <strong> on/off switch</strong> (the coloured dot on its chip) — only active situations bias live discovery,
              and any one query matches at most one situation.
            </p>
          </section>

          <section>
            <h3 className="text-intently-ink font-medium mb-1">Why they matter (customer value)</h3>
            <ul className="list-disc list-inside space-y-1">
              <li><strong>Relevance without rules</strong> — the shortlist reflects how people actually dress for the moment, without anyone writing brittle if-then rules.</li>
              <li><strong>Merchandising control</strong> — you steer what Intently leans toward per situation, and see the effect live before it ships.</li>
              <li><strong>Gap radar</strong> — the coverage score shows when the catalogue under-serves a situation your shoppers care about: a buying signal.</li>
              <li><strong>Store fit</strong> — every store’s moments differ; custom situations let you model yours (“festival”, “boardroom”, “après-ski”).</li>
            </ul>
          </section>

          <section>
            <h3 className="text-intently-ink font-medium mb-1">Making a good situation — a recipe</h3>
            <ol className="list-decimal list-inside space-y-1">
              <li><strong>Name the moment, not the product.</strong> “School run”, not “comfy trousers”. The situation describes the shopper’s life, discovery picks the products.</li>
              <li><strong>Add the words shoppers actually type</strong> as match keywords — listen to real queries (“drop-off”, “practical”, “quick errands”).</li>
              <li><strong>Set the formality target first.</strong> It anchors everything: school run ≈ 1.5–2, office ≈ 3, gala ≈ 5.</li>
              <li><strong>Raise importance only for signals that truly define the moment.</strong> A gala is about formality + material; a hike is about garment + season. Leave the rest mid/low — flat 100s everywhere means nothing stands out.</li>
              <li><strong>Lean garments gently.</strong> 0.7–0.9 for what the moment calls for, 0.2–0.3 for what it rarely does. Avoid 0 unless you’re confident — remember it still shows, just lower.</li>
              <li><strong>Watch the live ranking as you tune.</strong> The top 5 should look like what you’d expect a stylist to pull. If the coverage score stays red, the catalogue — not the tuning — is the gap.</li>
              <li><strong>Save, then test in the Model bench</strong> with a real shopper phrase to see the end-to-end answer.</li>
            </ol>
          </section>

          <section>
            <h3 className="text-intently-ink font-medium mb-1">Good to know</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>Edits to built-in situations save as <em>overrides</em> — Revert brings the original back.</li>
              <li>Custom situations (marked ·custom) can be deleted; built-ins cannot.</li>
              <li>A new situation is a <em>draft</em> until you press “Save new situation” — nothing ships by accident.</li>
            </ul>
          </section>
        </div>

        <div className="mt-5 text-right">
          <button onClick={onClose} className="text-sm bg-intently-ink text-white px-4 py-2 rounded hover:bg-intently-slate">Got it</button>
        </div>
      </div>
    </div>
  )
}
