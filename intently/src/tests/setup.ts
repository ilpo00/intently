// Jest setup — runs once per test file, after jsdom is ready.
// Registers @testing-library matchers and polyfills browser APIs
// that jsdom doesn't provide (IntersectionObserver, ResizeObserver, scroll).

import '@testing-library/jest-dom'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Hermeticity: route tests exercise the real /api/discover path, which emits
// analytics events. Point the sink at a per-run temp dir so the suite never
// writes into (or reads from) the developer's real .enrichment/events.
process.env.INTENTLY_EVENTS_DIR ??= mkdtempSync(join(tmpdir(), 'intently-events-'))

// ── IntersectionObserver polyfill ────────────────────────────
// useRiverReveal creates one per section. jsdom lacks it.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
  root = null
  rootMargin = ''
  thresholds: number[] = []
}
;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IntersectionObserverStub

// ── ResizeObserver polyfill ──────────────────────────────────
// Generic polyfill — jsdom doesn't ship ResizeObserver; any
// component that observes element size needs this stub.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub

// ── Scroll helpers jsdom doesn't implement ───────────────────
// Guard against non-jsdom (node) environments where Element/window
// are not defined — route handler tests opt into `@jest-environment node`.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {}
}
if (typeof window !== 'undefined' && !window.scrollTo) {
  // Signature overload: jsdom doesn't implement scrollTo.
  ;(window as unknown as { scrollTo: (...args: unknown[]) => void }).scrollTo = () => {}
}

// ── Reset global mutable state between tests ─────────────────
// The Zustand store is a singleton — reset it per test so cart/messages
// don't leak. localStorage also needs to be cleared.
afterEach(() => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.clear()
  } catch {
    /* jsdom storage not always writable */
  }
})
