'use client'

// ─────────────────────────────────────────────────────────────────
// Needs-attention work queue — a worklist over the flagged products.
// Filter by reason + triage status; act per product: Fix (→ the curate editor),
// Dismiss (not an issue), Resolve (handled). Triage persists via
// /api/enrichment/attention; reasons are recomputed server-side each load.
// ─────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react'
import Link from 'next/link'

import type { AttentionEntry, AttentionStatus } from '@/lib/enrichment/attention-state'

export interface QueueRow {
  id: string; image: string; garmentType: string
  primaryColour: string; pattern: string; formality: number; situationFit: number
  reasons: { id: string; label: string; hint: string; outcome: string }[]
}
type StatusFilter = AttentionStatus | 'all'

const STATUS_META: Record<AttentionStatus, { label: string; chip: string; dot: string }> = {
  open: { label: 'Open', chip: 'text-amber-700 bg-amber-50 border-amber-200', dot: 'bg-amber-500' },
  dismissed: { label: 'Dismissed', chip: 'text-intently-pebble bg-intently-paper border-intently-cloud', dot: 'bg-intently-stone' },
  resolved: { label: 'Resolved', chip: 'text-intently-moss bg-intently-moss/5 border-intently-moss/30', dot: 'bg-intently-moss' },
}

export default function AttentionClient({
  rows, reasonMeta, state: initialState, hasCatalog,
}: {
  rows: QueueRow[]
  reasonMeta: { id: string; label: string }[]
  state: Record<string, AttentionEntry>
  hasCatalog: boolean
}) {
  const [state, setState] = useState(initialState)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [reasonFilter, setReasonFilter] = useState<string>('all')
  const [busy, setBusy] = useState<string | null>(null)

  const statusOf = (id: string): AttentionStatus => state[id]?.status ?? 'open'

  const counts = useMemo(() => {
    const c = { open: 0, dismissed: 0, resolved: 0 }
    for (const r of rows) c[statusOf(r.id)]++
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, state])

  const visible = useMemo(() => rows.filter(r => {
    if (statusFilter !== 'all' && statusOf(r.id) !== statusFilter) return false
    if (reasonFilter !== 'all' && !r.reasons.some(x => x.id === reasonFilter)) return false
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, statusFilter, reasonFilter, state])

  async function setStatus(id: string, status: AttentionStatus) {
    setBusy(id)
    try {
      const res = await fetch('/api/enrichment/attention', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      if (res.ok) {
        const d = await res.json()
        setState(d.state ?? {})
      }
    } finally { setBusy(null) }
  }

  return (
    <div className="max-w-5xl">
      <Head openCount={counts.open} total={rows.length} />

      {!hasCatalog ? (
        <div className="border border-intently-cloud rounded-lg p-8 text-sm text-intently-pebble">
          No vision-enriched catalogue yet. Run vision enrichment from the Catalogue page to analyse every catalogue photo.
        </div>
      ) : rows.length === 0 ? (
        <div className="border border-intently-cloud rounded-lg p-8 text-sm text-intently-pebble">
          Nothing needs attention — every product is fully attributed and reachable by a situation.
        </div>
      ) : (
        <>
          {/* filters */}
          <div className="flex flex-col gap-3 mb-5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs uppercase tracking-wider text-intently-pebble mr-1">Status</span>
              {(['open', 'resolved', 'dismissed', 'all'] as StatusFilter[]).map(s => (
                <Chip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
                  {s === 'all' ? 'All' : STATUS_META[s].label}
                  {s !== 'all' && <span className="ml-1 font-mono text-[11px] opacity-70">{counts[s]}</span>}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs uppercase tracking-wider text-intently-pebble mr-1">Reason</span>
              <Chip active={reasonFilter === 'all'} onClick={() => setReasonFilter('all')}>All reasons</Chip>
              {reasonMeta.map(r => (
                <Chip key={r.id} active={reasonFilter === r.id} onClick={() => setReasonFilter(r.id)}>{r.label}</Chip>
              ))}
            </div>
          </div>

          <div className="text-xs uppercase tracking-wider text-intently-pebble mb-2">
            {visible.length} {visible.length === 1 ? 'product' : 'products'}
          </div>

          <ul className="space-y-2">
            {visible.map(r => {
              const st = statusOf(r.id)
              const entry = state[r.id]
              const isBusy = busy === r.id
              return (
                <li key={r.id} className="border border-intently-cloud rounded-lg p-3 flex items-start gap-3">
                  <Thumb src={r.image} title={r.garmentType} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-2">
                      <span className="text-sm text-intently-ink capitalize truncate">{r.garmentType}</span>
                      <span className={`inline-flex items-center gap-1 text-[11px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${STATUS_META[st].chip}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${STATUS_META[st].dot}`} />{STATUS_META[st].label}
                      </span>
                    </div>
                    <div className="text-xs text-intently-pebble font-mono mt-0.5">
                      {r.primaryColour} · {r.pattern} · f{r.formality} · fit {r.situationFit.toFixed(2)} · {r.id}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {r.reasons.map(x => (
                        <span key={x.id} title={`${x.hint} → ${x.outcome}`}
                          className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">
                          {x.label}
                        </span>
                      ))}
                    </div>
                    {entry?.note && <div className="text-xs text-intently-pebble mt-1.5 italic">“{entry.note}”</div>}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <Link href={`/admin/enrichment/studio?product=${encodeURIComponent(r.id)}#curate`}
                      className="text-xs bg-intently-ink text-white px-3 py-1.5 rounded hover:bg-intently-slate text-center w-24">
                      Fix →
                    </Link>
                    {st === 'open' ? (
                      <div className="flex gap-1.5">
                        <Action onClick={() => setStatus(r.id, 'resolved')} disabled={isBusy}>Resolve</Action>
                        <Action onClick={() => setStatus(r.id, 'dismissed')} disabled={isBusy}>Dismiss</Action>
                      </div>
                    ) : (
                      <Action onClick={() => setStatus(r.id, 'open')} disabled={isBusy}>Reopen</Action>
                    )}
                  </div>
                </li>
              )
            })}
            {visible.length === 0 && (
              <li className="text-xs text-intently-pebble py-6 text-center border border-intently-cloud rounded-lg">
                Nothing in this view. {statusFilter === 'open' ? 'The open queue is clear 🎉' : 'Try another filter.'}
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  )
}

function Head({ openCount, total }: { openCount: number; total: number }) {
  return (
    <header className="mb-6">
      <div className="flex items-center gap-3 mb-2">
        <h1 className="font-sans text-2xl font-light text-intently-ink">Needs attention</h1>
        {total > 0 && (
          <span className="text-[11px] uppercase tracking-wider bg-amber-100 text-amber-700 px-2 py-0.5 rounded">
            {openCount} open
          </span>
        )}
        <span className="ml-auto flex items-center gap-4">
          <Link href="/admin/enrichment/studio/catalog" className="text-xs text-intently-pebble hover:text-intently-ink underline underline-offset-4">catalogue →</Link>
          <Link href="/admin/enrichment/studio" className="text-xs text-intently-pebble hover:text-intently-ink underline underline-offset-4">← Studio</Link>
        </span>
      </div>
      <p className="text-intently-pebble text-sm leading-relaxed max-w-3xl">
        The products holding back discovery readiness, as a worklist. Each is here because a fixable
        attribute makes it hard to surface for a shopper’s situation. <strong className="text-intently-slate font-medium">Fix</strong> opens
        the curate editor; <strong className="text-intently-slate font-medium">Resolve</strong> / <strong className="text-intently-slate font-medium">Dismiss</strong> record
        your triage. A product leaves the open list automatically once its reason no longer matches.
      </p>
    </header>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
        active ? 'border-intently-ink bg-intently-ink text-white' : 'border-intently-cloud text-intently-slate hover:border-intently-pebble'
      }`}>
      {children}
    </button>
  )
}

function Action({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="text-xs border border-intently-cloud px-2.5 py-1.5 rounded text-intently-slate hover:border-intently-pebble disabled:opacity-40">
      {children}
    </button>
  )
}

function Thumb({ src, title }: { src?: string; title: string }) {
  const [broken, setBroken] = useState(false)
  return src && !broken ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" onError={() => setBroken(true)}
      className="w-14 h-14 object-cover rounded bg-intently-paper shrink-0" />
  ) : (
    <div className="w-14 h-14 rounded bg-intently-paper shrink-0 flex items-center justify-center text-intently-stone text-lg">
      {title.trim()[0]?.toUpperCase() ?? '·'}
    </div>
  )
}
