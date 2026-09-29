'use client'

// ─────────────────────────────────────────────
// EmbeddedNav (plugin mode only)
//
// A thin top bar for the discovery plugin: clear, session-aware navigation
// back to the host storefront and to the SHARED cart, with a live count. Raw
// <a> tags (not next/link) so they cross out of the /discover zone to the
// storefront's own routes.
// ─────────────────────────────────────────────

import { useEffect, useState } from 'react'
import { BASE_PATH } from '@/lib/embed'

export function EmbeddedNav() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`${BASE_PATH}/api/cart`)
      .then((r) => r.json())
      .then((d: { count?: number }) => {
        if (alive) setCount(d.count ?? 0)
      })
      .catch(() => {})

    const onUpdate = (e: Event) => {
      const c = (e as CustomEvent).detail?.count
      if (typeof c === 'number') setCount(c)
    }
    window.addEventListener('intently-cart-updated', onUpdate)
    return () => {
      alive = false
      window.removeEventListener('intently-cart-updated', onUpdate)
    }
  }, [])

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between h-12 px-4 bg-white/90 backdrop-blur border-b border-intently-cloud text-sm font-sans">
      <a href="/" className="text-intently-ink hover:text-intently-slate">
        ← Back to store
      </a>
      <span className="font-display text-intently-ink">Shop by situation</span>
      <a href="/cart" className="text-intently-ink hover:text-intently-slate">
        Cart{count != null ? ` (${count})` : ''}
      </a>
    </div>
  )
}
