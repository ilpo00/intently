// ─────────────────────────────────────────────────────────────────
// fetch-catalog-images.mjs
//
// Restores the demo catalogue's product thumbnails (public/catalog/<id>.webp)
// from their public source, the Hugging Face dataset
// Qdrant/hm_ecommerce_products. The images are not committed to the public
// repository: they are H&M product photographs, and redistributing them is
// not ours to decide. The catalogue data (vision-catalog.json) references
// them by H&M article number, so this script fetches exactly those.
//
// Run from intently/:
//   node scripts/fetch-catalog-images.mjs              # → public/catalog
//   node scripts/fetch-catalog-images.mjs --storefront # also ../storefront/public/catalog
//
// Idempotent: existing files are skipped. Without the images the app still
// runs; product cards just show no photo.
// ─────────────────────────────────────────────────────────────────

import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const INTENTLY = resolve(__dirname, '..')
const OUT = resolve(INTENTLY, 'public', 'catalog')
const STOREFRONT_OUT = resolve(INTENTLY, '..', 'storefront', 'public', 'catalog')
const CATALOG = resolve(INTENTLY, 'src', 'lib', 'catalog', 'vision-catalog.json')

const DS = 'Qdrant/hm_ecommerce_products'
const ROWS_URL = 'https://datasets-server.huggingface.co/rows'
const PAGE = 100
const MAX_ROWS = 200_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchPage(offset, attempt = 0) {
  const url = `${ROWS_URL}?dataset=${encodeURIComponent(DS)}&config=default&split=train&offset=${offset}&length=${PAGE}`
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (e) {
    if (attempt < 4) { await sleep(800 * (attempt + 1)); return fetchPage(offset, attempt + 1) }
    throw e
  }
}

async function main() {
  const withStorefront = process.argv.includes('--storefront')
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'))
  const wanted = new Set(
    catalog
      .map((p) => /\/catalog\/(\d+)\.webp$/.exec(p.imageUrl ?? '')?.[1])
      .filter(Boolean),
  )
  mkdirSync(OUT, { recursive: true })
  for (const id of [...wanted]) if (existsSync(resolve(OUT, `${id}.webp`))) wanted.delete(id)
  console.log(`${wanted.size} image(s) to fetch into ${OUT}`)

  let fetched = 0
  for (let offset = 0; wanted.size > 0 && offset < MAX_ROWS; offset += PAGE) {
    let body
    try { body = await fetchPage(offset) } catch (e) { console.warn(`\npage at ${offset} failed: ${e.message}`); continue }
    if (!body.rows?.length) break
    for (const { row: r } of body.rows) {
      const id = String(Number(r.article_id))
      if (!wanted.has(id) || !r.image_url) continue
      try {
        const res = await fetch(r.image_url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const buf = Buffer.from(await res.arrayBuffer())
        await sharp(buf).resize({ width: 320 }).webp({ quality: 80 }).toFile(resolve(OUT, `${id}.webp`))
        wanted.delete(id)
        fetched++
      } catch (e) {
        console.warn(`\n${id}: ${e.message}`)
      }
    }
    process.stdout.write(`\rscanned ${offset + PAGE} rows · fetched ${fetched} · remaining ${wanted.size}   `)
  }
  console.log()

  if (withStorefront) {
    mkdirSync(STOREFRONT_OUT, { recursive: true })
    for (const p of catalog) {
      const id = /\/catalog\/(\d+)\.webp$/.exec(p.imageUrl ?? '')?.[1]
      const src = id && resolve(OUT, `${id}.webp`)
      if (src && existsSync(src)) copyFileSync(src, resolve(STOREFRONT_OUT, `${id}.webp`))
    }
    console.log(`copied into ${STOREFRONT_OUT}`)
  }

  if (wanted.size) {
    console.log(`${wanted.size} image(s) not found in ${DS}: ${[...wanted].slice(0, 10).join(', ')}`)
    process.exitCode = 1
  } else {
    console.log('done. Images: H&M product photos via Hugging Face Qdrant/hm_ecommerce_products.')
  }
}

main()
