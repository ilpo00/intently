// ─────────────────────────────────────────────
// import-kaggle.mjs
//
// Phase-1 "enrichment layer" stand-in. Reads the Kaggle Fashion Product
// Images dataset (styles.csv + images/) and produces Intently's enriched
// catalog JSON + a curated image subset under public/.
//
// This deterministically maps Kaggle metadata → Intently's enriched Product
// attributes. It is the manual analogue of the Phase-2 vision-enrichment
// pipeline (PIM → Product Intelligence Store) described in docs/roadmap.md.
// Attributes Kaggle CAN give us (occasion/formality/season/colour/pattern)
// are derived here; attributes that need vision (fabric/silhouette) are left
// as light defaults — those are exactly what Phase-2 enrichment adds.
//
// Usage:  node scripts/import-kaggle.mjs
// Reads:  ../data/kaggle/{styles.csv,images/}   (git-ignored, ~30GB — untouched)
// Writes: src/lib/catalog/{fashion,outdoor}-catalog.json
//         public/catalog/{id}.jpg   (only the selected items; <100 files)
// ─────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MISE = resolve(__dirname, '..')
const KAGGLE = resolve(MISE, '..', 'data', 'kaggle')
const IMAGES_SRC = resolve(KAGGLE, 'images')
const STYLES_CSV = resolve(KAGGLE, 'styles.csv')

const CATALOG_DIR = resolve(MISE, 'src', 'lib', 'catalog')
const PUBLIC_DIR = resolve(MISE, 'public', 'catalog')

// How many items per catalog. Keep the image copy well under 100 files total.
const FASHION_N = 42
const OUTDOOR_N = 40

// ── CSV parse ─────────────────────────────────
// styles.csv has 10 columns; the last (productDisplayName) can contain commas,
// so split on the first 9 commas only and keep the remainder as the name.
function parseStyles(csv) {
  const lines = csv.split(/\r?\n/).filter(Boolean)
  lines.shift() // header
  const rows = []
  for (const line of lines) {
    const parts = line.split(',')
    if (parts.length < 10) continue
    const [id, gender, masterCategory, subCategory, articleType, baseColour, season, year, usage] = parts
    const productDisplayName = parts.slice(9).join(',').trim()
    if (!id || !/^\d+$/.test(id)) continue
    rows.push({ id, gender, masterCategory, subCategory, articleType, baseColour, season, year, usage, productDisplayName })
  }
  return rows
}

// ── Deterministic enrichment mappers ──────────
const STYLE_BY_USAGE = {
  Formal: ['elegant', 'classic'],
  'Smart Casual': ['classic'],
  Party: ['romantic'],
  Casual: ['relaxed'],
  Sports: ['sporty'],
  Ethnic: ['bohemian'],
  Travel: ['relaxed'],
}
function styleTags(usage) {
  return STYLE_BY_USAGE[usage] ?? ['classic']
}

const FORMALITY_BY_USAGE = {
  Sports: 1, Casual: 2, Travel: 2, 'Smart Casual': 3, Party: 3, Ethnic: 3, Formal: 4,
}
function formalityLevel(usage) {
  return FORMALITY_BY_USAGE[usage] ?? 2
}

const CATEGORY_BY_TYPE = {
  Dresses: 'dress', Tops: 'top', Tshirts: 'top', Shirts: 'shirt', Heels: 'heels',
  Jackets: 'jacket', Backpacks: 'backpack', Sunglasses: 'sunglasses',
  'Sports Shoes': 'shoes', Sweatshirts: 'sweatshirt', 'Track Pants': 'trousers',
  Shorts: 'shorts', Caps: 'cap', Trousers: 'trousers',
}
function category(articleType) {
  return CATEGORY_BY_TYPE[articleType] ?? articleType.toLowerCase()
}

// Pattern is inferable from the product name (gives the "not floral" demo a
// real signal); default solid.
function pattern(name) {
  const n = name.toLowerCase()
  if (/floral|flower/.test(n)) return 'floral'
  if (/strip/.test(n)) return 'stripe'
  if (/print/.test(n)) return 'print'
  if (/check|checked|plaid/.test(n)) return 'check'
  if (/polka|dot/.test(n)) return 'polka dot'
  if (/solid/.test(n)) return 'solid'
  return 'solid'
}

function season(s) {
  const m = { Summer: 'summer', Winter: 'winter', Fall: 'autumn', Spring: 'spring' }
  return m[s] ? [m[s]] : []
}

// Occasion tags blend usage + season + category so the discovery engine has
// situational signal to retrieve and rank on.
function occasionTags(row) {
  const tags = new Set()
  const u = row.usage
  if (u === 'Formal') tags.add('formal event')
  if (u === 'Party') { tags.add('party'); tags.add('evening') }
  if (u === 'Smart Casual') tags.add('smart casual')
  if (u === 'Casual') tags.add('everyday')
  if (u === 'Sports') { tags.add('sport'); tags.add('outdoor activity') }
  if (u === 'Ethnic') tags.add('ethnic occasion')
  const cat = category(row.articleType)
  // Summer dresses in party/smart-casual/formal usage read as wedding-guest candidates.
  if (cat === 'dress' && (u === 'Party' || u === 'Smart Casual' || u === 'Formal' || u === 'Casual')) {
    tags.add('wedding guest')
    tags.add('summer party')
    if (row.season === 'Summer' || row.season === 'Spring') tags.add('outdoor event')
  }
  if (['jacket', 'backpack', 'sunglasses', 'shoes', 'cap'].includes(cat)) {
    tags.add('day hiking'); tags.add('outdoors'); tags.add('travel')
  }
  if (cat === 'top' && u === 'Sports') tags.add('base layer')
  return [...tags]
}

const PRICE_RANGES = {
  dress: [5900, 17900], jacket: [7900, 19900], backpack: [3900, 8900],
  sunglasses: [2900, 11900], top: [1900, 5900], shirt: [2900, 6900],
  heels: [4900, 12900], shoes: [4900, 13900], shorts: [1900, 4900],
  trousers: [2900, 7900], sweatshirt: [3900, 7900], cap: [1500, 3500],
}
// Deterministic price from id so reruns are stable.
function price(cat, id) {
  const [lo, hi] = PRICE_RANGES[cat] ?? [2900, 9900]
  const span = hi - lo
  const n = Number(id)
  return lo + (n % span) - ((lo + (n % span)) % 500) // round to nearest €5
}

function sizesFor(cat) {
  if (['sunglasses', 'backpack', 'cap'].includes(cat)) return ['One Size']
  if (['shoes', 'heels'].includes(cat)) return ['37', '38', '39', '40', '41']
  return ['XS', 'S', 'M', 'L', 'XL']
}

// First token of the display name is usually the brand in this dataset.
function brandOf(name) {
  const t = name.trim().split(/\s+/)[0]
  return t && t.length > 1 ? t : 'Intently'
}

function toProduct(row, catalog) {
  const cat = category(row.articleType)
  const tags = occasionTags(row)
  const pat = pattern(row.productDisplayName)
  const seas = season(row.season)
  const styles = styleTags(row.usage)
  const color = [row.baseColour].filter(Boolean).map(c => c.toLowerCase())
  const embeddingText = [
    row.productDisplayName, brandOf(row.productDisplayName), cat,
    ...tags, ...color, ...seas, ...styles, pat,
  ].join(' ').toLowerCase()
  return {
    id: `k${row.id}`,
    name: row.productDisplayName,
    brand: brandOf(row.productDisplayName),
    price: price(cat, row.id),
    currency: 'EUR',
    imageUrl: `/catalog/${row.id}.jpg`,
    category: cat,
    catalog,
    color,
    sizesAvailable: sizesFor(cat),
    occasionTags: tags,
    formalityLevel: formalityLevel(row.usage),
    season: seas,
    fabric: [],          // not in Kaggle — Phase-2 vision enrichment fills this
    silhouette: '',      // not in Kaggle — Phase-2 vision enrichment fills this
    pattern: pat,
    styleTags: styles,
    embeddingText,
  }
}

// ── Selection ─────────────────────────────────
function imageExists(id) {
  return existsSync(resolve(IMAGES_SRC, `${id}.jpg`))
}

function pick(rows, predicate, n) {
  const out = []
  for (const r of rows) {
    if (out.length >= n) break
    if (predicate(r) && imageExists(r.id)) out.push(r)
  }
  return out
}

function main() {
  if (!existsSync(STYLES_CSV)) {
    console.error(`styles.csv not found at ${STYLES_CSV}. Extract the Kaggle dataset there first.`)
    process.exit(1)
  }
  const rows = parseStyles(readFileSync(STYLES_CSV, 'utf8'))
  // Stable order so reruns are deterministic.
  rows.sort((a, b) => Number(a.id) - Number(b.id))

  // Exclude kids/infant items — they undercut the adult wedding-guest demo.
  const isAdult = r => !/(kid|girl|boy|infant|baby|toddler)/i.test(r.productDisplayName)

  // Fashion (Scenario A): women's dresses, biased toward summer + dressier usage,
  // and guarantee a few florals so the "not floral" refinement is demonstrable.
  const dressy = r => r.gender === 'Women' && r.articleType === 'Dresses' && isAdult(r)
  const florals = pick(rows, r => dressy(r) && pattern(r.productDisplayName) === 'floral', 8)
  const otherDresses = pick(
    rows,
    r => dressy(r) && !florals.find(f => f.id === r.id),
    FASHION_N - florals.length,
  )
  const fashionRows = [...florals, ...otherDresses]

  // Outdoor (Scenario B): the casual day-hiker basket — jackets, daypacks,
  // sunglasses, sporty base layers, a few caps. Footwear included in catalogue
  // but the scenario treats it as already-purchased.
  // Bias toward the iconic day-hiker basket items first (jacket / backpack /
  // sunglasses), then fill with sporty layers + caps.
  const sportyTops = r => (r.articleType === 'Tshirts' || r.articleType === 'Tops') && r.usage === 'Sports'
  const adult = r => isAdult(r)
  const outdoorRows = []
  const takeInto = (predicate, n) => {
    for (const r of pick(rows.filter(r => !outdoorRows.find(o => o.id === r.id)), predicate, n)) {
      outdoorRows.push(r)
    }
  }
  takeInto(r => adult(r) && r.articleType === 'Jackets', 12)
  takeInto(r => adult(r) && r.articleType === 'Backpacks', 10)
  takeInto(r => adult(r) && r.articleType === 'Sunglasses', 8)
  takeInto(r => adult(r) && (sportyTops(r) || r.articleType === 'Sweatshirts'), OUTDOOR_N - outdoorRows.length - 2)
  takeInto(r => adult(r) && r.articleType === 'Caps', OUTDOOR_N - outdoorRows.length)

  const fashion = fashionRows.map(r => toProduct(r, 'fashion'))
  const outdoor = outdoorRows.map(r => toProduct(r, 'outdoor'))

  // Fresh public/catalog dir; copy only the selected images.
  rmSync(PUBLIC_DIR, { recursive: true, force: true })
  mkdirSync(PUBLIC_DIR, { recursive: true })
  mkdirSync(CATALOG_DIR, { recursive: true })
  let copied = 0
  for (const r of [...fashionRows, ...outdoorRows]) {
    copyFileSync(resolve(IMAGES_SRC, `${r.id}.jpg`), resolve(PUBLIC_DIR, `${r.id}.jpg`))
    copied++
  }

  writeFileSync(resolve(CATALOG_DIR, 'fashion-catalog.json'), JSON.stringify(fashion, null, 2))
  writeFileSync(resolve(CATALOG_DIR, 'outdoor-catalog.json'), JSON.stringify(outdoor, null, 2))

  console.log(`fashion: ${fashion.length} (incl ${florals.length} floral)`)
  console.log(`outdoor: ${outdoor.length}`)
  console.log(`images copied to public/catalog: ${copied}`)
  console.log(`categories(outdoor): ${[...new Set(outdoor.map(p => p.category))].join(', ')}`)
}

main()
