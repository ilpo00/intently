// ─────────────────────────────────────────────────────────────────
// Pipeline status — the enrichment path from PIM to Discovery, visible on
// EVERY Studio page (rendered by the studio layout). Answers the morning
// question "15 new products just landed — what do I do?" with live counts,
// a state per stage, and the single next action.
//
//   PIM → Enrich (photos → attributes) → Index (attributes → vectors)
//       → Situations (tuned emphasis) → Discovery (live)
//
// Server component: reads the same sources the pages use. Each stage links
// to the page where its work happens.
// ─────────────────────────────────────────────────────────────────

import Link from 'next/link'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { getEnrichmentStatuses, getPimAdapter, getVectorStore } from '@/lib/enrichment'
import { loadMergedProfiles, loadActiveProfiles } from '@/lib/discovery/situation-overrides'

type StageState = 'done' | 'partial' | 'todo'

interface Stage {
  key: string
  title: string
  detail: string
  state: StageState
  href: string
  action?: string // what to do when not done
}

function visionEnrichedCount(): { enriched: number; hasCache: boolean } {
  for (const ver of ['v2', 'v1']) {
    try {
      const raw = JSON.parse(readFileSync(join(process.cwd(), `.enrichment/vision-${ver}.json`), 'utf8'))
      const records: { vision?: unknown }[] = raw.records ?? []
      return { enriched: records.filter(r => r.vision).length, hasCache: true }
    } catch { /* try next */ }
  }
  return { enriched: 0, hasCache: false }
}

export default async function PipelineStatus() {
  const pim = getPimAdapter()
  const [statuses, vectorCount] = await Promise.all([getEnrichmentStatuses(), getVectorStore().count()])
  const total = statuses.length
  const embedded = statuses.filter(s => s.hasVector).length
  const vision = visionEnrichedCount()
  const [allProfiles, activeProfiles] = await Promise.all([loadMergedProfiles(), loadActiveProfiles()])
  const allSituations = allProfiles.length
  const activeSituations = activeProfiles.length

  const stages: Stage[] = [
    {
      key: 'PIM',
      title: `${total} products`,
      detail: pim.sourceName,
      state: total > 0 ? 'done' : 'todo',
      href: '/admin/enrichment/studio/catalog',
      action: total === 0 ? 'connect a product source' : undefined,
    },
    {
      key: 'Enrich',
      title: vision.hasCache ? `${vision.enriched} enriched` : 'not run',
      detail: 'photos → attributes',
      state: !vision.hasCache ? 'todo' : vision.enriched >= total ? 'done' : 'partial',
      href: '/admin/enrichment/studio/vision',
      action: !vision.hasCache ? 'Run vision enrichment' : vision.enriched < total ? 'run for new products' : undefined,
    },
    {
      key: 'Index',
      title: `${embedded}/${total} indexed`,
      detail: 'searchable for discovery',
      state: embedded === 0 ? 'todo' : embedded < total ? 'partial' : 'done',
      href: '/admin/enrichment/studio',
      action: embedded < total ? 'Index products in the Cockpit' : undefined,
    },
    {
      key: 'Situations',
      title: `${activeSituations}/${allSituations} active`,
      detail: 'ranking emphasis',
      state: activeSituations > 0 ? 'done' : 'todo',
      href: '/admin/enrichment/studio/situations',
      action: activeSituations === 0 ? 'activate situations' : undefined,
    },
    {
      key: 'Discovery',
      title: embedded > 0 ? 'live' : 'waiting',
      detail: 'live shopper experience',
      state: embedded > 0 ? 'done' : 'todo',
      href: '/admin/enrichment/studio/models',
      action: embedded > 0 ? undefined : 'index products first',
    },
  ]

  const nextAction = stages.find(s => s.state !== 'done' && s.action)

  return (
    <div className="mb-6">
      <div className="flex items-stretch gap-1.5">
        {stages.map((s, i) => (
          <div key={s.key} className="flex items-stretch gap-1.5 flex-1 min-w-0">
            <Link href={s.href}
              className={`flex-1 min-w-0 rounded-lg border px-3 py-2 transition-colors hover:border-intently-ink ${
                s.state === 'done' ? 'border-emerald-200 bg-emerald-50/40'
                : s.state === 'partial' ? 'border-amber-300 bg-amber-50/60'
                : 'border-intently-cloud bg-intently-paper/40'
              }`}>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  s.state === 'done' ? 'bg-emerald-500' : s.state === 'partial' ? 'bg-amber-500' : 'bg-intently-stone'
                }`} />
                <span className="text-[11px] uppercase tracking-[0.15em] text-intently-pebble">{s.key}</span>
              </div>
              <div className="text-sm text-intently-ink font-medium truncate">{s.title}</div>
              <div className="text-xs text-intently-pebble truncate">{s.detail}</div>
            </Link>
            {i < stages.length - 1 && <div className="flex items-center text-intently-stone select-none">→</div>}
          </div>
        ))}
      </div>
      {nextAction && (
        <p className="text-xs text-amber-700 mt-1.5">
          Next: <Link href={nextAction.href} className="underline underline-offset-2 font-medium">{nextAction.action}</Link>
          {' '}({nextAction.key} stage)
        </p>
      )}
    </div>
  )
}
