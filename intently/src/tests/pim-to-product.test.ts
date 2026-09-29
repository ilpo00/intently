// ─────────────────────────────────────────────
// Tests: src/lib/enrichment/pim-to-product.ts
//
// The PIM→discovery seam. Proves a raw PIM record (e.g. from Medusa) projects
// into a fully-formed, renderable river Product — so products the enrichment
// layer pulled from the PIM actually appear in discovery instead of being
// dropped. No Medusa / store / embedder needed: pure projection.
// ─────────────────────────────────────────────

import { pimProductToProduct } from '@/lib/enrichment/pim-to-product'
import type { PimProduct } from '@/types/enrichment'

// A Medusa-sourced summer dress (Kaggle row 34588).
const MEDUSA_DRESS: PimProduct = {
  id: 'k34588',
  title: 'Tonga Women Cream Dress',
  category: 'Apparel',
  subcategory: 'Dress',
  articleType: 'Dresses',
  gender: 'Women',
  color: 'Cream',
  season: 'Summer',
  year: 2012,
  usage: 'Casual',
  imageUrl: 'http://localhost:3000/catalog/34588.webp',
  source: 'medusa',
}

// A Medusa-sourced rain jacket.
const MEDUSA_JACKET: PimProduct = {
  id: 'k99001',
  title: 'Wildcraft Men Black Rain Jacket',
  category: 'Apparel',
  subcategory: 'Topwear',
  articleType: 'Jackets',
  gender: 'Men',
  color: 'Black',
  season: 'Fall',
  usage: 'Sports',
  source: 'medusa',
}

describe('pimProductToProduct (Medusa source)', () => {
  it('projects a complete, renderable Product', () => {
    const p = pimProductToProduct(MEDUSA_DRESS)
    expect(p.id).toBe('k34588')
    expect(p.name).toBe('Tonga Women Cream Dress')
    expect(p.currency).toBe('EUR')
    expect(p.imageUrl).toBe('/catalog/34588.webp')
    // every field the prefilter / explanation read must be present
    expect(p.category).toBe('dress')
    expect(p.catalog).toBe('fashion')
    expect(Array.isArray(p.occasionTags)).toBe(true)
    expect(typeof p.formalityLevel).toBe('number')
    expect(Array.isArray(p.styleTags)).toBe(true)
  })

  it('derives semantic attributes the river ranks on', () => {
    const p = pimProductToProduct(MEDUSA_DRESS)
    expect(p.occasionTags).toContain('wedding guest')
    expect(p.occasionTags).toContain('outdoor event') // summer dress
    expect(p.season).toEqual(['summer'])
    expect(p.color).toEqual(['cream'])
    expect(p.formalityLevel).toBe(2)        // Casual
    expect(p.styleTags).toEqual(['relaxed'])
    expect(p.pattern).toBe('solid')
  })

  it('puts outdoor article types on the outdoor catalog', () => {
    const p = pimProductToProduct(MEDUSA_JACKET)
    expect(p.category).toBe('jacket')
    expect(p.catalog).toBe('outdoor')
    expect(p.occasionTags).toContain('day hiking')
  })

  it('prices deterministically within the category band and rounded to €5', () => {
    const a = pimProductToProduct(MEDUSA_DRESS)
    const b = pimProductToProduct(MEDUSA_DRESS)
    expect(a.price).toBe(b.price)            // stable across runs
    expect(a.price).toBeGreaterThanOrEqual(5900)
    expect(a.price).toBeLessThanOrEqual(17900)
    expect(a.price % 500).toBe(0)
  })

  it('leaves vision-only fields as light defaults', () => {
    const p = pimProductToProduct(MEDUSA_DRESS)
    expect(p.fabric).toEqual([])
    expect(p.silhouette).toBe('')
  })
})

describe('pimProductToProduct (intently-catalog source)', () => {
  it('honours attributes the catalogue adapter stashed in raw', () => {
    const fromCatalog: PimProduct = {
      id: 'k15970',
      title: 'Turtle Check Men Navy Blue Shirt',
      category: 'fashion',        // catalogue adapter puts the catalog axis here
      subcategory: 'shirt',       // ...and the river category here
      articleType: 'shirt',
      color: 'navy blue',
      season: 'autumn',
      usage: 'everyday',
      imageUrl: '/catalog/15970.webp',
      source: 'intently-catalog',
      raw: {
        embedText: 'precomposed rich embed text',
        brand: 'Turtle',
        occasionTags: ['everyday', 'smart casual'],
        styleTags: ['classic'],
        formalityLevel: 3,
        pattern: 'check',
      },
    }
    const p = pimProductToProduct(fromCatalog)
    expect(p.catalog).toBe('fashion')
    expect(p.category).toBe('shirt')
    expect(p.embeddingText).toBe('precomposed rich embed text')
    expect(p.brand).toBe('Turtle')
    expect(p.occasionTags).toEqual(['everyday', 'smart casual'])
    expect(p.styleTags).toEqual(['classic'])
    expect(p.formalityLevel).toBe(3)
    expect(p.pattern).toBe('check')
  })
})
