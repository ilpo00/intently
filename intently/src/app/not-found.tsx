// ─────────────────────────────────────────────
// 404 — Not Found
// Keeps the Intently aesthetic even on error pages.
// ─────────────────────────────────────────────

import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <div className="w-1.5 h-1.5 rounded-full bg-intently-stone mx-auto mb-8" />
      <h1 className="font-display text-4xl text-intently-ink mb-3">
        Nothing here
      </h1>
      <p className="text-intently-pebble text-sm max-w-xs leading-relaxed mb-10">
        This page doesn&apos;t exist — but the piece you&apos;re looking for might.
      </p>
      <Link
        href="/"
        className="text-intently-pebble text-sm underline underline-offset-4 hover:text-intently-slate transition-colors"
      >
        ← Back to Intently
      </Link>
    </main>
  )
}
