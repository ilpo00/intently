// ─────────────────────────────────────────────
// loading.tsx — Next.js App Router loading UI
//
// Shown while server components are streaming.
// Intently is mostly client-side, so this appears
// briefly on first load before hydration.
// Kept minimal — just the wordmark breathing.
// ─────────────────────────────────────────────

export default function Loading() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center">
      <div className="flex flex-col items-center gap-3 animate-pulse-soft opacity-50">
        <div className="w-1.5 h-1.5 rounded-full bg-intently-stone" />
        <span className="text-[10px] tracking-[0.35em] text-intently-stone font-sans uppercase">
          intently
        </span>
      </div>
    </main>
  )
}
