// ─────────────────────────────────────────────────────────────────
// build-seed-hm.mjs
//
// Ingest for the H&M product dataset (Qdrant/hm_ecommerce_products, CC-BY-4.0).
// Scans the HF datasets-server /rows API, selects a curated fashion+outdoor
// spread, downloads each matched product image and resizes it to a committed
// webp thumbnail, and emits pim/src/scripts/seed-products.json in the shape the
// Medusa seed already consumes (so the seed/adapter/derivers are unchanged).
//
// H&M has no season/usage fields, so those are synthesised from product type.
// Outerwear/bags map to the "outdoor" axis (it's outerwear, not hiking gear).
//
// Run from intently/ (so `sharp` resolves):
//   node scripts/build-seed-hm.mjs                 # full (~300)
//   HM_BUCKET_SCALE=0.05 node scripts/build-seed-hm.mjs   # smoke test (~15)
// ─────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const INTENTLY = resolve(__dirname, '..')
const ROOT = resolve(INTENTLY, '..')
const PUBLIC_CATALOG = resolve(INTENTLY, 'public', 'catalog')
const SEED_JSON = resolve(ROOT, 'pim', 'src', 'scripts', 'seed-products.json')

const DS = 'Qdrant/hm_ecommerce_products'
const ROWS_URL = 'https://datasets-server.huggingface.co/rows'
const PAGE = 100
const MAX_PAGES = 200          // up to 20k rows scanned to fill buckets
const SCALE = Number(process.env.HM_BUCKET_SCALE ?? 1)

// Curated spread. Keys are our Kaggle-ish articleType (drives category/catalog
// + occasion derivation at runtime); values are target counts.
const BUCKETS = {
  Dresses: 70, Tops: 55, Shirts: 25, Skirt: 20, Trousers: 20,   // fashion
  Jackets: 45, Backpacks: 30, Caps: 15, Sunglasses: 12,         // outdoor
}
const TARGET = Object.fromEntries(
  Object.entries(BUCKETS).map(([k, v]) => [k, Math.max(1, Math.round(v * SCALE))]),
)

// H&M product_type_name → our articleType.
const TYPE_TO_ARTICLE = {
  'Dress': 'Dresses',
  'Blouse': 'Tops', 'Vest top': 'Tops', 'Top': 'Tops', 'T-shirt': 'Tops',
  'Cardigan': 'Tops', 'Sweater': 'Tops', 'Jumper': 'Tops', 'Bodysuit': 'Tops', 'Hoodie': 'Tops',
  'Shirt': 'Shirts',
  'Skirt': 'Skirt',
  'Trousers': 'Trousers', 'Jeans': 'Trousers', 'Shorts': 'Trousers',
  'Jacket': 'Jackets', 'Coat': 'Jackets', 'Puffer jacket': 'Jackets', 'Outdoor overall': 'Jackets',
  'Bag': 'Backpacks', 'Backpack': 'Backpacks', 'Weekend/Gym bag': 'Backpacks',
  'Hat/beanie': 'Caps', 'Cap/peaked': 'Caps', 'Hat/brim': 'Caps', 'Beanie': 'Caps',
  'Sunglasses': 'Sunglasses',
}
// Synthesised usage per articleType (drives occasion tags / formality / style).
const ARTICLE_USAGE = {
  Dresses: 'Party', Tops: 'Casual', Shirts: 'Smart Casual', Skirt: 'Casual',
  Trousers: 'Casual', Jackets: 'Casual', Backpacks: 'Casual', Caps: 'Casual', Sunglasses: 'Casual',
}

function genderOf(indexGroup, section) {
  const g = (indexGroup || '').toLowerCase()
  if (g.includes('baby') || g.includes('children')) return null // skip kids
  if (g.includes('men') && !g.includes('women')) return 'Men'
  if (g === 'menswear') return 'Men'
  if ((section || '').toLowerCase().includes('men') && !(section || '').toLowerCase().includes('women')) return 'Men'
  return 'Women'
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchPage(offset, attempt = 0) {
  const url = `${ROWS_URL}?dataset=${encodeURIComponent(DS)}&config=default&split=train&offset=${offset}&length=${PAGE}`
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    const ct = res.headers.get('content-type') || ''
    if (!res.ok || !ct.includes('application/json')) throw new Error(`bad response ${res.status} ${ct}`)
    return await res.json()
  } catch (err) {
    if (attempt < 4) { await sleep(800 * (attempt + 1)); return fetchPage(offset, attempt + 1) }
    throw err
  }
}

async function downloadWebp(imageUrl, id) {
  const res = await fetch(imageUrl)
  if (!res.ok) throw new Error(`img ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await sharp(buf).resize({ width: 320 }).webp({ quality: 80 }).toFile(resolve(PUBLIC_CATALOG, `${id}.webp`))
}

async function main() {
  mkdirSync(PUBLIC_CATALOG, { recursive: true })
  const counts = Object.fromEntries(Object.keys(TARGET).map((k) => [k, 0]))
  const out = []
  const seen = new Set()
  const done = () => Object.keys(TARGET).every((k) => counts[k] >= TARGET[k])

  let page = 0
  for (let offset = 0; page < MAX_PAGES && !done(); offset += PAGE, page++) {
    let body
    try { body = await fetchPage(offset) } catch (e) { console.warn(`page ${page} failed: ${e.message}`); continue }
    if (!body.rows || body.rows.length === 0) break

    for (const { row: r } of body.rows) {
      const article = TYPE_TO_ARTICLE[r.product_type_name]
      if (!article || counts[article] >= TARGET[article]) continue
      const gender = genderOf(r.index_group_name, r.section_name)
      if (!gender) continue
      const id = Number(r.article_id)
      if (!id || seen.has(id) || !r.image_url) continue

      try {
        await downloadWebp(r.image_url, id)
      } catch (e) {
        continue // image missing/broken — skip, don't record
      }
      seen.add(id)
      counts[article]++
      out.push({
        id,
        gender,
        masterCategory: r.product_group_name || 'Apparel',
        subCategory: r.section_name || r.garment_group_name || '',
        articleType: article,
        baseColour: r.colour_group_name || r.perceived_colour_master_name || '',
        season: '',
        year: 2024,
        usage: ARTICLE_USAGE[article] || 'Casual',
        productDisplayName: r.prod_name || 'H&M product',
      })
    }
    process.stdout.write(`\rscanned ${offset + PAGE} rows · collected ${out.length} · ` +
      Object.entries(counts).map(([k, v]) => `${k}:${v}/${TARGET[k]}`).join(' '))
    await sleep(350) // throttle the API
  }
  process.stdout.write('\n')

  mkdirSync(dirname(SEED_JSON), { recursive: true })
  writeFileSync(SEED_JSON, JSON.stringify(out, null, 2))
  writeFileSync(resolve(PUBLIC_CATALOG, 'ATTRIBUTION.txt'),
    'Product images sourced from the H&M dataset (Qdrant/hm_ecommerce_products),\n' +
    'licensed CC-BY-4.0. Resized to webp thumbnails for the Intently demo.\n' +
    'https://huggingface.co/datasets/Qdrant/hm_ecommerce_products\n')

  console.log(`\nwrote ${out.length} products → ${SEED_JSON}`)
  console.log('by bucket:', counts)
  const missing = Object.keys(TARGET).filter((k) => counts[k] < TARGET[k])
  if (missing.length) console.log('under-target buckets:', missing.map((k) => `${k} ${counts[k]}/${TARGET[k]}`).join(', '))
}

main().catch((e) => { console.error(e); process.exit(1) })
