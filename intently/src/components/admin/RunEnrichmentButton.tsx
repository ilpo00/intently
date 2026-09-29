'use client'

// ─────────────────────────────────────────────────────────────────
// Run the vision-enrichment batch from the Studio (Vision + Catalogue pages).
//
// The server analyses ONE CHUNK per request and returns a cursor; this
// component is the loop that keeps calling until the run reports it is no
// longer running. That design is what lets a ~15-minute catalogue batch run
// on serverless, where any single request is capped at 60s.
//
// Because the loop lives in the browser, closing the tab pauses the run — it
// does not lose it. Re-opening and pressing Resume continues from the cursor,
// and already-enriched products are never re-billed.
// ─────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import type { VisionRun, VisionScope } from '@/types/vision'
import { EMPTY_RUN } from '@/types/vision'

/** Assumed Haiku 4.5 list pricing — mirrors the server's RATE. Labelled as an
 *  estimate wherever it is shown; tokens are the hard number. */
const RATE = { in: 1.0 / 1e6, out: 5.0 / 1e6 }

function costOf(run: VisionRun): number {
  return run.tokens.input * RATE.in + run.tokens.output * RATE.out
}

/** ~2.6s per product on the throttled catalogue path, ~2s on the sample. */
function etaMinutes(run: VisionRun): number {
  const left = Math.max(0, run.total - run.cursor)
  return Math.ceil((left * (run.scope === 'catalog' ? 2.6 : 2)) / 60)
}

export default function RunEnrichmentButton({ scope = 'sample' }: { scope?: VisionScope }) {
  const router = useRouter()
  const [run, setRun] = useState<VisionRun>(EMPTY_RUN)
  const [looping, setLooping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)
  // Set false to make the in-flight loop stop after the current chunk.
  const active = useRef(false)

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/admin/vision-enrich')
        if (res.ok) setRun(await res.json())
      } catch { /* transient — keep defaults */ }
    }, 0)
    return () => clearTimeout(t)
  }, [])

  // Stop the loop if the component goes away (navigation away from the page).
  useEffect(() => () => { active.current = false }, [])

  const loop = useCallback(async (restart: boolean) => {
    setError(null)
    setShowLog(true)
    setLooping(true)
    active.current = true
    let first = true
    try {
      // Each pass is one chunk; the server decides how much fits in its budget.
      for (;;) {
        if (!active.current) break
        const res = await fetch('/api/admin/vision-enrich', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope, restart: first && restart }),
        })
        first = false
        const next: VisionRun & { error?: string } = await res.json().catch(() => ({ ...EMPTY_RUN }))
        if (!res.ok) {
          setError(next.error ?? `enrichment failed (${res.status})`)
          if (next.state) setRun(next)
          break
        }
        setRun(next)
        if (next.state !== 'running') break
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error while enriching')
    } finally {
      active.current = false
      setLooping(false)
      router.refresh() // pull whatever was enriched into the page
    }
  }, [scope, router])

  const stop = () => { active.current = false }

  const pct = run.total ? Math.round((run.cursor / run.total) * 100) : 0
  const partial = !looping && run.cursor > 0 && run.cursor < run.total

  return (
    <div className="inline-flex flex-col items-end gap-1.5 max-w-md">
      <div className="flex items-center gap-2">
        {!looping && run.state === 'done' && run.ok > 0 && (
          <span className="text-xs text-intently-moss">
            {run.ok} enriched{run.failed ? ` · ${run.failed} failed` : ''}
          </span>
        )}
        {!looping && run.state === 'failed' && <span className="text-xs text-red-600">last run failed</span>}
        {run.tail.length > 0 && (
          <button onClick={() => setShowLog(s => !s)}
            className="text-xs text-intently-pebble hover:text-intently-ink underline underline-offset-2">
            {showLog ? 'hide log' : 'show log'}
          </button>
        )}
        {looping ? (
          <button onClick={stop}
            className="text-xs px-3 py-1.5 rounded border border-intently-cloud text-intently-slate hover:border-red-400 hover:text-red-600 transition-colors">
            Stop after this batch
          </button>
        ) : (
          <button onClick={() => loop(!partial)}
            className="text-xs px-3 py-1.5 rounded border border-intently-cloud text-intently-slate hover:border-intently-ink hover:text-intently-ink transition-colors">
            {partial ? `Resume (${run.cursor}/${run.total})` : 'Run vision enrichment'}
          </button>
        )}
      </div>

      {(looping || partial) && (
        <div className="w-full">
          <div className="h-1 w-full bg-intently-cloud/60 rounded overflow-hidden">
            <div className="h-full bg-intently-moss transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex justify-between text-[11px] text-intently-pebble mt-1">
            <span>{run.cursor}/{run.total} products · ~${costOf(run).toFixed(3)} so far</span>
            <span>{looping ? `~${etaMinutes(run)} min left` : 'paused'}</span>
          </div>
        </div>
      )}

      {looping && (
        <p className="text-[11px] text-intently-pebble text-right">
          Keep this tab open — closing it pauses the run; nothing already enriched is lost or re-charged.
        </p>
      )}

      {error && <p className="text-xs text-red-600 text-right">{error}</p>}

      {showLog && run.tail.length > 0 && (
        <pre className="text-[11px] bg-intently-ink text-intently-cloud rounded p-2 w-full max-h-40 overflow-auto text-left">
          {run.tail.join('\n')}
        </pre>
      )}
    </div>
  )
}
