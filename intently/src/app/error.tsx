'use client'

// ─────────────────────────────────────────────
// error.tsx — Next.js App Router error boundary
//
// Catches unexpected render errors anywhere in
// the app and shows a graceful fallback rather
// than a blank screen. The reset() function
// lets the user try re-rendering without a
// full page reload.
// ─────────────────────────────────────────────

import { useEffect } from 'react'

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function Error({ error, reset }: ErrorProps) {
  // Log to console in development — in production
  // you'd send this to an error tracking service (Sentry etc.)
  useEffect(() => {
    console.error('[Intently] Render error:', error)
  }, [error])

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <div className="w-1.5 h-1.5 rounded-full bg-intently-stone mx-auto mb-8" />

      <h1 className="font-display text-3xl text-intently-ink mb-3">
        Something went wrong
      </h1>
      <p className="text-intently-pebble text-sm max-w-xs leading-relaxed mb-8">
        The river hit a rock. This has been noted —
        try again and it should clear.
      </p>

      <div className="flex gap-3">
        <button
          onClick={reset}
          className="
            px-5 py-2.5 rounded-xl
            bg-intently-ink text-white text-sm font-sans
            hover:bg-intently-slate transition-colors
          "
        >
          Try again
        </button>
        <a
          href="/"
          className="
            px-5 py-2.5 rounded-xl
            border border-intently-cloud text-intently-pebble text-sm font-sans
            hover:bg-intently-paper transition-colors
          "
        >
          Start over
        </a>
      </div>

      {/* Show digest in development for easier debugging */}
      {process.env.NODE_ENV === 'development' && error.digest && (
        <p className="text-intently-stone text-xs mt-8 font-mono">
          {error.digest}
        </p>
      )}
    </main>
  )
}
