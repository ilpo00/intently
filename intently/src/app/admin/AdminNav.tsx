'use client'

// ─────────────────────────────────────────────────────────────────
// Admin navigation.
//   Row 1 (main):  Studio · Analytics
//   Row 2 (tools): Models · Configuration — the surfaces OUTSIDE the pipeline.
// The pipeline surfaces (Cockpit, Catalogue, Enrichment, Situations) are
// navigated via the PipelineStatus stepper on every Studio page — so the old
// pipeline nav row was redundant and is gone. Needs-attention stays reachable
// from the Cockpit's catalogue-health link.
// ─────────────────────────────────────────────────────────────────

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const STUDIO_ROOT = '/admin/enrichment/studio'

// Testing & configuration — outside the enrichment pipeline.
const TOOLS: { label: string; href: string }[] = [
  { label: 'Models', href: `${STUDIO_ROOT}/models` },
  { label: 'Configuration', href: `${STUDIO_ROOT}/config` },
]

export default function AdminNav() {
  const path = usePathname()
  // Everything under /admin/enrichment is the Studio (incl. the bookmarkable
  // vector-detail page /admin/enrichment/[id]).
  const inStudio = path.startsWith('/admin/enrichment')

  const toolActive = (href: string) =>
    href === STUDIO_ROOT
      ? path === STUDIO_ROOT || /^\/admin\/enrichment\/[^/]+$/.test(path) // cockpit + vector detail
      : path.startsWith(href)

  return (
    <div className="max-w-6xl mx-auto px-6">
      <nav className="flex items-center gap-8 text-sm font-sans pb-2">
        <Link href={STUDIO_ROOT}
          className={inStudio ? 'text-intently-ink font-medium' : 'text-intently-slate hover:text-intently-ink transition-colors'}>
          Studio
        </Link>
        <Link href="/admin/analytics"
          className={path.startsWith('/admin/analytics') ? 'text-intently-ink font-medium' : 'text-intently-slate hover:text-intently-ink transition-colors'}>
          Analytics
        </Link>
      </nav>
      {inStudio && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pb-4 text-xs font-sans border-t border-intently-cloud/60 pt-2">
          <span className="text-[11px] uppercase tracking-wider text-intently-stone select-none" title="Testing and configuration — outside the enrichment pipeline (navigate the pipeline via the stage stepper above)">tools</span>
          {TOOLS.map(t => (
            <Link key={t.href} href={t.href}
              className={toolActive(t.href)
                ? 'text-intently-ink font-medium'
                : 'text-intently-pebble hover:text-intently-ink transition-colors'}>
              {t.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
