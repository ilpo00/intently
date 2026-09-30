'use client'

// ─────────────────────────────────────────────────────────────────
// Reset the demo to a known state.
//
// Two-stage on purpose: pick what to clear, then type RESET. The tiers are
// ordered by how expensive they are to undo, and each says so in plain words
// — "you will have to re-run enrichment (~15 min and real spend)" is the fact
// a PM needs BEFORE clicking, not after.
//
// Nothing is preselected. The destructive tiers are visually distinct from
// the cheap one so a hurried click before a demo can't take the expensive
// path by accident.
// ─────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Target = 'demoState' | 'enriched' | 'analytics'

const TIERS: { key: Target; label: string; detail: string; cost: string; severe: boolean }[] = [
  {
    key: 'demoState',
    label: 'PM tuning',
    detail: 'Situations, model configuration, curated attributes, and the needs-attention queue return to the shipped defaults.',
    cost: 'Cheap to undo — just re-tune.',
    severe: false,
  },
  {
    key: 'enriched',
    label: 'Vision enrichment output',
    detail: 'Every attribute read from a product photo is deleted. The Vision and Catalogue pages go empty until you run enrichment again.',
    cost: 'Undo means re-running the batch: ~15 minutes and real model spend for a full catalogue.',
    severe: true,
  },
  {
    key: 'analytics',
    label: 'Analytics history',
    detail: 'All recorded turns, cart adds, and orders — the funnel, conversation health, and token spend history.',
    cost: 'Cannot be undone. Past events are not recoverable.',
    severe: true,
  },
]

// Public demo: there is nothing shared a visitor may clear. The panel becomes
// one action — drop the changes I made in this session.
function SessionResetPanel() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const run = async () => {
    setBusy(true); setNote(null)
    try {
      const res = await fetch('/api/admin/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'RESET', targets: ['demoState'] }),
      })
      setNote(res.ok ? 'Your changes are gone — the Studio is back to how you found it.' : `Could not reset (${res.status}).`)
      if (res.ok) router.refresh()
    } catch {
      setNote('Network error while resetting.')
    } finally { setBusy(false) }
  }
  return (
    <section className="border border-intently-cloud rounded-lg p-5">
      <h2 className="font-sans text-lg text-intently-ink mb-1">Start over</h2>
      <p className="text-sm text-intently-pebble leading-relaxed mb-4 max-w-2xl">
        Discard everything you changed in this session — situations, configuration, curated attributes and the
        attention queue. Only your own changes are affected; nothing here is shared with other visitors.
      </p>
      <button
        onClick={run}
        disabled={busy}
        className="text-xs px-3 py-1.5 rounded border border-intently-cloud text-intently-ink hover:border-intently-pebble disabled:opacity-40">
        {busy ? 'Resetting…' : 'Discard my changes'}
      </button>
      {note && <p role="status" className="text-xs text-intently-moss mt-3">{note}</p>}
    </section>
  )
}

export default function ResetPanel({ publicDemo = false }: { publicDemo?: boolean }) {
  if (publicDemo) return <SessionResetPanel />
  return <FullResetPanel />
}

function FullResetPanel() {
  const router = useRouter()
  const [picked, setPicked] = useState<Target[]>([])
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; cleared: string[]; failed: { target: string; error: string }[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggle = (t: Target) =>
    setPicked(p => (p.includes(t) ? p.filter(x => x !== t) : [...p, t]))

  const armed = picked.length > 0 && confirm.trim() === 'RESET'

  const run = async () => {
    setBusy(true); setError(null); setResult(null)
    try {
      const res = await fetch('/api/admin/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targets: picked, confirm: 'RESET' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok && !data.cleared) {
        setError(data.error ?? `reset failed (${res.status})`)
      } else {
        setResult(data)
        setPicked([]); setConfirm('')
        router.refresh()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error during reset')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="border border-intently-cloud rounded-lg p-5">
      <h2 className="font-sans text-lg text-intently-ink mb-1">Reset the demo</h2>
      <p className="text-sm text-intently-pebble leading-relaxed mb-4 max-w-2xl">
        Put the Studio back to a known state so you can run a demo from the beginning. Choose what to clear —
        nothing is selected by default, and nothing happens until you type the confirmation.
      </p>

      <div className="space-y-2 mb-4">
        {TIERS.map(t => {
          const on = picked.includes(t.key)
          return (
            <label key={t.key}
              className={`flex gap-3 items-start p-3 rounded border cursor-pointer transition-colors ${
                on
                  ? t.severe ? 'border-red-400 bg-red-50/60' : 'border-intently-ink bg-intently-paper'
                  : 'border-intently-cloud hover:border-intently-pebble'
              }`}>
              <input type="checkbox" checked={on} onChange={() => toggle(t.key)} className="mt-0.5" />
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-sm text-intently-ink font-medium">{t.label}</span>
                  {t.severe && (
                    <span className="text-[10px] uppercase tracking-wider text-red-700 bg-red-100 px-1.5 py-0.5 rounded">
                      expensive to undo
                    </span>
                  )}
                </span>
                <span className="block text-xs text-intently-pebble mt-1 leading-relaxed">{t.detail}</span>
                <span className={`block text-xs mt-1 ${t.severe ? 'text-red-700' : 'text-intently-pebble'}`}>{t.cost}</span>
              </span>
            </label>
          )
        })}
      </div>

      {picked.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <label className="text-xs text-intently-slate">
            Type <code className="font-mono bg-intently-paper px-1.5 py-0.5 rounded">RESET</code> to confirm
          </label>
          <input
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="RESET"
            aria-label="Type RESET to confirm"
            className="text-sm font-mono border border-intently-cloud rounded px-2 py-1 w-32 focus:outline-none focus:border-intently-ink"
          />
          <button
            onClick={run}
            disabled={!armed || busy}
            className="text-xs px-3 py-1.5 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {busy ? 'Clearing…' : `Clear ${picked.length} selected`}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {result && (
        <div className="text-xs mt-2">
          {result.cleared.length > 0 && (
            <p className="text-intently-moss">Cleared: {result.cleared.join(' · ')}</p>
          )}
          {result.failed.length > 0 && (
            <p className="text-red-600 mt-1">
              Failed: {result.failed.map(f => `${f.target} (${f.error})`).join(' · ')}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
