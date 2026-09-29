// Shared motion helpers. See docs/design.md § Motion & scroll.
//
// Read at call time (not module load) — the system setting can flip while
// the page is open and we want every animation to respect the current value.
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}
