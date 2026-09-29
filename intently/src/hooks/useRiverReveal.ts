// ─────────────────────────────────────────────
// useRiverReveal
//
// Marks a section visible when it enters the
// viewport. Also exports a helper to smoothly
// scroll TO a new section after it mounts —
// animating from the bottom of the previous
// section so content flows downward naturally.
// ─────────────────────────────────────────────

import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from '@/lib/motion'

export function useRiverReveal<T extends HTMLElement = HTMLElement>(threshold = 0.1) {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Mark immediately if already in viewport (e.g. after programmatic scroll)
    const rect = el.getBoundingClientRect()
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      el.classList.add('visible')
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [threshold])

  return ref
}

// Cubic ease-in-out — accelerates softly in, glides out softly. Used for
// section-to-section travel so the viewport never "jumps" between stops.
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

// rAF-driven scroll. We drive each frame by hand (two-arg `window.scrollTo`
// is spec-guaranteed instant) so the browser's own `scroll-behavior: smooth`
// can't fight our easing curve. Duration is tuned long enough to read as a
// glide rather than a jump, but short enough not to feel sluggish.
function animatedScrollTo(targetY: number, duration = 1100) {
  if (typeof window === 'undefined') return
  // Honour reduced-motion — jump straight to target.
  if (prefersReducedMotion()) {
    window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior })
    return
  }
  const startY = window.scrollY
  const delta = targetY - startY
  if (Math.abs(delta) < 2) {
    // Already there — snap without animating but still call through so
    // any listeners (and tests) see a scroll event.
    window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior })
    return
  }
  const startT = performance.now()
  function step(now: number) {
    const t = Math.min(1, (now - startT) / duration)
    const y = startY + delta * easeInOutCubic(t)
    // Explicit 'instant' keeps CSS scroll-behavior: smooth from interpolating
    // on top of our per-frame updates (which would fight the easing curve).
    window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior })
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

// Scroll a newly-mounted section into view after React has rendered it.
// Lands the section ~120px below the viewport top so the previous section
// is still partially visible — keeps the scroll feeling continuous rather
// than snapping. Delay is generous so the new section has faded in before
// the viewport moves.
export function scrollToSection(id: string, delay = 235) {
  setTimeout(() => {
    requestAnimationFrame(() => {
      const el = document.getElementById(id)
      if (!el) return
      const top = el.getBoundingClientRect().top + window.scrollY - 120
      animatedScrollTo(Math.max(0, top))
      setTimeout(() => el.classList.add('visible'), 900)
    })
  }, delay)
}
