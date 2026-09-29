// ─────────────────────────────────────────────────────────────────
// Build the committed, image-backed discovery catalogue from the vision run.
//
//   node scripts/build-vision-catalog.mjs
//
// Projects .enrichment/vision-catalog.json (292 vision records) → the river's
// Product shape and writes src/lib/catalog/vision-catalog.json (committed). This
// is the REAL catalogue: photos that actually render + rich vision attributes
// (incl. the previously-empty fabric + silhouette) + a rich embeddingText so
// semantic discovery has something to match. Switched on with NEXT_PUBLIC_CATALOG=vision.
// ─────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = JSON.parse(readFileSync(join(ROOT, '.enrichment/vision-catalog.json'), 'utf8'))

const RIVER = { // coarse vision category → river category vocab (prefilter/situation)
  dress: 'dress', skirt: 'skirt', top: 'top', shirt: 'shirt', trousers: 'trousers',
  shorts: 'shorts', outerwear: 'jacket', knitwear: 'sweatshirt', footwear: 'shoes',
  bag: 'backpack', accessory: 'cap', other: 'top',
}
function coarse(g) {
  g = (g || '').toLowerCase()
  if (/dress|gown/.test(g)) return 'dress'
  if (/skirt/.test(g)) return 'skirt'
  if (/jacket|coat|blazer|parka|gilet|shell|bomber/.test(g)) return 'outerwear'
  if (/jumper|sweater|sweatshirt|hoodie|knit|cardigan|fleece/.test(g)) return 'knitwear'
  if (/t-?shirt|tee|tank|vest|cami| top/.test(g)) return 'top'
  if (/shirt|blouse/.test(g)) return 'shirt'
  if (/trouser|pant|jean|jogger|chino|legging/.test(g)) return 'trousers'
  if (/short/.test(g)) return 'shorts'
  if (/shoe|boot|trainer|sneaker|sandal|heel/.test(g)) return 'footwear'
  if (/bag|backpack|tote/.test(g)) return 'bag'
  if (/beanie|hat|cap|scarf|glove|sunglass/.test(g)) return 'accessory'
  return 'other'
}
const PRICE = { dress: [5900, 17900], jacket: [7900, 19900], backpack: [3900, 8900], top: [1500, 4900], shirt: [2900, 6900], shoes: [4900, 12900], shorts: [1900, 4900], trousers: [2900, 7900], sweatshirt: [3900, 7900], cap: [1500, 3500], skirt: [2900, 6900] }
const numId = id => Number((id.match(/\d+/) || [0])[0])
function price(cat, id) { const [lo, hi] = PRICE[cat] ?? [2900, 9900]; const span = hi - lo; const p = lo + (numId(id) % span); return p - (p % 500) }
function sizes(cat) { if (['cap', 'backpack'].includes(cat)) return ['One Size']; if (['shoes'].includes(cat)) return ['37', '38', '39', '40', '41']; return ['XS', 'S', 'M', 'L', 'XL'] }
const title = s => s.replace(/\b\w/g, c => c.toUpperCase())

const products = src.records.filter(r => r.vision).map(r => {
  const v = r.vision
  const cat = RIVER[coarse(v.garmentType)] ?? 'top'
  const colours = (v.colours && v.colours.length ? v.colours : [v.primaryColour]).map(c => c.toLowerCase())
  const embeddingText = [
    v.garmentType, ...colours, v.pattern, ...(v.materials || []), v.silhouette,
    ...(v.seasons || []), ...(v.occasions || []), ...(v.styleArchetypes || []),
    ...(v.discoveryQueries || []), v.description,
  ].filter(Boolean).join(' ').toLowerCase()
  return {
    id: r.id,
    name: title(`${v.primaryColour} ${v.garmentType}`),
    brand: '',
    price: price(cat, r.id),
    currency: 'EUR',
    imageUrl: r.image,
    category: cat,
    catalog: 'fashion', // the photo bank is casualwear; no real outdoor gear
    color: colours,
    sizesAvailable: sizes(cat),
    occasionTags: v.occasions || [],
    formalityLevel: v.formality ?? 2,
    season: v.seasons || [],
    fabric: v.materials || [],        // ← now populated, from vision
    silhouette: v.silhouette || '',   // ← now populated, from vision
    pattern: v.pattern || 'solid',
    styleTags: v.styleArchetypes || [],
    embeddingText,
    whyItMatters: v.description || '',
  }
})

writeFileSync(join(ROOT, 'src/lib/catalog/vision-catalog.json'), JSON.stringify(products, null, 2))
console.log(`built src/lib/catalog/vision-catalog.json · ${products.length} products`)
const byCat = {}
for (const p of products) byCat[p.category] = (byCat[p.category] || 0) + 1
console.log('categories:', Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join('  '))
