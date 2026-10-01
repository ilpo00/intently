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
import { isPublicDemo } from '@/lib/public-demo'
import { sharedStoreStatus } from '@/lib/discovery/guardrails-shared'

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
  // Public demo: a visitor's changes live in the shared store. If it is down,
  // tell them before they edit rather than after a failed save.
  const sandboxDown = isPublicDemo() && (await sharedStoreStatus()) === 'unavailable'

  return (
    <div className="min-h-screen bg-white">
      {isPublicDemo() && (
        // Public demo: say plainly what this Studio is — a sandbox. See
        // lib/public-demo.ts for what is enforced behind this message.
        <div role="note" className="bg-intently-ink text-white">
          <div className="max-w-6xl mx-auto px-6 py-2.5 text-xs leading-relaxed flex flex-wrap gap-x-6 gap-y-1 items-baseline">
            <span className="font-medium tracking-wide uppercase">Public demo</span>
            <span className="opacity-90">
              This is the real Studio. Your changes are saved to your browser session only — nobody else sees them, and they expire after 24 hours.
              Actions that would spend AI budget (vision enrichment, re-embedding, live model calls) are switched off; the model bench shows recorded results.
              Intently is a prototype, so results may vary.
            </span>
            <Link href="/" className="underline underline-offset-2 opacity-90 hover:opacity-100 whitespace-nowrap">← Back to the shopper view</Link>
          </div>
          {sandboxDown && (
            <div role="alert" className="bg-red-700 text-white">
              <div className="max-w-6xl mx-auto px-6 py-2 text-xs">
                The session store is unavailable right now, so changes you make here cannot be saved. You can still look around.
              </div>
            </div>
          )}
        </div>
      )}
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
