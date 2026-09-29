// ─────────────────────────────────────────────────────────────────
// Intently · Admin RangePicker
//
// Date-range selector shared by every admin analytics page. Lifted
// from /admin/analytics/chips/page.tsx (the original; that page is
// now the template referenced in docs/roadmap.md for future
// analytics surfaces — recommendation conversion, session funnel,
// AI telemetry).
//
// Pure presentational: links only, no client interactivity. Lives
// inside the unified admin shell at /admin/* so the visual language
// is consistent across pages.
//
// Constants (RANGES, RangeKey) and helpers (sinceFor, parseRange)
// are exported alongside the component so analytics pages can
// resolve a `since` ISO timestamp from the URL `?range=` param
// without duplicating the table.
// ─────────────────────────────────────────────────────────────────

import Link from 'next/link'

export const RANGES = {
  '24h': { label: 'Last 24h',     days: 1 as number | null },
  '7d':  { label: 'Last 7 days',  days: 7 as number | null },
  '30d': { label: 'Last 30 days', days: 30 as number | null },
  '90d': { label: 'Last 90 days', days: 90 as number | null },
  'all': { label: 'All time',     days: null as number | null },
} as const

export type RangeKey = keyof typeof RANGES

/**
 * Resolve a `since` ISO timestamp for the given range key. `all`
 * returns the Unix epoch so callers can pass it directly to a
 * Supabase `.gte('created_at', since)` filter without conditional
 * branching.
 */
export function sinceFor(range: RangeKey): string {
  const days = RANGES[range].days
  if (days === null) return '1970-01-01T00:00:00Z'
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString()
}

/**
 * Parse a `?range=` query value. Falls back to the project default
 * (7 days) on missing or unknown input.
 */
export function parseRange(raw: string | undefined): RangeKey {
  if (raw && raw in RANGES) return raw as RangeKey
  return '7d'
}

export function RangePicker({
  basePath,
  current,
}: {
  /** Page path to link back to, e.g. "/admin/analytics/chips". */
  basePath: string
  /** Currently selected range. */
  current: RangeKey
}) {
  return (
    <nav className="flex flex-wrap gap-2 mb-10 text-sm font-sans">
      {(Object.keys(RANGES) as RangeKey[]).map(key => {
        const selected = current === key
        return (
          <Link
            key={key}
            href={`${basePath}?range=${key}`}
            className={
              selected
                ? 'px-3 py-1.5 rounded-full bg-intently-ink text-white'
                : 'px-3 py-1.5 rounded-full border border-intently-cloud text-intently-slate hover:bg-intently-cloud hover:text-intently-ink transition-colors'
            }
          >
            {RANGES[key].label}
          </Link>
        )
      })}
    </nav>
  )
}
