// ─────────────────────────────────────────────────────────────────
// Intently · /admin layout (gate + nav shell)
//
// Server component. Every /admin/* page renders inside this layout,
// which means:
//
//   1. The admin gate runs once per request via `requireAdmin()` —
//      see src/lib/auth/admin-guard.ts. Pages no longer need their
//      own auth gate.
//
//   2. The wordmark + nav shell is consistent. Previous standalone
//      admin pages (e.g. /admin/analytics/chips) baked their own
//      wordmark and padding; they now drop those and inherit from
//      here.
//
// Nav strategy: every planned admin section appears in the nav.
// Items not yet shipped render as plain dimmed text rather than
// links — clearly communicates "exists in the plan, not built yet"
// without 404s. To enable a section, set `href` on its entry below.
//
// See /Users/ilmariv/.claude/plans/composed-herding-glacier.md for
// the full admin panel plan, including Medusa-zone surfaces that
// will deliberately never be built here.
// ─────────────────────────────────────────────────────────────────

import Link from 'next/link'
import type { ReactNode } from 'react'

import { requireAdmin } from '@/lib/auth/admin-guard'

import AdminNav from './AdminNav'

export const metadata = { title: 'Intently admin' }

export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  // Gate. Throws notFound() (404) if not allowlisted AND the gate is
  // enabled. Bypassed in local mode and when ADMIN_AUTH_ENABLED !== 'true'
  // — see src/lib/auth/admin-allowlist.ts for the env contract.
  await requireAdmin()

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-intently-cloud">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <Link href="/admin/enrichment/studio" className="flex items-center gap-3 group w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-intently-moss" />
            <span className="text-xs tracking-[0.3em] text-intently-pebble font-sans uppercase group-hover:text-intently-ink transition-colors">
              intently · admin
            </span>
          </Link>
        </div>
        <AdminNav />
      </header>
      <main className="max-w-6xl mx-auto px-6 py-12">{children}</main>
    </div>
  )
}
