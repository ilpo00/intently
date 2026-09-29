// ─────────────────────────────────────────────────────────────────
// fetch-catalog-images.mjs
//
// Restores the demo catalogue's product thumbnails (public/catalog/<id>.webp).
// They are not committed to the public repository: they are H&M product
// photographs, and redistributing them is not ours to decide.
//
// Source: the H&M Personalized Fashion Recommendations dataset on Kaggle
// (https://www.kaggle.com/competitions/h-and-m-personalized-fashion-recommendations/data).
// Downloading it requires a Kaggle account and accepting the competition
// rules — that licence decision stays with whoever runs this. Its images/
// folder is laid out as images/<first 3 digits>/<10-digit article id>.jpg,
// and vision-catalog.json references products by the same article number.
//
// (The catalogue was originally built from the Hugging Face mirror
// Qdrant/hm_ecommerce_products; as of 2026-09 its image URLs return 404, so it
// is no longer a usable source.)
//
// Run from intently/:
//   node scripts/fetch-catalog-images.mjs --from /path/to/hm/images
//   node scripts/fetch-catalog-images.mjs --from /path/to/hm/images --storefront
//
// Idempotent: existing thumbnails are skipped. Without the images the app still
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

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const from = argValue('--from')
  if (!from || !existsSync(from)) {
    console.error(
      'Usage: node scripts/fetch-catalog-images.mjs --from /path/to/hm/images [--storefront]\n\n' +
      'Download the images/ folder of the Kaggle dataset "H&M Personalized Fashion\n' +
      'Recommendations" (account + rules acceptance required), then point --from at it.',
    )
    process.exitCode = 1
    return
  }

  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'))
  const ids = [...new Set(
    catalog.map((p) => /\/catalog\/(\d+)\.webp$/.exec(p.imageUrl ?? '')?.[1]).filter(Boolean),
  )]
  mkdirSync(OUT, { recursive: true })

  let made = 0, skipped = 0
  const missing = []
  for (const id of ids) {
    const target = resolve(OUT, `${id}.webp`)
    if (existsSync(target)) { skipped++; continue }
    const article = id.padStart(10, '0')
    const src = resolve(from, article.slice(0, 3), `${article}.jpg`)
    if (!existsSync(src)) { missing.push(id); continue }
    await sharp(src).resize({ width: 320 }).webp({ quality: 80 }).toFile(target)
    made++
  }
  console.log(`thumbnails: ${made} created, ${skipped} already present, ${missing.length} missing → ${OUT}`)

  if (process.argv.includes('--storefront')) {
    mkdirSync(STOREFRONT_OUT, { recursive: true })
    for (const id of ids) {
      const src = resolve(OUT, `${id}.webp`)
      if (existsSync(src)) copyFileSync(src, resolve(STOREFRONT_OUT, `${id}.webp`))
    }
    console.log(`copied into ${STOREFRONT_OUT}`)
  }

  if (missing.length) {
    console.log(`not found under ${from}: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''}`)
    process.exitCode = 1
  }
}

main()
