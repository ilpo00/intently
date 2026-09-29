// ─────────────────────────────────────────────────────────────────
// Intently · Enrichment — Curated Kaggle test set
//
// 10 products hand-picked from data/kaggle/styles.csv to give the
// prototype enough diversity to make semantic search visibly useful:
//
//   - 4 categories (Apparel, Accessories, Footwear, Bags)
//   - 3 usages (Casual, Sports, Formal-adjacent)
//   - 2 genders (Men, Women)
//   - 8 distinct colours
//   - 3 seasons
//
// Images are copied to intently/public/kaggle/{id}.jpg by the setup step,
// so imageUrl is `/kaggle/{id}.jpg` (Next.js serves /public/ at root).
//
// Source rows are reproduced inline rather than parsed from styles.csv
// every boot — 10 rows aren't worth the parser dependency, and
// inlining makes the seed visible at a glance.
// ─────────────────────────────────────────────────────────────────

import type { PimProduct } from '@/types/enrichment'

interface KaggleStyleRow {
  id: number
  gender: string
  masterCategory: string
  subCategory: string
  articleType: string
  baseColour: string
  season: string
  year: number
  usage: string
  productDisplayName: string
}

export const CURATED_ROWS: KaggleStyleRow[] = [
  {
    id: 15970,
    gender: 'Men',
    masterCategory: 'Apparel',
    subCategory: 'Topwear',
    articleType: 'Shirts',
    baseColour: 'Navy Blue',
    season: 'Fall',
    year: 2011,
    usage: 'Casual',
    productDisplayName: 'Turtle Check Men Navy Blue Shirt',
  },
  {
    id: 39386,
    gender: 'Men',
    masterCategory: 'Apparel',
    subCategory: 'Bottomwear',
    articleType: 'Jeans',
    baseColour: 'Blue',
    season: 'Summer',
    year: 2012,
    usage: 'Casual',
    productDisplayName: 'Peter England Men Party Blue Jeans',
  },
  {
    id: 59263,
    gender: 'Women',
    masterCategory: 'Accessories',
    subCategory: 'Watches',
    articleType: 'Watches',
    baseColour: 'Silver',
    season: 'Winter',
    year: 2016,
    usage: 'Casual',
    productDisplayName: 'Titan Women Silver Watch',
  },
  {
    id: 21379,
    gender: 'Men',
    masterCategory: 'Apparel',
    subCategory: 'Bottomwear',
    articleType: 'Track Pants',
    baseColour: 'Black',
    season: 'Fall',
    year: 2011,
    usage: 'Casual',
    productDisplayName: 'Manchester United Men Solid Black Track Pants',
  },
  {
    id: 34588,
    gender: 'Women',
    masterCategory: 'Apparel',
    subCategory: 'Dress',
    articleType: 'Dresses',
    baseColour: 'Cream',
    season: 'Summer',
    year: 2012,
    usage: 'Casual',
    productDisplayName: 'Tonga Women Cream Dress',
  },
  {
    id: 2147,
    gender: 'Men',
    masterCategory: 'Apparel',
    subCategory: 'Topwear',
    articleType: 'Tshirts',
    baseColour: 'Orange',
    season: 'Spring',
    year: 2011,
    usage: 'Casual',
    productDisplayName: 'Basics Men Orange Striped Polo T-shirt',
  },
  {
    id: 17036,
    gender: 'Men',
    masterCategory: 'Footwear',
    subCategory: 'Shoes',
    articleType: 'Casual Shoes',
    baseColour: 'White',
    season: 'Summer',
    year: 2013,
    usage: 'Casual',
    productDisplayName: 'Gas Men Caddy Casual Shoe',
  },
  {
    id: 13089,
    gender: 'Men',
    masterCategory: 'Apparel',
    subCategory: 'Topwear',
    articleType: 'Sweatshirts',
    baseColour: 'Grey',
    season: 'Fall',
    year: 2011,
    usage: 'Sports',
    productDisplayName: 'ADIDAS Men Lfc Auth Hood Grey Sweatshirts',
  },
  {
    id: 47957,
    gender: 'Women',
    masterCategory: 'Accessories',
    subCategory: 'Bags',
    articleType: 'Handbags',
    baseColour: 'Blue',
    season: 'Summer',
    year: 2012,
    usage: 'Casual',
    productDisplayName: 'Murcia Women Blue Handbag',
  },
  {
    id: 28200,
    gender: 'Men',
    masterCategory: 'Accessories',
    subCategory: 'Eyewear',
    articleType: 'Sunglasses',
    baseColour: 'Copper',
    season: 'Winter',
    year: 2016,
    usage: 'Casual',
    productDisplayName: 'Ray-Ban Men Active Lifestyle Copper Sunglasses',
  },
]

export function kaggleRowToPimProduct(row: KaggleStyleRow): PimProduct {
  return {
    id: `kaggle-${row.id}`,
    title: row.productDisplayName,
    category: row.masterCategory,
    subcategory: row.subCategory,
    articleType: row.articleType,
    gender: row.gender,
    color: row.baseColour,
    season: row.season,
    year: row.year,
    usage: row.usage,
    imageUrl: `/kaggle/${row.id}.jpg`,
    source: 'kaggle',
    raw: { ...row },
  }
}

export const CURATED_PRODUCTS: PimProduct[] = CURATED_ROWS.map(kaggleRowToPimProduct)
