// ─────────────────────────────────────────────────────────────────
// Intently · id helpers
//
// Sortable-by-time, opaque ids. Format: `${prefix}_${ts36}_${rand36}`.
// - ts36   = Date.now() in base36 (ascending, lexicographic-sortable)
// - rand36 = 8 random base36 chars (~41 bits) to disambiguate same-ms calls
//
// Not a strict ulid — strict ulid is overkill for v0.1.x; we just need a
// short, stable, sortable id for orders. Easy to upgrade to `ulid` later
// without a schema change since the column is `text` either way.
// ─────────────────────────────────────────────────────────────────

function rand36(length: number): string {
  // crypto.getRandomValues is available in browsers and Node ≥ 19,
  // and inside jsdom. Falls back to Math.random for any host that
  // somehow lacks it (we don't ship to one, but defensive).
  const cryptoRef =
    typeof globalThis !== 'undefined' && 'crypto' in globalThis
      ? (globalThis as { crypto?: Crypto }).crypto
      : undefined
  if (cryptoRef && typeof cryptoRef.getRandomValues === 'function') {
    const bytes = new Uint8Array(length)
    cryptoRef.getRandomValues(bytes)
    let out = ''
    for (let i = 0; i < length; i++) {
      // 36 = 0-9a-z. Map each byte mod 36 for a uniform-ish distribution
      // across base36 chars; bias is negligible at this scale.
      out += (bytes[i] % 36).toString(36)
    }
    return out
  }
  // Fallback: not cryptographically random; fine for ids that aren't
  // a security boundary.
  return Math.random().toString(36).slice(2, 2 + length).padEnd(length, '0')
}

/**
 * Generate a sortable id with a kind-prefix. Use the kind-specific
 * helpers below rather than calling this directly.
 */
export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${rand36(8)}`
}

/** Order id for `orders.id`. Format: `ord_<ts36>_<rand36>`. */
export function newOrderId(): string {
  return newId('ord')
}
