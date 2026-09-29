// ─────────────────────────────────────────────────────────────────
// Intently · Enrichment — pure vector math
//
// Kept in its own file because:
//   1. It's easy to unit test without mocking I/O.
//   2. Both LocalJsonVectorStore (in-process) and the admin UI
//      (similarity-matrix view) reach for the same primitives.
//   3. It's the place a future contributor will look first when
//      asking "what does cosine actually do here?"
//
// Sentence-transformers produces L2-normalised vectors, so dot product
// equals cosine similarity for them. We don't assume normalisation in
// these helpers — small cost, big robustness.
// ─────────────────────────────────────────────────────────────────

/**
 * Dot product of two equal-length vectors.
 * Throws on length mismatch — silent broadcasting hides bugs.
 */
export function dot(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`dot: length mismatch ${a.length} vs ${b.length}`)
  }
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

export function norm(v: number[]): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i] * v[i]
  return Math.sqrt(s)
}

/**
 * Cosine similarity in [-1, 1]. Returns 0 if either vector is zero
 * — undefined mathematically, but treating it as "no similarity"
 * is the sane prototype default.
 */
export function cosine(a: number[], b: number[]): number {
  const na = norm(a)
  const nb = norm(b)
  if (na === 0 || nb === 0) return 0
  return dot(a, b) / (na * nb)
}

/**
 * Unit-normalise in place would be cheaper but the surprise factor is
 * too high. Return a new array.
 */
export function normalise(v: number[]): number[] {
  const n = norm(v)
  if (n === 0) return v.slice()
  const out = new Array<number>(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n
  return out
}
