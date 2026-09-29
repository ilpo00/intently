// ─────────────────────────────────────────────────────────────────
// Intently · Enrichment — Medusa PIM adapter
//
// Talks to a running Medusa v2 instance via its Store / Admin REST.
// We use the Store API for read-only product list (no admin auth
// needed), which is plenty for v0.1.
//
// Env:
//   MEDUSA_BACKEND_URL          default http://localhost:9000
//   MEDUSA_PUBLISHABLE_KEY      required by Medusa v2 store API
//
// Why no Medusa SDK dependency: Medusa's JS SDK pulls in heavy
// transitive deps (axios, lodash slices). For the small surface we
// need, raw fetch is cleaner and the contract is stable.
// ─────────────────────────────────────────────────────────────────

import type { PimAdapter, PimProduct } from '@/types/enrichment'
import { getProductByArticleNo } from '@/lib/data'

interface MedusaImage {
  id?: string
  url?: string
}

interface MedusaVariant {
  id?: string
  title?: string
  prices?: { amount: number; currency_code: string }[]
  // calculated_price is only present when the products query carries a
  // region_id (Medusa computes the region-priced amount).
  calculated_price?: { calculated_amount?: number; currency_code?: string }
}

interface MedusaCollection {
  handle?: string
  title?: string
}

interface MedusaType {
  value?: string
}

interface MedusaTag {
  value?: string
}

interface MedusaProduct {
  id: string
  title: string
  subtitle?: string
  description?: string | null
  handle?: string
  thumbnail?: string | null
  images?: MedusaImage[]
  variants?: MedusaVariant[]
  collection?: MedusaCollection
  type?: MedusaType
  tags?: MedusaTag[]
  /**
   * Medusa exposes metadata as a free-form JSON object. We round-trip
   * the Kaggle attributes through this field at seed time so we don't
   * lose colour / season / usage.
   */
  metadata?: Record<string, unknown> | null
}

interface MedusaProductsResponse {
  products: MedusaProduct[]
  count?: number
  offset?: number
  limit?: number
}

// +variants.id and +variants.calculated_price give us the variant to add to a
// cart and the region-priced amount to display. region_id must accompany the
// request for calculated_price to be populated.
// `*variants.calculated_price` expands the computed price relation (and brings
// the variant id with it). `+variants.calculated_price` does NOT populate it.
const PRODUCT_FIELDS =
  '+metadata,+thumbnail,+images,+type,+collection,+tags,*variants.calculated_price'

function medusaToPim(p: MedusaProduct): PimProduct {
  const meta = p.metadata ?? {}
  const pick = (k: string): string | undefined => {
    const v = meta[k]
    return typeof v === 'string' ? v : undefined
  }
  const pickNumber = (k: string): number | undefined => {
    const v = meta[k]
    return typeof v === 'number' ? v : undefined
  }

  const variant = p.variants?.[0]
  const id = pick('intentlyId') ?? p.id

  // Retrieval-recall bridge: Medusa carries only thin Kaggle-era master data, so
  // its composed embed text is weak for situational queries. When this article
  // exists in our vision-enriched catalogue (matched by article number), reuse
  // that product's rich embeddingText — buildEmbedText already prefers a
  // pre-composed raw.embedText, so the vector seed embeds the strong signal
  // without changing the builder. Dormant when the vision catalogue isn't loaded
  // (no article-number match → raw stays the plain Medusa record).
  const enriched = getProductByArticleNo(id)
  const raw: Record<string, unknown> = enriched?.embeddingText
    ? { ...(p as unknown as Record<string, unknown>), embedText: enriched.embeddingText }
    : (p as unknown as Record<string, unknown>)

  return {
    // Prefer the river-aligned id stamped at seed time (metadata.intentlyId,
    // e.g. "k15970") so vector records key by the SAME id the discovery river
    // uses; fall back to Medusa's internal id if a product wasn't seeded by us.
    id,
    title: p.title,
    description: p.description ?? p.subtitle ?? undefined,
    category: pick('masterCategory') ?? p.collection?.title,
    subcategory: pick('subCategory'),
    articleType: pick('articleType') ?? p.type?.value,
    gender: pick('gender'),
    color: pick('baseColour'),
    season: pick('season'),
    year: pickNumber('year'),
    usage: pick('usage'),
    imageUrl: p.thumbnail ?? p.images?.[0]?.url ?? undefined,
    // The Medusa variant + region-priced amount — what the storefront sells
    // and what discovery should display + add to the shared cart.
    variantId: variant?.id,
    priceAmount: variant?.calculated_price?.calculated_amount,
    source: 'medusa',
    raw,
  }
}

export class MedusaPimAdapter implements PimAdapter {
  readonly sourceName = 'medusa'
  private readonly baseUrl: string
  private readonly publishableKey: string | undefined
  private regionIdCache?: string

  constructor(opts?: { baseUrl?: string; publishableKey?: string }) {
    this.baseUrl =
      opts?.baseUrl ?? process.env.MEDUSA_BACKEND_URL ?? 'http://localhost:9000'
    this.publishableKey =
      opts?.publishableKey ?? process.env.MEDUSA_PUBLISHABLE_KEY
  }

  private headers(): HeadersInit {
    const h: Record<string, string> = { 'content-type': 'application/json' }
    if (this.publishableKey) h['x-publishable-api-key'] = this.publishableKey
    return h
  }

  /** First region's id (memoised); needed for calculated_price. */
  private async regionId(): Promise<string | undefined> {
    if (this.regionIdCache) return this.regionIdCache
    try {
      const res = await fetch(`${this.baseUrl}/store/regions`, { headers: this.headers() })
      if (!res.ok) return undefined
      const body = (await res.json()) as { regions?: { id: string }[] }
      this.regionIdCache = body.regions?.[0]?.id
      return this.regionIdCache
    } catch {
      return undefined
    }
  }

  async list(): Promise<PimProduct[]> {
    const out: PimProduct[] = []
    const limit = 100
    let offset = 0
    const regionId = await this.regionId()
    // Paginate. Medusa v2 returns `count` so we know when to stop.
    for (;;) {
      const url = new URL(`${this.baseUrl}/store/products`)
      url.searchParams.set('limit', String(limit))
      url.searchParams.set('offset', String(offset))
      url.searchParams.set('fields', PRODUCT_FIELDS)
      if (regionId) url.searchParams.set('region_id', regionId)
      const res = await fetch(url, { headers: this.headers() })
      if (!res.ok) {
        throw new Error(`Medusa list failed: ${res.status} ${await res.text()}`)
      }
      const body = (await res.json()) as MedusaProductsResponse
      for (const p of body.products) out.push(medusaToPim(p))
      if (body.products.length < limit) break
      offset += body.products.length
      if (typeof body.count === 'number' && offset >= body.count) break
    }
    return out
  }

  async get(id: string): Promise<PimProduct | null> {
    const url = new URL(`${this.baseUrl}/store/products/${encodeURIComponent(id)}`)
    url.searchParams.set('fields', PRODUCT_FIELDS)
    const regionId = await this.regionId()
    if (regionId) url.searchParams.set('region_id', regionId)
    const res = await fetch(url, { headers: this.headers() })
    if (res.status === 404) return null
    if (!res.ok) {
      throw new Error(`Medusa get failed: ${res.status} ${await res.text()}`)
    }
    const body = (await res.json()) as { product: MedusaProduct }
    return medusaToPim(body.product)
  }
}
