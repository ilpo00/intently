// ─────────────────────────────────────────────
// Tests: getProductByArticleNo (src/lib/data.ts)
//
// The enrichment bridge that lets a Medusa-sourced record (`k<n>`) resolve back
// to OUR rich product (`cat-<n>` / catalogue id) by the shared H&M article
// number — so discovery reasons over the vision attributes regardless of which
// source the vector came from. Runs over the default catalogue (no vision flag,
// no Medusa, no embedder).
// ─────────────────────────────────────────────

import { getAllProducts, getProductById, getProductByArticleNo } from '@/lib/data'

describe('getProductByArticleNo', () => {
  const sample = getAllProducts()[0]

  it('finds a product by exact id (its own article number)', () => {
    expect(getProductByArticleNo(sample.id)?.id).toBe(sample.id)
  })

  it('matches across id-prefix conventions (k<n> ↔ cat-<n>) by the digits', () => {
    const digits = sample.id.match(/\d+/)?.[0]
    expect(digits).toBeTruthy()
    // A differently-prefixed id with the SAME article number resolves to the
    // same product — this is exactly the Medusa `k<n>` → catalogue lookup.
    expect(getProductByArticleNo(`k${digits}`)?.id).toBe(sample.id)
    expect(getProductByArticleNo(`whatever-${digits}`)?.id).toBe(sample.id)
  })

  it('returns undefined for an article number we do not carry', () => {
    expect(getProductByArticleNo('k0000000000')).toBeUndefined()
  })

  it('agrees with getProductById for ids in the catalogue', () => {
    expect(getProductByArticleNo(sample.id)).toBe(getProductById(sample.id))
  })
})
