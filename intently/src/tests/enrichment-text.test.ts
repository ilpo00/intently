// ─────────────────────────────────────────────
// Tests: src/lib/enrichment/enrich-text.ts
//
// Pins the embed-text shape. When someone tunes
// the composition, these tests fail loudly so
// the change is intentional, not accidental.
// ─────────────────────────────────────────────

import { buildEmbedText } from '@/lib/enrichment/enrich-text'
import type { PimProduct } from '@/types/enrichment'

const SAMPLE: PimProduct = {
  id: 'kaggle-15970',
  title: 'Turtle Check Men Navy Blue Shirt',
  category: 'Apparel',
  subcategory: 'Topwear',
  articleType: 'Shirts',
  gender: 'Men',
  color: 'Navy Blue',
  season: 'Fall',
  year: 2011,
  usage: 'Casual',
  source: 'kaggle',
}

describe('buildEmbedText', () => {
  it('puts the display name first', () => {
    const out = buildEmbedText(SAMPLE)
    expect(out.startsWith('Turtle Check Men Navy Blue Shirt')).toBe(true)
  })

  it('includes audience, taxonomy, and attributes', () => {
    const out = buildEmbedText(SAMPLE)
    expect(out).toContain('Men Casual Shirts')
    expect(out).toContain('Category: Apparel > Topwear')
    expect(out).toContain('Colour: Navy Blue')
    expect(out).toContain('Season: Fall')
    expect(out).toContain('2011')
  })

  it('handles missing optional fields without crashing', () => {
    const minimal: PimProduct = {
      id: 'x',
      title: 'Plain Product',
      source: 'kaggle',
    }
    expect(() => buildEmbedText(minimal)).not.toThrow()
    expect(buildEmbedText(minimal)).toBe('Plain Product')
  })

  it('produces a single-line string', () => {
    const out = buildEmbedText(SAMPLE)
    expect(out).not.toContain('\n')
  })

  it('collapses repeated whitespace', () => {
    const messy: PimProduct = {
      ...SAMPLE,
      title: 'Turtle  Check   Men    Navy   Shirt',
    }
    expect(buildEmbedText(messy)).not.toMatch(/\s{2,}/)
  })

  it('produces different output for materially different products', () => {
    const other: PimProduct = {
      ...SAMPLE,
      id: 'kaggle-39386',
      title: 'Peter England Men Party Blue Jeans',
      subcategory: 'Bottomwear',
      articleType: 'Jeans',
      color: 'Blue',
      season: 'Summer',
    }
    expect(buildEmbedText(SAMPLE)).not.toBe(buildEmbedText(other))
  })
})
